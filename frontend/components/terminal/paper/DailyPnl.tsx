"use client";

import { useMemo, useState } from "react";
import type { DayPnl } from "@/lib/trading/analytics";
import { compactInr, signedInr } from "@/lib/trading/format";
import { EmptyState } from "./ui";

const H = 150;
const PAD = { t: 10, b: 20, l: 44, r: 8 };

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const longDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/**
 * When am I making or losing money? One bar per day the desk was open: above the line for a gain, below it for a loss.
 * Hover or focus a bar to read the day and its P&L.
 */
export function DailyPnlChart({ days }: { days: DayPnl[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const geo = useMemo(() => {
    const max = Math.max(1, ...days.map((d) => Math.abs(d.pnl)));
    const lo = Math.min(0, ...days.map((d) => d.pnl));
    const hi = Math.max(0, ...days.map((d) => d.pnl));
    return { max, lo, hi: hi === lo ? lo + 1 : hi };
  }, [days]);
  if (!days.length) return <EmptyState title="No daily results yet" body="A bar is added for each day you open the desk with a position or after a trade." />;
  const W = Math.max(280, 40 + days.length * 18);
  const plotH = H - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ((geo.hi - v) / (geo.hi - geo.lo)) * plotH;
  const bw = Math.min(26, ((W - PAD.l - PAD.r) / days.length) * 0.66);
  const x = (i: number) => PAD.l + ((i + 0.5) / days.length) * (W - PAD.l - PAD.r);
  const best = days.reduce((a, b) => (b.pnl > a.pnl ? b : a));
  const worst = days.reduce((a, b) => (b.pnl < a.pnl ? b : a));
  const h = hover != null ? days[hover] : null;
  return (
    <div className="pt-daily">
      <div className="pt-daily-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Daily profit and loss over ${days.length} days. Best ${signedInr(best.pnl, 0)} on ${dayLabel(best.day)}, worst ${signedInr(worst.pnl, 0)} on ${dayLabel(worst.day)}.`}>
          {[geo.hi, 0, geo.lo].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={v === 0 ? "pt-zero" : "pt-grid"} />
              <text x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end" className="pt-axis">
                {compactInr(v)}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const top = Math.min(y(0), y(d.pnl));
            const bh = Math.max(1.5, Math.abs(y(d.pnl) - y(0)));
            return (
              <g key={d.day}>
                <rect
                  className={`pt-bar ${d.pnl >= 0 ? "up" : "down"}${hover === i ? " on" : ""}`}
                  x={x(i) - bw / 2}
                  y={top}
                  width={bw}
                  height={bh}
                  rx={2}
                  tabIndex={0}
                  role="img"
                  aria-label={`${longDay(d.day)}, daily P&L ${signedInr(d.pnl, 0)}`}
                  style={{ transformOrigin: `${x(i)}px ${y(0)}px`, animationDelay: `${Math.min(i, 20) * 50}ms` }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
                {days.length <= 12 || i % Math.ceil(days.length / 10) === 0 ? (
                  <text x={x(i)} y={H - 6} textAnchor="middle" className="pt-axis">
                    {dayLabel(d.day)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="pt-daily-read" role="status" aria-live="polite">
        {h ? (
          <>
            <span>{longDay(h.day)}</span>
            <b className={h.pnl >= 0 ? "up" : "down"}>
              Daily P&amp;L {signedInr(h.pnl, 0)}
            </b>
          </>
        ) : (
          <span className="pt-muted">Hover a bar for the day’s P&amp;L</span>
        )}
        {days.some((d) => d.sim) ? <small className="pt-sim">Includes days priced with simulated data</small> : null}
      </div>
    </div>
  );
}
