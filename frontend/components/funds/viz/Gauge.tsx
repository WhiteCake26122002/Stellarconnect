"use client";

import { VIZ } from "./theme";

/** A half-circle gauge for a 0–100 score. The arc colour changes only at the band edges (50, 65). */
export function Gauge({ score, band, size = 220, onClick }: { score: number | null; band: string | null; size?: number; onClick?: () => void }) {
  const w = size;
  const h = size * 0.72;
  const cx = w / 2;
  const cy = size * 0.55;
  const r = size * 0.4;
  const stroke = size * 0.075;
  const angle = (v: number) => Math.PI - (v / 100) * Math.PI;
  const point = (v: number, radius = r) => `${(cx + radius * Math.cos(angle(v))).toFixed(2)} ${(cy - radius * Math.sin(angle(v))).toFixed(2)}`;
  const arc = (from: number, to: number) => `M ${point(from)} A ${r} ${r} 0 0 1 ${point(to)}`;
  const color = score == null ? VIZ.grey : score >= 65 ? VIZ.teal : score >= 50 ? VIZ.gold : VIZ.red;
  const tick = (v: number) => {
    const r1 = r + stroke / 2 + 2;
    const r2 = r + stroke / 2 + 7;
    return <line key={v} x1={cx + r1 * Math.cos(angle(v))} y1={cy - r1 * Math.sin(angle(v))} x2={cx + r2 * Math.cos(angle(v))} y2={cy - r2 * Math.sin(angle(v))} stroke={VIZ.grey} strokeWidth={1} />;
  };
  const art = (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={score == null ? "Portfolio health unavailable" : `Portfolio health ${score} out of 100, ${band}`}>
      <path d={arc(0, 100)} fill="none" stroke="rgba(17,17,17,0.07)" strokeWidth={stroke} strokeLinecap="round" />
      {score != null ? <path className="vz-gauge-arc" d={arc(0, Math.max(0.5, score))} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" pathLength={1} /> : null}
      {[50, 65, 80].map(tick)}
      <text x={cx} y={cy - size * 0.03} textAnchor="middle" className="vz-gauge-score">
        {score ?? "—"}
      </text>
      <text x={cx} y={cy + size * 0.11} textAnchor="middle" className="vz-gauge-band">
        {band ?? "Unavailable"}
      </text>
    </svg>
  );
  return onClick ? (
    <button type="button" className="vz-gauge link" onClick={onClick} aria-label="How is the health score calculated?">
      {art}
    </button>
  ) : (
    <div className="vz-gauge">{art}</div>
  );
}
