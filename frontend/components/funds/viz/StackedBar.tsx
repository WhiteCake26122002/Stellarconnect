"use client";

import { useState } from "react";
import { TipRow, useTip } from "./Tip";

export type StackSegment = { id: string; label: string; value: number; color: string; valueText: string; note?: string };

/** One bar split into parts, with a legend underneath that lights the matching segment on hover. */
export function StackedBar({ segments, ariaLabel, height = 20, onSelect }: { segments: StackSegment[]; ariaLabel: string; height?: number; onSelect?: (id: string) => void }) {
  const [hot, setHot] = useState<string | null>(null);
  const { ref, show, hide, el } = useTip();
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  if (total <= 0) return null;
  return (
    <div
      className="vz-stack"
      ref={ref}
      onPointerLeave={() => {
        setHot(null);
        hide();
      }}
    >
      <div className="vz-stack-bar" role="img" aria-label={`${ariaLabel}: ${segments.map((s) => `${s.label} ${s.valueText}`).join(", ")}`} style={{ height }}>
        {segments.map((s, i) => (
          <span
            key={s.id}
            className={`vz-stack-seg${hot && hot !== s.id ? " dim" : ""}`}
            style={{ flexGrow: Math.max(s.value, total * 0.004), flexBasis: 0, background: s.color, animationDelay: `${i * 60}ms` }}
            onPointerEnter={() => setHot(s.id)}
            onPointerMove={(e) =>
              show(
                e,
                <>
                  <strong>{s.label}</strong>
                  <TipRow label="Share" value={s.valueText} />
                  {s.note ? <small>{s.note}</small> : null}
                </>,
              )
            }
            onClick={() => onSelect?.(s.id)}
          />
        ))}
      </div>
      <ul className="vz-legend">
        {segments.map((s) => (
          <li key={s.id} className={hot === s.id ? "on" : ""} onPointerEnter={() => setHot(s.id)}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{s.valueText}</b>
          </li>
        ))}
      </ul>
      {el}
    </div>
  );
}
