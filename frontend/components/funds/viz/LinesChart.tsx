"use client";

import { ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { VIZ } from "./theme";

export type LineSeries = {
  id: string;
  label: string;
  color: string;
  points: { t: number; v: number | null }[];
  dash?: string;
  width?: number;
  /** Fill under the line (to the bottom, or to zero in drawdown mode). */
  area?: boolean;
  /** Draw as steps, for money put in. */
  step?: boolean;
};

type Props = {
  series: LineSeries[];
  height?: number;
  yFormat: (v: number) => string;
  xFormat: (t: number) => string;
  /** The tooltip heading for the hovered x. */
  title?: (t: number) => string;
  /** Replace the default rows (one per series). */
  rows?: (t: number, values: Record<string, number | null>) => ReactNode;
  /** A reference level drawn as a faint line, such as 100 for "growth of ₹100". */
  baseline?: number;
  /** Fill the space between the first series and zero, in red: a drawdown. */
  drawdown?: boolean;
  ariaLabel: string;
  /** A new value replays the draw-in animation (for example when the range changes). */
  drawKey?: string;
  /** Tick count along the bottom. */
  xTicks?: number;
  /** Exact x positions for the bottom ticks (for whole years, say), instead of evenly spaced ones. */
  xTickValues?: number[];
};

const M = { l: 58, r: 14, t: 12, b: 24 };

function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-6; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/**
 * A line and area chart in plain SVG. All series share their x values (a time axis or a year index); the
 * crosshair snaps to the nearest one and the tooltip lists every series there. Nothing is smoothed or
 * interpolated across gaps: a null value breaks the line.
 */
export function LinesChart({ series, height = 260, yFormat, xFormat, title, rows, baseline, drawdown = false, ariaLabel, drawKey, xTicks = 5, xTickValues }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const gid = `vz-g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lead = series.find((s) => s.points.length) ?? series[0];
  const xs = useMemo(() => (lead ? lead.points.map((p) => p.t) : []), [lead]);
  const lookups = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.t, p.v]))), [series]);

  const { x0, x1, y0, y1, ticks } = useMemo(() => {
    const vals: number[] = [];
    for (const s of series) for (const p of s.points) if (p.v != null && Number.isFinite(p.v)) vals.push(p.v);
    if (baseline != null) vals.push(baseline);
    if (drawdown) vals.push(0);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
    lo = drawdown ? lo - pad : lo - pad;
    hi = drawdown ? 0 : hi + pad;
    return { x0: xs[0] ?? 0, x1: xs[xs.length - 1] ?? 1, y0: lo, y1: hi, ticks: niceTicks(lo, hi) };
  }, [series, baseline, drawdown, xs]);

  const plotW = width - M.l - M.r;
  const plotH = height - M.t - M.b;
  const X = (t: number) => M.l + (x1 === x0 ? 0 : ((t - x0) / (x1 - x0)) * plotW);
  const Y = (v: number) => M.t + (y1 === y0 ? plotH / 2 : ((y1 - v) / (y1 - y0)) * plotH);

  const pathFor = (s: LineSeries) => {
    let d = "";
    let pen = false;
    let prevY = 0;
    for (const p of s.points) {
      if (p.v == null || !Number.isFinite(p.v)) {
        pen = false;
        continue;
      }
      const x = X(p.t);
      const y = Y(p.v);
      if (!pen) d += `M${x.toFixed(1)} ${y.toFixed(1)}`;
      else d += s.step ? `H${x.toFixed(1)}V${y.toFixed(1)}` : `L${x.toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
      prevY = y;
    }
    void prevY;
    return d;
  };
  const areaFor = (s: LineSeries, floor: number) => {
    const line = pathFor(s);
    const pts = s.points.filter((p) => p.v != null);
    if (!line || pts.length < 2) return "";
    return `${line}L${X(pts[pts.length - 1].t).toFixed(1)} ${floor.toFixed(1)}L${X(pts[0].t).toFixed(1)} ${floor.toFixed(1)}Z`;
  };

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    if (!xs.length) return;
    const box = e.currentTarget.getBoundingClientRect();
    const t = x0 + ((e.clientX - box.left) / box.width) * (x1 - x0);
    let lo = 0;
    let hi = xs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(xs[lo - 1] - t) <= Math.abs(xs[lo] - t)) lo -= 1;
    setHover(lo);
  }

  const hoverT = hover != null ? xs[hover] : null;
  const values: Record<string, number | null> = {};
  if (hoverT != null) series.forEach((s, i) => (values[s.id] = lookups[i].get(hoverT) ?? null));
  const flip = hoverT != null && X(hoverT) > width * 0.6;
  const tickCount = width < 520 ? Math.min(xTicks, 3) : xTicks;
  const xt = xTickValues ?? Array.from({ length: tickCount }, (_, i) => x0 + ((x1 - x0) * i) / Math.max(1, tickCount - 1));
  const key = drawKey ?? `${series.map((s) => s.id).join("|")}:${x0}:${x1}`;

  if (!lead || xs.length < 2) return <div ref={wrap} className="vz-lines" style={{ height }} />;

  return (
    <div ref={wrap} className="vz-lines" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        <defs>
          {series.filter((s) => s.area).map((s) => (
            <linearGradient key={s.id} id={`${gid}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={drawdown ? VIZ.red : s.color} stopOpacity={drawdown ? 0.04 : 0.22} />
              <stop offset="100%" stopColor={drawdown ? VIZ.red : s.color} stopOpacity={drawdown ? 0.22 : 0} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={width - M.r} y1={Y(v)} y2={Y(v)} stroke={VIZ.grid} />
            <text x={M.l - 8} y={Y(v) + 3.5} textAnchor="end" className="vz-axis">
              {yFormat(v)}
            </text>
          </g>
        ))}
        {baseline != null ? <line x1={M.l} x2={width - M.r} y1={Y(baseline)} y2={Y(baseline)} stroke={VIZ.grey} strokeDasharray="3 4" /> : null}
        {drawdown ? <line x1={M.l} x2={width - M.r} y1={Y(0)} y2={Y(0)} stroke={VIZ.grey} /> : null}
        {xt.map((t, i) => (
          <text key={t} x={X(t)} y={height - 6} textAnchor={i === 0 ? "start" : i === xt.length - 1 ? "end" : "middle"} className="vz-axis">
            {xFormat(t)}
          </text>
        ))}
        {series.map((s) =>
          s.area ? <path key={`a-${s.id}-${key}`} className="vz-area" d={areaFor(s, drawdown ? Y(0) : M.t + plotH)} fill={`url(#${gid}-${s.id})`} /> : null,
        )}
        {series.map((s) => (
          <path
            key={`l-${s.id}-${key}`}
            className="vz-line"
            d={pathFor(s)}
            fill="none"
            stroke={drawdown ? VIZ.red : s.color}
            strokeWidth={s.width ?? 2}
            strokeDasharray={s.dash}
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={s.dash ? undefined : 1}
          />
        ))}
        {hoverT != null ? (
          <g pointerEvents="none">
            <line x1={X(hoverT)} x2={X(hoverT)} y1={M.t} y2={M.t + plotH} stroke={VIZ.muted} strokeDasharray="3 3" />
            {series.map((s) => {
              const v = values[s.id];
              return v != null ? <circle key={s.id} cx={X(hoverT)} cy={Y(v)} r={3.6} fill={drawdown ? VIZ.red : s.color} stroke="#fff" strokeWidth={1.6} /> : null;
            })}
          </g>
        ) : null}
        <rect x={M.l} y={M.t} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hoverT != null ? (
        <div className="vz-tip" role="presentation" style={{ left: X(hoverT), top: M.t + 6, transform: `translateX(${flip ? "calc(-100% - 12px)" : "12px"})` }}>
          <strong>{title ? title(hoverT) : xFormat(hoverT)}</strong>
          {rows ? (
            rows(hoverT, values)
          ) : (
            series.map((s) =>
              values[s.id] != null ? (
                <span key={s.id} className="vz-tip-row">
                  <i style={{ background: drawdown ? VIZ.red : s.color }} />
                  <span>{s.label}</span>
                  <b>{yFormat(values[s.id] as number)}</b>
                </span>
              ) : null,
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
