"use client";

import { ReactNode, useId, useState } from "react";

export type DonutSlice = { id: string; label: string; pct: number; color: string; valueText?: string; opacity?: number };

/**
 * A donut for parts of a whole. Hover calls out a slice in the centre, click selects it, and the same
 * slices are keyboard reachable. `pct` values are percentages of the whole and should sum to about 100.
 */
export function Donut({
  slices,
  selectedId,
  onSelect,
  size = 224,
  thickness = 26,
  total,
  ariaLabel,
}: {
  slices: DonutSlice[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  size?: number;
  thickness?: number;
  /** Shown in the centre when nothing is hovered or selected. */
  total: { top: ReactNode; bottom: string };
  ariaLabel: string;
}) {
  const mask = `vz-m${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [hot, setHot] = useState<string | null>(null);
  const r = (size - thickness - 8) / 2;
  const c = size / 2;
  const gap = slices.length > 1 ? 0.7 : 0;
  let acc = 0;
  const arcs = slices.map((s) => {
    const start = acc;
    acc += s.pct;
    return { s, start, len: Math.max(0, s.pct - gap) };
  });
  const focusId = hot ?? selectedId ?? null;
  const focus = slices.find((s) => s.id === focusId) ?? null;

  return (
    <div className="vz-donut" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="group" aria-label={ariaLabel}>
        <defs>
          <mask id={mask}>
            <circle className="vz-sweep" cx={c} cy={c} r={r} fill="none" stroke="#fff" strokeWidth={thickness + 12} pathLength={100} strokeDasharray={100} transform={`rotate(-90 ${c} ${c})`} />
          </mask>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(17,17,17,0.06)" strokeWidth={thickness} />
        <g mask={`url(#${mask})`}>
          {arcs.map(({ s, start, len }) => {
            const on = s.id === focusId;
            const dim = focusId != null && !on;
            return (
              <circle
                key={s.id}
                className="vz-arc"
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={on ? thickness + 6 : thickness}
                strokeOpacity={dim ? 0.28 : (s.opacity ?? 1)}
                pathLength={100}
                strokeDasharray={`${len} ${100 - len}`}
                strokeDashoffset={-start}
                transform={`rotate(-90 ${c} ${c})`}
                tabIndex={onSelect ? 0 : undefined}
                role={onSelect ? "button" : "img"}
                aria-label={`${s.label} ${s.pct.toFixed(1)}%`}
                aria-pressed={onSelect ? s.id === selectedId : undefined}
                onPointerEnter={() => setHot(s.id)}
                onPointerLeave={() => setHot(null)}
                onFocus={() => setHot(s.id)}
                onBlur={() => setHot(null)}
                onClick={() => onSelect?.(s.id)}
                onKeyDown={(e) => {
                  if (onSelect && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onSelect(s.id);
                  }
                }}
              />
            );
          })}
        </g>
      </svg>
      <div className="vz-donut-centre" aria-hidden>
        {focus ? (
          <>
            <b>{focus.pct.toFixed(focus.pct < 10 ? 1 : 0)}%</b>
            <span>{focus.label}</span>
            {focus.valueText ? <em>{focus.valueText}</em> : null}
          </>
        ) : (
          <>
            <b>{total.top}</b>
            <span>{total.bottom}</span>
          </>
        )}
      </div>
    </div>
  );
}
