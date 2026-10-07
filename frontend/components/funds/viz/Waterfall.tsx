"use client";

import { useEffect, useRef, useState } from "react";
import { VIZ } from "./theme";

export type WaterfallStep = {
  id: string;
  label: string;
  /** A total starts from zero; a delta moves the running level. */
  kind: "total" | "delta";
  value: number;
  valueText: string;
};

/** A bridge from a starting figure to an ending one: totals stand on the axis, deltas float and are linked by a thin rule. */
export function Waterfall({ steps, ariaLabel, height = 220 }: { steps: WaterfallStep[]; ariaLabel: string; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(260, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  let level = 0;
  const bars = steps.map((s) => {
    const from = s.kind === "total" ? 0 : level;
    const to = s.kind === "total" ? s.value : level + s.value;
    level = to;
    return { s, lo: Math.min(from, to), hi: Math.max(from, to), end: to };
  });
  const top = Math.max(1, ...bars.map((b) => b.hi));
  const bottom = Math.min(0, ...bars.map((b) => b.lo));
  const pad = { l: 8, r: 8, t: 22, b: 40 };
  const plotH = height - pad.t - pad.b;
  const slot = (width - pad.l - pad.r) / bars.length;
  const bw = Math.min(64, slot * 0.58);
  const Y = (v: number) => pad.t + ((top - v) / (top - bottom || 1)) * plotH;

  return (
    <div className="vz-waterfall" ref={wrap}>
      <svg width={width} height={height} role="img" aria-label={`${ariaLabel}: ${steps.map((s) => `${s.label} ${s.valueText}`).join(", ")}`}>
        <line x1={pad.l} x2={width - pad.r} y1={Y(0)} y2={Y(0)} stroke={VIZ.grid} />
        {bars.map((b, i) => {
          const x = pad.l + i * slot + (slot - bw) / 2;
          const color = b.s.kind === "total" ? VIZ.teal : b.s.value < 0 ? VIZ.red : VIZ.teal;
          const next = bars[i + 1];
          return (
            <g key={b.s.id} className="vz-wf-bar" style={{ animationDelay: `${i * 90}ms` }}>
              <rect x={x} y={Y(b.hi)} width={bw} height={Math.max(2, Y(b.lo) - Y(b.hi))} rx={3} fill={color} fillOpacity={b.s.kind === "total" ? 1 : 0.85} />
              <text x={x + bw / 2} y={Y(b.hi) - 7} textAnchor="middle" className="vz-wf-value">
                {b.s.valueText}
              </text>
              <text x={x + bw / 2} y={height - 18} textAnchor="middle" className="vz-axis">
                {b.s.label}
              </text>
              {next ? <line x1={x + bw} x2={pad.l + (i + 1) * slot + (slot - bw) / 2} y1={Y(b.end)} y2={Y(b.end)} stroke={VIZ.grey} strokeDasharray="2 3" /> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
