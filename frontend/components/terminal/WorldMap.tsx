"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { api } from "@/lib/api";
import { indexLevel, pct } from "@/lib/trading/format";
import { quoteFromLive } from "@/lib/trading/market";
import { signedFill } from "@/lib/trading/treemap";
import { COUNTRY_SHAPES, WORLD_VIEW } from "@/lib/trading/world-geo";
import { WORLD_MARKETS } from "@/lib/trading/world-markets";
import type { Quote } from "@/lib/trading/types";

const MUTED = "#1d1d1d";

type LiveRow = {
  symbol: string;
  last: number;
  prev_close: number;
  open: number;
  high: number;
  low: number;
  change: number;
  change_pct: number;
  volume: number;
  ts: number;
  live?: boolean;
};

export function WorldMap({
  quotes,
  loading,
  onPick,
}: {
  quotes: Map<string, Quote>;
  loading?: boolean;
  onPick: (symbol: string) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [iso, setIso] = useState<string | null>("IN");
  const [hoverIso, setHoverIso] = useState<string | null>(null);
  const [hoverName, setHoverName] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [liveQuotes, setLiveQuotes] = useState<Map<string, Quote>>(new Map());
  const [reading, setReading] = useState(true);

  useEffect(() => {
    let gone = false;
    const apply = (data: { quotes?: LiveRow[] }) => {
      const next = new Map<string, Quote>();
      for (const row of data.quotes || []) {
        if (!(row.last > 0)) continue;
        try {
          next.set(row.symbol, quoteFromLive(row.symbol, { ...row, live: row.live !== false }));
        } catch {
          continue;
        }
      }
      if (next.size) {
        setLiveQuotes((prev) => {
          const merged = new Map(prev);
          for (const [symbol, quote] of next) merged.set(symbol, quote);
          return merged;
        });
      }
    };
    const pull = async () => {
      try {
        const data = await api.marketWorld();
        if (!gone) apply(data);
      } catch {
        /* keep last painted countries */
      } finally {
        if (!gone) setReading(false);
      }
    };
    pull();
    const timer = window.setInterval(pull, 20_000);
    return () => {
      gone = true;
      window.clearInterval(timer);
    };
  }, []);

  const rows = useMemo(() => {
    return WORLD_MARKETS.map((m) => {
      const live = liveQuotes.get(m.symbol) || (quotes.get(m.symbol)?.last ? quotes.get(m.symbol) : undefined);
      return {
        ...m,
        quote: live || null,
        changePct: live?.changePct ?? 0,
        last: live?.last ?? 0,
        live: !!live?.live,
      };
    }).sort((a, b) => Number(b.live) - Number(a.live) || Math.abs(b.changePct) - Math.abs(a.changePct));
  }, [liveQuotes, quotes]);

  const active = rows.find((r) => r.iso === iso) || rows[0];
  const byIso = useMemo(() => new Map(rows.map((r) => [r.iso, r])), [rows]);
  const hoveredMarket = hoverIso ? byIso.get(hoverIso) : null;
  const hoveredCountry = hoverName || "";

  function moveTip(e: MouseEvent) {
    const box = canvas.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top });
  }

  return (
    <div className="board-page world-page">
      <header className="board-head">
        <div>
          <h1>World map</h1>
          <p>Hover a country for its main index. Levels are Yahoo lasts, rounded. Green is up. Red is down.</p>
        </div>
        <p className={`world-live ${reading || loading ? "muted" : ""}`}>
          {reading || loading ? "Updating indices…" : "Yahoo session last"}
        </p>
      </header>
      <div className="world-split">
        <div className="world-canvas" ref={canvas}>
          <svg viewBox={`0 0 ${WORLD_VIEW.w} ${WORLD_VIEW.h}`} role="img" aria-label="World index map">
            <rect width={WORLD_VIEW.w} height={WORLD_VIEW.h} className="world-ocean" />
            {COUNTRY_SHAPES.map((shape) => {
              const market = shape.iso ? byIso.get(shape.iso) : undefined;
              const on = iso === shape.iso;
              const fill = market?.live ? signedFill(market.changePct) : MUTED;
              return (
                <path
                  key={`${shape.iso}-${shape.name}`}
                  d={shape.d}
                  fill={fill}
                  className={`world-country ${market?.live ? "mapped" : "quiet"} ${on ? "on" : ""}`}
                  role={market ? "button" : undefined}
                  tabIndex={market ? 0 : undefined}
                  aria-label={market ? `${shape.name} ${market.index}` : shape.name}
                  onMouseEnter={(e) => {
                    setHoverIso(shape.iso || null);
                    setHoverName(shape.name === "England" ? "United Kingdom" : shape.name === "USA" ? "United States" : shape.name);
                    if (shape.iso && byIso.has(shape.iso)) setIso(shape.iso);
                    moveTip(e);
                  }}
                  onMouseMove={moveTip}
                  onMouseLeave={() => {
                    setTip(null);
                    setHoverName(null);
                    setHoverIso(null);
                  }}
                  onFocus={() => {
                    setHoverIso(shape.iso || null);
                    setHoverName(shape.name);
                    if (shape.iso && byIso.has(shape.iso)) setIso(shape.iso);
                  }}
                  onClick={() => {
                    if (shape.iso && byIso.has(shape.iso)) setIso(shape.iso);
                  }}
                  onKeyDown={(e) => {
                    if (!market) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setIso(shape.iso);
                    }
                  }}
                />
              );
            })}
          </svg>
          {tip && hoveredCountry ? (
            <div className="world-tip" style={{ left: tip.x + 14, top: tip.y + 12 }} role="status">
              <strong>{hoveredCountry}</strong>
              {hoveredMarket ? (
                <>
                  <span>{hoveredMarket.index}</span>
                  {hoveredMarket.live ? (
                    <>
                      <b className={hoveredMarket.changePct >= 0 ? "up" : "down"}>{pct(hoveredMarket.changePct)}</b>
                      <em>{indexLevel(hoveredMarket.last)}</em>
                    </>
                  ) : (
                    <span>Waiting for Yahoo last</span>
                  )}
                </>
              ) : (
                <span>No mapped index</span>
              )}
            </div>
          ) : null}
        </div>
        <aside className="world-rail" aria-label="Index list">
          {active ? (
            <div className="world-active">
              <span className="muted">{active.country}</span>
              <strong>{active.index}</strong>
              <b className={active.live ? (active.changePct >= 0 ? "up" : "down") : ""}>
                {active.live ? indexLevel(active.last) : "—"}
              </b>
              <span className={active.live ? (active.changePct >= 0 ? "up" : "down") : "muted"}>
                {active.live ? pct(active.changePct) : "Waiting for Yahoo"}
              </span>
              <button type="button" className="btn" onClick={() => onPick(active.symbol)}>
                Open chart
              </button>
            </div>
          ) : null}
          <ul>
            {rows.map((row) => (
              <li key={row.symbol}>
                <button
                  type="button"
                  className={row.iso === iso ? "on" : ""}
                  onClick={() => setIso(row.iso)}
                  onDoubleClick={() => onPick(row.symbol)}
                >
                  <i style={{ background: row.live ? signedFill(row.changePct) : MUTED }} />
                  <span>{row.country}</span>
                  <em>{row.live ? indexLevel(row.last) : row.index}</em>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
