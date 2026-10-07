"use client";

import { useMemo, useState } from "react";
import { CASH_COLOR, holdingColor } from "@/lib/trading/holdings";
import { compactInr, inr, weightPct } from "@/lib/trading/format";
import type { Slice } from "@/lib/trading/analytics";
import { EmptyState } from "./ui";

const R = 62;
const C = 2 * Math.PI * R;

/** Restrained palette: the teal accent first, then quiet neutrals; cash is always grey. */
const PALETTE = ["#111111", "#555555", "#8f8f8f", "#bdbdbd", "#333333", "#777777", "#a8a8a8", "#d4d4d4"];

export function sliceColor(s: Slice, i: number) {
  return s.id === "cash" ? CASH_COLOR : s.id === "others" ? "#d3dad8" : PALETTE[i % PALETTE.length];
}

/**
 * Where is my money invested? A donut of holdings and cash. The slices grow in once, a hovered or focused slice
 * lifts slightly and fills the centre with its name, value and share, and a click opens that position.
 */
export function PortfolioAllocation({
  slices,
  onOpen,
  hover,
  onHover,
}: {
  slices: Slice[];
  onOpen: (symbol: string) => void;
  hover?: string | null;
  onHover?: (id: string | null) => void;
}) {
  const [own, setOwn] = useState<string | null>(null);
  const active = hover !== undefined ? hover : own;
  const setActive = (id: string | null) => (onHover ? onHover(id) : setOwn(id));
  const arcs = useMemo(() => {
    let offset = 0;
    return slices.map((s, i) => {
      const len = s.weight * C;
      const arc = { s, i, len, offset };
      offset += len;
      return arc;
    });
  }, [slices]);
  if (!slices.length) return <EmptyState title="Nothing to show yet" body="Your allocation appears once your account has cash or a position." />;
  const focus = slices.find((s) => s.id === active) ?? null;
  const top = slices[0];
  const summary = slices.map((s) => `${s.label} ${weightPct(s.weight, 0)}`).join(", ");

  return (
    <div className="pt-alloc">
      <div className="pt-donut-wrap">
        <svg viewBox="0 0 160 160" className="pt-donut" role="img" aria-label={`Portfolio allocation: ${summary}`}>
          <circle cx="80" cy="80" r={R} fill="none" stroke="var(--connect-surface-soft)" strokeWidth="18" />
          <g transform="rotate(-90 80 80)">
            {arcs.map(({ s, i, len, offset }) => (
              <circle
                key={s.id}
                className={`pt-arc${active === s.id ? " on" : ""}${s.symbol ? " link" : ""}`}
                cx="80"
                cy="80"
                r={R}
                fill="none"
                stroke={sliceColor(s, i)}
                strokeWidth={18}
                strokeDasharray={`${Math.max(0, len - (slices.length > 1 ? 1.2 : 0))} ${C}`}
                strokeDashoffset={-offset}
                style={{ ["--len" as string]: `${len}`, animationDelay: `${i * 50}ms` }}
                tabIndex={s.symbol ? 0 : -1}
                role={s.symbol ? "button" : undefined}
                aria-label={`${s.label} ${weightPct(s.weight)}${s.symbol ? ", open position" : ""}`}
                onMouseEnter={() => setActive(s.id)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(s.id)}
                onBlur={() => setActive(null)}
                onClick={() => s.symbol && onOpen(s.symbol)}
                onKeyDown={(e) => {
                  if (s.symbol && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onOpen(s.symbol);
                  }
                }}
              />
            ))}
          </g>
        </svg>
        <div className="pt-donut-centre" aria-hidden>
          <b>{weightPct((focus ?? top).weight, 0)}</b>
          <span>{(focus ?? top).label}</span>
          {focus ? <small>{inr(focus.value, 0)}</small> : <small>largest</small>}
        </div>
      </div>
      <ul className="pt-legend" aria-label="Allocation list">
        {slices.map((s, i) => (
          <li key={s.id} className={active === s.id ? "on" : ""} onMouseEnter={() => setActive(s.id)} onMouseLeave={() => setActive(null)}>
            <button type="button" disabled={!s.symbol} onClick={() => s.symbol && onOpen(s.symbol)} onFocus={() => setActive(s.id)} onBlur={() => setActive(null)}>
              <i style={{ background: sliceColor(s, i) }} aria-hidden />
              <span>{s.label}</span>
              <b>{weightPct(s.weight, 0)}</b>
              <small>{compactInr(s.value)}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { holdingColor };
