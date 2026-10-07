"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MarketHeatmapTile } from "@/lib/api";
import { pct } from "@/lib/trading/format";
import { nestedTreemap, signedFill } from "@/lib/trading/treemap";
import type { Quote } from "@/lib/trading/types";
import { HeatmapTooltip } from "./paper/HeatmapTooltip";

const UNIVERSES = [
  { id: "Nifty 50", label: "Nifty 50" },
  { id: "Nifty Midcap 150", label: "Nifty Midcap" },
  { id: "Nifty Smallcap 250", label: "Nifty Smallcap" },
] as const;

export function HeatMap({
  quotes,
  loading,
  onPick,
  compact = false,
}: {
  quotes: Map<string, Quote>;
  loading?: boolean;
  onPick: (symbol: string) => void;
  /** The dashboard's embedded version: no page heading, a fixed height. */
  compact?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [universe, setUniverse] = useState<(typeof UNIVERSES)[number]["id"]>("Nifty 50");
  const [industry, setIndustry] = useState("Popular");
  const [tiles, setTiles] = useState<MarketHeatmapTile[]>([]);
  const [live, setLive] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  // The pointer in window coordinates: the tooltip is drawn in a portal and positioned against the window.
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const cache = useRef(new Map<string, { tiles: MarketHeatmapTile[]; live: boolean }>());

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(320, r.width), h: Math.max(240, r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let gone = false;
    const ac = new AbortController();
    const cached = cache.current.get(universe);
    if (cached) {
      setTiles(cached.tiles);
      setLive(cached.live);
    } else {
      setTiles([]);
      setLive(false);
    }
    setFetching(true);
    setIndustry("Popular");
    const namesOf = (items: { symbol: string; name: string; industry?: string }[]) =>
      items.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        industry: item.industry || "Market",
        last: 0,
        change_pct: 0,
        market_cap: 0,
        live: false,
      }));
    const pull = async () => {
      const skeleton = (async () => {
        if (cached) return;
        try {
          const listed = await api.marketUniverse({ index: universe, limit: 250 }, ac.signal);
          if (gone) return;
          setTiles((prev) => (prev.length ? prev : namesOf(listed.items || [])));
        } catch {
          /* Yahoo paint may still arrive */
        }
      })();
      const live = (async () => {
        try {
          const payload = await api.marketHeatmap({ index: universe, range: "D" }, ac.signal);
          if (gone) return;
          if (payload.tiles?.length) {
            cache.current.set(universe, { tiles: payload.tiles, live: payload.live });
            setTiles(payload.tiles);
            setLive(payload.live);
          }
        } catch {
          /* keep skeleton or last cache */
        }
      })();
      await Promise.all([skeleton, live]);
    };
    pull().finally(() => {
      if (!gone) setFetching(false);
    });
    return () => {
      gone = true;
      ac.abort();
    };
  }, [universe]);

  const source = useMemo(() => {
    return tiles.map((tile) => {
      const q = quotes.get(tile.symbol);
      if (!q?.last) return tile;
      return {
        ...tile,
        last: q.last,
        change_pct: tile.live ? tile.change_pct : q.changePct,
        live: tile.live || q.live,
      };
    });
  }, [quotes, tiles]);
  const industries = useMemo(() => {
    const names = [...new Set(source.map((t) => t.industry).filter(Boolean))].sort();
    return ["Popular", ...names];
  }, [source]);
  const filtered = industry === "Popular" ? source : source.filter((t) => t.industry === industry);
  const sizedByCap = filtered.some((t) => t.market_cap > 0);

  const layout = useMemo(() => {
    const nodes = filtered.map((tile) => ({
      id: tile.symbol,
      symbol: tile.symbol,
      name: tile.name,
      group: tile.industry || "Market",
      value: sizedByCap ? Math.max(tile.market_cap, 1) : Math.max(tile.last, 1),
      changePct: tile.change_pct,
      last: tile.last,
      marketCap: tile.market_cap,
    }));
    return nestedTreemap(nodes, { x: 8, y: 8, w: size.w - 16, h: size.h - 48 }, 3, 20);
  }, [filtered, size.h, size.w, sizedByCap]);

  const hovered = hover ? source.find((t) => t.symbol === hover) : null;
  const universeLabel = UNIVERSES.find((item) => item.id === universe)?.label || universe;

  return (
    <div className={`board-page heat-page${compact ? " compact" : ""}`}>
      {compact ? null : (
      <header className="board-head">
        <div>
          <h1>Heat map</h1>
          <p>
            {universeLabel}. Tile size is market cap. Colour is today's session move.
            {sizedByCap ? "" : fetching ? "" : " Caps still loading — sizes use last price until Yahoo answers."}
          </p>
        </div>
        {hovered ? (
          <p className="heat-hover" role="status">
            <strong>{hovered.symbol}</strong>
            <span>{hovered.name}</span>
            <b className={hovered.change_pct >= 0 ? "up" : "down"}>{pct(hovered.change_pct)}</b>
          </p>
        ) : (
          <p className="heat-hover muted">{fetching || loading ? "Reading the tape…" : live ? "Yahoo session last" : "Hover a box."}</p>
        )}
      </header>
      )}
      <div className="heat-toolbar">
        <label>
          Index
          <select
            value={universe}
            onChange={(e) => setUniverse(e.target.value as (typeof UNIVERSES)[number]["id"])}
            aria-label="Index"
          >
            {UNIVERSES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Industries
          <select value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Industries">
            {industries.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="heat-canvas" ref={wrap}>
        <svg viewBox={`0 0 ${size.w} ${size.h - 40}`} width="100%" height="100%" aria-label="Market heat map">
          {layout.map((block) => (
            <g key={block.group}>
              <rect x={block.frame.x} y={block.frame.y} width={block.frame.w} height={block.frame.h} className="heat-group" />
              {block.frame.w > 72 && block.frame.h > 28 ? (
                <text x={block.frame.x + 8} y={block.frame.y + 14} className="heat-group-label">
                  {block.group}
                </text>
              ) : null}
              {block.tiles.map((tile) => {
                const on = hover === tile.symbol;
                const showName = tile.w > 56 && tile.h > 28;
                return (
                  <g key={tile.id}>
                    <rect
                      x={tile.x}
                      y={tile.y}
                      width={Math.max(0, tile.w - 1)}
                      height={Math.max(0, tile.h - 1)}
                      fill={signedFill(tile.changePct)}
                      className={`heat-tile ${on ? "on" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${tile.symbol} ${tile.name}`}
                      aria-describedby={on ? "pt-heat-tip" : undefined}
                      onMouseEnter={(e) => {
                        setHover(tile.symbol);
                        setTip({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => {
                        setHover((h) => (h === tile.symbol ? null : h));
                        setTip(null);
                      }}
                      onFocus={(e) => {
                        setHover(tile.symbol);
                        const r = e.currentTarget.getBoundingClientRect();
                        setTip({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
                      }}
                      onBlur={() => {
                        setHover((h) => (h === tile.symbol ? null : h));
                        setTip(null);
                      }}
                      onClick={() => onPick(tile.symbol)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onPick(tile.symbol);
                        }
                      }}
                    />
                    {showName ? (
                      <text
                        x={tile.x + tile.w / 2}
                        y={tile.y + tile.h / 2}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="heat-sym"
                        style={{ fontSize: Math.min(13, Math.max(9, tile.w / 8)) }}
                      >
                        {tile.symbol}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
        {tip && hovered ? (
          <HeatmapTooltip
            anchor={tip}
            data={{
              symbol: hovered.symbol,
              name: hovered.name,
              last: hovered.last,
              changePct: hovered.change_pct,
              sector: hovered.industry,
              dayChange: hovered.last > 0 ? hovered.last - hovered.last / (1 + hovered.change_pct) : undefined,
              volume: quotes.get(hovered.symbol)?.volume || undefined,
              marketCap: hovered.market_cap > 0 ? hovered.market_cap : undefined,
            }}
          />
        ) : null}
        {!fetching && !source.length ? (
          <p className="heat-empty" role="status">
            No constituents for {universeLabel} yet.
          </p>
        ) : null}
      </div>
      <div className="heat-legend" aria-hidden>
        <span>Down</span>
        <i />
        <span>Up</span>
      </div>
    </div>
  );
}
