"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { TipRow, useTip } from "./Tip";
import { VIZ } from "./theme";

export type BarRow = {
  id: string;
  label: string;
  sub?: string;
  /** Length of the bar, in the same units as `max`. */
  value: number;
  /** What is printed at the end of the bar. */
  valueText: string;
  color?: string;
  href?: string;
  onClick?: () => void;
  /** Extra lines in the hover tooltip. */
  tip?: { label: string; value: string }[];
  active?: boolean;
};

/** Horizontal bars for ranked parts. Rows open a fund (href) or call back (onClick); hover shows a compact tooltip. */
export function HBars({ rows, max, ariaLabel, dense = false }: { rows: BarRow[]; max?: number; ariaLabel: string; dense?: boolean }) {
  const { ref, show, hide, el } = useTip();
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={`vz-hbars${dense ? " dense" : ""}`} ref={ref} role="list" aria-label={ariaLabel} onPointerLeave={hide}>
      {rows.map((r, i) => {
        const body: ReactNode = (
          <>
            <span className="vz-hb-label">
              <span className="vz-hb-name">{r.label}</span>
              {r.sub ? <small>{r.sub}</small> : null}
            </span>
            <span className="vz-hb-track">
              <span className="vz-hb-fill" style={{ width: `${Math.min(100, Math.max(0, (r.value / top) * 100))}%`, background: r.color ?? VIZ.teal, animationDelay: `${i * 45}ms` }} />
            </span>
            <span className="vz-hb-value">{r.valueText}</span>
          </>
        );
        const interactive = !!(r.href || r.onClick);
        const className = `vz-hb-row${r.active ? " on" : ""}${interactive ? " link" : ""}`;
        const onPointerMove = (e: React.PointerEvent) =>
          show(
            e,
            <>
              <strong>{r.label}</strong>
              <TipRow label="Share" value={r.valueText} />
              {r.tip?.map((t) => <TipRow key={t.label} label={t.label} value={t.value} />)}
              {interactive ? <small>Click to open</small> : null}
            </>,
          );
        return r.href ? (
          <Link key={r.id} href={r.href} role="listitem" className={className} onPointerMove={onPointerMove}>
            {body}
          </Link>
        ) : r.onClick ? (
          <button key={r.id} type="button" role="listitem" className={className} onClick={r.onClick} onPointerMove={onPointerMove}>
            {body}
          </button>
        ) : (
          <div key={r.id} role="listitem" className={className} onPointerMove={onPointerMove}>
            {body}
          </div>
        );
      })}
      {el}
    </div>
  );
}
