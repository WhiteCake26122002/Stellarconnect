"use client";

import { useMemo, useState } from "react";
import { unrealized } from "@/lib/trading/engine";
import { inr, signedInr } from "@/lib/trading/format";
import { CASH_COLOR, holdingColor, slicePath } from "@/lib/trading/holdings";
import type { Position, Quote } from "@/lib/trading/types";
import { findSymbol } from "@/lib/trading/universe";

function shareLabel(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

type Slice = {
  id: string;
  symbol: string;
  name: string;
  value: number;
  pnl: number;
  color: string;
  cash?: boolean;
};

export function HoldingsPie({
  positions,
  quotes,
  cash,
  onPick,
  hover: hoverProp,
  onHover,
}: {
  positions: Position[];
  quotes: Map<string, Quote>;
  cash: number;
  onPick: (symbol: string) => void;
  /** Controlled highlight (position id or "cash"), shared with the holdings table. */
  hover?: string | null;
  onHover?: (id: string | null) => void;
}) {
  const [hoverLocal, setHoverLocal] = useState<string | null>(null);
  const hover = onHover ? (hoverProp ?? null) : hoverLocal;
  const setHover = (next: string | null | ((h: string | null) => string | null)) => {
    const value = typeof next === "function" ? next(hover) : next;
    if (onHover) onHover(value);
    else setHoverLocal(value);
  };
  const open = positions.filter((p) => p.status !== "closed");

  const slices = useMemo<Slice[]>(() => {
    const taken: string[] = [];
    const rows: Slice[] = open.map((p) => {
      const last = quotes.get(p.symbol)?.last ?? p.avgPrice;
      const color = holdingColor(p.symbol, taken);
      taken.push(color);
      return {
        id: p.id,
        symbol: p.symbol,
        name: findSymbol(p.symbol).name,
        value: Math.max(1, Math.abs(p.qty * last)),
        pnl: unrealized(p, last),
        color,
      };
    });
    if (cash > 0 || !rows.length) {
      rows.push({
        id: "cash",
        symbol: "CASH",
        name: "Cash",
        value: Math.max(1, cash),
        pnl: 0,
        color: CASH_COLOR,
        cash: true,
      });
    }
    return rows;
  }, [cash, open, quotes]);

  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  const cx = 120;
  const cy = 120;
  const r = 104;
  let angle = -Math.PI / 2;
  const paths = slices.map((slice) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + Math.max(sweep, 0.03);
    angle += sweep;
    return { ...slice, d: slicePath(cx, cy, r, a0, a1), share: slice.value / total };
  });
  const active = paths.find((s) => s.id === hover) || null;

  function pick(slice: Slice) {
    if (slice.cash) return;
    onPick(slice.symbol);
  }

  return (
    <section className="port-pie" aria-label="Holdings mix">
      <div className="port-pie-chart">
        <svg viewBox="0 0 240 240" width="280" height="280" aria-hidden>
          {paths.map((slice) => {
            const on = hover === slice.id;
            return (
              <path
                key={slice.id}
                d={slice.d}
                fill={slice.color}
                stroke="#ffffff"
                strokeWidth="1.2"
                opacity={!hover || on ? 1 : 0.38}
                className="port-slice"
                style={{ cursor: slice.cash ? "default" : "pointer" }}
                role={slice.cash ? undefined : "button"}
                tabIndex={slice.cash ? undefined : 0}
                aria-label={`${slice.name} ${shareLabel(slice.share)}`}
                onMouseEnter={() => setHover(slice.id)}
                onMouseLeave={() => setHover((h) => (h === slice.id ? null : h))}
                onFocus={() => setHover(slice.id)}
                onBlur={() => setHover((h) => (h === slice.id ? null : h))}
                onClick={() => pick(slice)}
                onKeyDown={(e) => {
                  if (slice.cash) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick(slice);
                  }
                }}
              />
            );
          })}
          <circle cx={cx} cy={cy} r="64" fill="#ffffff" pointerEvents="none" />
        </svg>
        <div className="port-pie-center" aria-live="polite">
          {active ? (
            <>
              <strong>{active.name}</strong>
              <b>{inr(active.value, 0)}</b>
              <em>{shareLabel(active.share)}</em>
              {!active.cash ? <span className={active.pnl >= 0 ? "up" : "down"}>{signedInr(active.pnl)}</span> : <span className="muted">Uninvested</span>}
            </>
          ) : (
            <>
              <strong>Book</strong>
              <b>{inr(total, 0)}</b>
              <em>{open.length ? `${open.length} holding${open.length === 1 ? "" : "s"}` : "Cash only"}</em>
            </>
          )}
        </div>
      </div>
      <ul className="port-pie-legend">
        {slices.map((slice) => (
          <li key={slice.id}>
            <button
              type="button"
              className={hover === slice.id ? "on" : ""}
              onMouseEnter={() => setHover(slice.id)}
              onMouseLeave={() => setHover((h) => (h === slice.id ? null : h))}
              onFocus={() => setHover(slice.id)}
              onClick={() => pick(slice)}
            >
              <i style={{ background: slice.color }} />
              <span>{slice.name}</span>
              <em>{shareLabel(slice.value / total)}</em>
              <b>{inr(slice.value, 0)}</b>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
