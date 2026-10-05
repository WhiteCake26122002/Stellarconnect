"use client";

import { useMemo, useState } from "react";
import { unrealized } from "@/lib/trading/engine";
import type { Position, Quote } from "@/lib/trading/types";
import { inr, pct, signedInr } from "@/lib/trading/format";
import { CASH_COLOR, holdingColor, slicePath } from "@/lib/trading/holdings";
import { findSymbol } from "@/lib/trading/universe";

type Slice = {
  id: string;
  symbol: string;
  name: string;
  value: number;
  pnl: number;
  color: string;
  cash?: boolean;
};

export function PositionPie({
  positions,
  quotes,
  cash,
  onPick,
}: {
  positions: Position[];
  quotes: Map<string, Quote>;
  cash: number;
  onPick: (symbol: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const slices = useMemo<Slice[]>(() => {
    const openPos = positions.filter((p) => p.status !== "closed");
    const taken: string[] = [];
    const rows: Slice[] = openPos.map((p) => {
      const last = quotes.get(p.symbol)?.last ?? p.avgPrice;
      const value = Math.abs(p.qty * last);
      const pnl = unrealized(p, last);
      const color = holdingColor(p.symbol, taken);
      taken.push(color);
      return {
        id: p.id,
        symbol: p.symbol,
        name: findSymbol(p.symbol).name,
        value: Math.max(1, value),
        pnl,
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
  }, [cash, positions, quotes]);

  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  const cx = 17;
  const cy = 17;
  const r = 15;
  let angle = -Math.PI / 2;
  const paths = slices.map((slice) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + Math.max(sweep, 0.04);
    angle += sweep;
    return { ...slice, d: slicePath(cx, cy, r, a0, a1) };
  });
  const active = paths.find((s) => s.id === hover) || null;
  const invested = slices.filter((s) => !s.cash).reduce((n, s) => n + s.value, 0);
  const count = positions.filter((p) => p.status !== "closed").length;

  return (
    <div className={`pos-pie ${open ? "open" : ""}`}>
      <button
        type="button"
        className="pos-pie-btn"
        aria-label="Position mix"
        aria-expanded={open}
        title="Positions"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 34 34" width="18" height="18" aria-hidden>
          {paths.map((slice) => (
            <path
              key={slice.id}
              d={slice.d}
              fill={slice.color}
              opacity={hover && hover !== slice.id ? 0.45 : 1}
              onMouseEnter={() => setHover(slice.id)}
              onMouseLeave={() => setHover((h) => (h === slice.id ? null : h))}
            />
          ))}
          <circle cx="17" cy="17" r="8" fill="#000000" />
        </svg>
      </button>
      {open || active ? (
        <div className="pos-pie-tip" role="dialog" aria-label="Holdings">
          {active ? (
            <p>
              <strong>{active.name}</strong>
              <b className={active.pnl >= 0 ? "up" : "down"}>{active.cash ? inr(cash, 0) : signedInr(active.pnl, 0)}</b>
            </p>
          ) : (
            <p>
              <strong>{count ? `${count} open` : "No positions"}</strong>
              <b>{inr(invested, 0)}</b>
            </p>
          )}
          <ul>
            {slices.map((slice) => (
              <li key={slice.id}>
                <button
                  type="button"
                  className={hover === slice.id ? "on" : ""}
                  onMouseEnter={() => setHover(slice.id)}
                  onClick={() => {
                    if (slice.cash) {
                      setOpen(false);
                      return;
                    }
                    onPick(slice.symbol);
                    setOpen(false);
                  }}
                >
                  <i style={{ background: slice.color }} />
                  <span>{slice.symbol}</span>
                  <em>{pct(slice.value / total)}</em>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
