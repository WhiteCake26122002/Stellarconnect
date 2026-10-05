"use client";

import { Fragment, useState } from "react";
import { GlossaryHover, Term } from "@/components/guide/Glossary";
import { currencySymbol, fyShort, pct, perShare, scaled } from "@/lib/format";
import type { Workspace } from "@/lib/api";
import type { GlossaryId } from "@/lib/glossary";
import { num } from "@/lib/model";
import { useSimple } from "@/lib/prefs";

export type Point = { label: string; value: number; kind: "hist" | "forecast" };

function shortBarLabel(value: number): string {
  if (!value) return "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  return Math.round(value).toLocaleString("en-IN");
}

export function LabeledBars({
  points,
  title,
  format,
  onSelect,
}: {
  points: Point[];
  title: string;
  format: (v: number) => string;
  onSelect?: (index: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...points.map((p) => Math.abs(p.value)), 1);
  const width = 720;
  const height = 250;
  const pad = { l: 8, r: 8, t: 28, b: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const gap = 14;
  const barW = Math.max(18, innerW / points.length - gap);

  return (
    <div>
      <svg className="chart tall" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <title>{title}</title>
        {points.map((p, i) => {
          const h = (Math.abs(p.value) / max) * innerH;
          const x = pad.l + i * (barW + gap) + gap / 2;
          const y = p.value >= 0 ? pad.t + innerH - h : pad.t + innerH;
          const active = hover === i;
          const fill = p.kind === "hist" ? "var(--chart-hist)" : "var(--chart-forecast)";
          return (
            <g key={`${p.kind}-${p.label}`}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 4)}
                rx={6}
                fill={fill}
                opacity={active ? 1 : p.kind === "forecast" ? 0.95 : 0.92}
                tabIndex={0}
                role={onSelect ? "button" : undefined}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => onSelect?.(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect?.(i);
                  }
                }}
              >
                <title>{`${p.label}: ${format(p.value)}`}</title>
              </rect>
              <text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize={points.length > 8 ? "9" : "11"}
                fontWeight="650"
                fill={p.kind === "forecast" ? "var(--accent)" : "var(--muted)"}
              >
                {shortBarLabel(p.value)}
              </text>
              <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
                {fyShort(p.label)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chart-tip" aria-live="polite">
        {hover != null ? `${points[hover].label}: ${format(points[hover].value)}` : "Hover a year for the exact figure."}
      </div>
    </div>
  );
}

export function RevenueLine({
  points,
  title,
  format,
  hover,
  onHover,
  onSelect,
}: {
  points: Point[];
  title: string;
  format: (v: number) => string;
  hover: number | null;
  onHover: (i: number | null) => void;
  onSelect?: (index: number) => void;
}) {
  const n = points.length;
  const width = 720;
  const height = 220;
  const pad = { l: 12, r: 18, t: 28, b: 32 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals, lo + 1);
  const padY = (hi - lo) * 0.14 || 1;
  const min = lo - padY;
  const max = hi + padY;
  const span = max - min || 1;
  const xAt = (i: number) => pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.t + (1 - (v - min) / span) * innerH;
  const lastHist = points.reduce((acc, p, i) => (p.kind === "hist" ? i : acc), 0);
  const active = hover == null ? lastHist : Math.max(0, Math.min(n - 1, hover));

  const pathOf = (from: number, to: number) =>
    points
      .slice(from, to + 1)
      .map((p, i) => {
        const idx = from + i;
        return `${i === 0 ? "M" : "L"}${xAt(idx).toFixed(1)} ${yAt(p.value).toFixed(1)}`;
      })
      .join(" ");

  const histPath = pathOf(0, lastHist);
  const fwdPath = pathOf(lastHist, n - 1);
  const areaPath =
    n > lastHist
      ? `${fwdPath} L${xAt(n - 1).toFixed(1)} ${pad.t + innerH} L${xAt(lastHist).toFixed(1)} ${pad.t + innerH} Z`
      : "";

  function pickFromX(clientX: number, target: SVGSVGElement) {
    const box = target.getBoundingClientRect();
    const x = ((clientX - box.left) / Math.max(1, box.width)) * width;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < n; i += 1) {
      const d = Math.abs(xAt(i) - x);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    if (best !== hover) onHover(best);
    return best;
  }

  if (!n) return <p className="note">No revenue series on this model.</p>;

  return (
    <div className="rev-line">
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
        tabIndex={0}
        style={{ touchAction: "none" }}
        onMouseMove={(e) => pickFromX(e.clientX, e.currentTarget)}
        onClick={(e) => pickFromX(e.clientX, e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            onHover(Math.min(n - 1, active + 1));
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onHover(Math.max(0, active - 1));
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect?.(active);
          }
        }}
      >
        <title>{title}</title>
        <line x1={pad.l} x2={width - pad.r} y1={pad.t + innerH} y2={pad.t + innerH} stroke="var(--line)" strokeWidth="1" />
        {areaPath ? <path d={areaPath} fill="var(--chart-forecast)" opacity="0.12" /> : null}
        <path d={histPath} fill="none" stroke="var(--chart-hist)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
        {n > lastHist ? (
          <path d={fwdPath} fill="none" stroke="var(--chart-forecast)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
        <line
          x1={xAt(active)}
          x2={xAt(active)}
          y1={pad.t}
          y2={pad.t + innerH}
          stroke="var(--ink)"
          strokeWidth="1"
          strokeDasharray="3 4"
          opacity="0.28"
        />
        {points.map((p, i) => {
          const on = i === active;
          const fill = p.kind === "hist" ? "var(--chart-hist)" : "var(--chart-forecast)";
          return (
            <g key={`${p.kind}-${p.label}`}>
              <circle
                cx={xAt(i)}
                cy={yAt(p.value)}
                r={on ? 6 : 3.4}
                fill="#fff"
                stroke={fill}
                strokeWidth={on ? 2.4 : 1.8}
              />
              {on ? (
                <text
                  x={xAt(i)}
                  y={yAt(p.value) - 12}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="650"
                  fill="var(--ink)"
                  pointerEvents="none"
                >
                  {format(p.value)}
                </text>
              ) : null}
              <text
                x={xAt(i)}
                y={height - 8}
                textAnchor="middle"
                fontSize="11"
                fill="var(--muted)"
                pointerEvents="none"
              >
                {fyShort(p.label)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="chart-tip">
        {points[active] ? `${fyShort(points[active].label)}: ${format(points[active].value)}. Arrow keys move the year.` : "Move along the line."}
      </p>
    </div>
  );
}

export function Sparkline({ values, rising }: { values: number[]; rising?: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 72;
  const h = 22;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 2) - 1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={rising === false ? "var(--over)" : "var(--bull)"} strokeWidth="1.6" />
    </svg>
  );
}

export function WaccArc({ value }: { value: number }) {
  const t = Math.max(0, Math.min(1, value / 0.2));
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <svg className="wacc-arc" viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r={R} fill="none" stroke="var(--line)" strokeWidth="7" />
      <circle
        cx="36"
        cy="36"
        r={R}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="7"
        strokeDasharray={`${C * t} ${C}`}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="40" textAnchor="middle" fill="var(--ink)" fontSize="11" fontWeight="700">
        {pct(value)}
      </text>
    </svg>
  );
}

export function TvRing({ share }: { share: number }) {
  const t = Math.max(0, Math.min(1, share));
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <svg className="tv-ring" viewBox="0 0 72 72" role="img" aria-label={`${pct(share)} of enterprise value`}>
      <circle cx="36" cy="36" r={R} fill="none" stroke="var(--line)" strokeWidth="8" />
      <circle
        cx="36"
        cy="36"
        r={R}
        fill="none"
        stroke="var(--violet)"
        strokeWidth="8"
        strokeDasharray={`${C * t} ${C}`}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="40" textAnchor="middle" fill="var(--violet)" fontSize="11" fontWeight="700">
        {pct(share)}
      </text>
    </svg>
  );
}

export function QualityRing({ score, max, status }: { score: number; max: number; status?: string }) {
  const t = Math.max(0, Math.min(1, max ? score / max : 0));
  const R = 34;
  const C = 2 * Math.PI * R;
  const tone =
    status === "BLOCKED" || status === "blocked" || score < 40
      ? "var(--bear)"
      : status === "REVIEW_REQUIRED" || status === "warning" || score < 70
        ? "var(--warn)"
        : "var(--bull)";
  return (
    <svg className="quality-ring" viewBox="0 0 92 92" role="img" aria-label={`Model quality ${score} of ${max}`}>
      <circle cx="46" cy="46" r={R} fill="none" stroke="var(--line)" strokeWidth="8" />
      <circle
        cx="46"
        cy="46"
        r={R}
        fill="none"
        stroke={tone}
        strokeWidth="8"
        strokeDasharray={`${C * t} ${C}`}
        strokeLinecap="round"
        transform="rotate(-90 46 46)"
      />
      <text x="46" y="44" textAnchor="middle" fill="var(--ink)" fontSize="22" fontWeight="700">
        {score}
      </text>
      <text x="46" y="60" textAnchor="middle" fill="var(--muted)" fontSize="10">
        /{max}
      </text>
    </svg>
  );
}

export function ComparePrices({
  name,
  implied,
  market,
  symbol,
  scenario,
  onScenario,
  presentation,
}: {
  name: string;
  implied: number | null;
  market: number | null;
  symbol: string;
  scenario: "Bear" | "Base" | "Bull";
  onScenario: (s: "Bear" | "Base" | "Bull") => void;
  presentation?: { kind?: string; label?: string | null; status?: string; reason?: string } | null;
}) {
  const simple = useSimple();
  const residual = presentation?.kind === "negative";
  const sotp = presentation?.kind === "sotp";
  const blocked = presentation?.kind === "blocked" || presentation?.kind === "unreliable";
  const a = Math.max(implied || 0, 0);
  const b = Math.max(market || 0, 0);
  const max = Math.max(a, b, 1);
  const under = a >= b;
  const impliedW = residual || blocked ? 0 : (a / max) * 100;
  const marketW = (b / max) * 100;
  const split = under ? (b / Math.max(a, 1)) * 100 : (a / Math.max(b, 1)) * 100;
  const gapPct = under
    ? a
      ? Math.round(((a - b) / a) * 100)
      : 0
    : b
      ? Math.round(((b - a) / b) * 100)
      : 0;
  const title = residual
    ? `${name} Residual Equity`
    : sotp
      ? `${name} SOTP Review`
      : `${name} DCF Base Case`;
  const figure = blocked
    ? "BLOCKED"
    : residual
      ? "Below 0"
      : implied == null
        ? "—"
        : perShare(implied, symbol);

  return (
    <div className="iv-board">
      <h2 className="iv-title">
        <Term id={residual ? "equity_value" : "dcf"}>{title}</Term>
      </h2>
      <p className="iv-figure">{figure}</p>
      {residual ? (
        <p className="iv-blocked">
          {String(presentation?.status || "NEGATIVE RESIDUAL EQUITY").replaceAll("_", " ")}
          {" — classified residual, not a distress label and not a stock target."}
        </p>
      ) : null}
      {sotp ? <p className="iv-blocked">SOTP REVIEW REQUIRED — consolidated FCFF plus a simple equity bridge is not the right architecture. This is not a target price.</p> : null}
      <div
        className="iv-scale"
        role="img"
        aria-label={`${title} ${figure} versus price ${perShare(market, symbol)}`}
      >
        <div className="iv-bar iv-implied" style={{ width: `${impliedW}%` }}>
          {under && gapPct > 0 ? (
            <>
            <span className="iv-seg core">{simple ? "Model value" : "DCF Base Case"}</span>
              <span className="iv-seg gap under">{simple ? `Price ${gapPct}% below` : <>Undervaluation {gapPct}%</>}</span>
            </>
          ) : (
            <span className="iv-seg core">{simple ? "Model value" : "DCF Base Case"}</span>
          )}
        </div>
        <div className="iv-price-row">
          <div className="iv-price-scale">
            <div className="iv-bar iv-market" style={{ width: `${marketW}%` }}>
              {!under && gapPct > 0 ? (
                <>
                  <span className="iv-seg px" style={{ flex: `0 0 ${split}%` }}>
                    Price
                  </span>
                  <span className="iv-seg gap over">{simple ? `Price ${gapPct}% above` : <>Overvaluation {gapPct}%</>}</span>
                </>
              ) : (
                <span className="iv-seg px">Price</span>
              )}
            </div>
          </div>
          <b className="iv-price-amt">{perShare(market, symbol)}</b>
        </div>
      </div>
      <div className="case-pills" role="group" aria-label="Scenario" data-tour="cases">
        {(["Bear", "Base", "Bull"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={scenario === s} onClick={() => onScenario(s)}>
            {s} Case
          </button>
        ))}
      </div>
      {simple ? (
        <p className="case-help">
          <Term id="scenarios">What do Bear, Base and Bull mean?</Term>
        </p>
      ) : null}
    </div>
  );
}

export function revenuePoints(model: Workspace): Point[] {
  const hist = model.historicals.income_statements.map((r) => ({
    label: String(r.period),
    value: num(r, "revenue"),
    kind: "hist" as const,
  }));
  const forecast = model.forecast.years.map((r) => ({
    label: String(r.period),
    value: num(r, "revenue"),
    kind: "forecast" as const,
  }));
  return [...hist, ...forecast];
}

export function fcffPoints(model: Workspace): Point[] {
  return model.forecast.years.map((r) => ({
    label: String(r.period),
    value: num(r, "fcff"),
    kind: "forecast" as const,
  }));
}

export function BarSeries({
  points,
  title,
  format,
}: {
  points: Point[];
  title: string;
  format: (v: number) => string;
}) {
  return <LabeledBars points={points} title={title} format={format} />;
}

export function Waterfall({
  items,
  divisor,
}: {
  items: { label: string; value: number | null | undefined; term?: GlossaryId }[];
  divisor: number;
}) {
  const nums = items.map((i) => Math.abs(i.value || 0));
  const max = Math.max(...nums, 1);
  return (
    <div className="waterfall">
      {items.map((i) => {
        const body = (
          <>
            <div>{i.label}</div>
            <div className={`waterfall-bar ${(i.value || 0) < 0 ? "neg" : ""}`}>
              <span style={{ width: `${(Math.abs(i.value || 0) / max) * 100}%` }} />
            </div>
            <div className="waterfall-val">{scaled(i.value, divisor)}</div>
          </>
        );
        return i.term ? (
          <GlossaryHover key={i.label} id={i.term} className="waterfall-row has-tip">
            {body}
          </GlossaryHover>
        ) : (
          <div className="waterfall-row" key={i.label}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function nearestValue(values: number[], target: number): number | null {
  if (!values.length || !Number.isFinite(target)) return null;
  return values.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), values[0]);
}

const same = (a: number | null, b: number) => a != null && Math.abs(a - b) < 1e-9;

export type GridAxis = { values: number[]; label: (v: number) => string; base: number | null };

/**
 * Two-way implied-price grid: cells above the market price read green, below read red, the base
 * case is outlined, hovering describes a cell and clicking applies it.
 */
export function SensitivityGrid({
  corner,
  rows,
  cols,
  valueAt,
  price,
  describe,
  idle,
  clickHint,
  onApply,
}: {
  corner: string;
  rows: GridAxis;
  cols: GridAxis;
  valueAt: (row: number, col: number) => number | null | undefined;
  price: number;
  describe: (row: number, col: number) => string;
  idle: string;
  clickHint: string;
  /** Applies the cell and returns the status line to show. */
  onApply: (row: number, col: number) => string;
}) {
  const [inspect, setInspect] = useState(idle);
  return (
    <>
      <div className="heat-wrap">
        <div className="heatmap" style={{ gridTemplateColumns: `4.6rem repeat(${cols.values.length}, minmax(4.4rem, 1fr))` }}>
          <div className="heatcell lab">{corner}</div>
          {cols.values.map((c) => (
            <div key={`c-${c}`} className="heatcell head">
              {cols.label(c)}
              {same(cols.base, c) ? " (Base)" : ""}
            </div>
          ))}
          {rows.values.map((r) => (
            <Fragment key={`r-${r}`}>
              <div className="heatcell lab">
                {rows.label(r)}
                {same(rows.base, r) ? " (Base)" : ""}
              </div>
              {cols.values.map((c) => {
                const v = valueAt(r, c);
                const here = same(rows.base, r) && same(cols.base, c);
                const above = v != null && price && v > price;
                const vs = v != null && price ? ` (${v > price ? "above" : "below"} market)` : "";
                const label = `${describe(r, c)}: ${v == null ? "n/a" : v.toFixed(2)}${vs}`;
                const hint = here ? `${label} — current case` : `${label}. ${clickHint}`;
                return (
                  <button
                    type="button"
                    key={`${r}-${c}`}
                    className={`heatcell ${here ? "here" : ""} ${above ? "above" : ""}`}
                    onMouseEnter={() => setInspect(hint)}
                    onFocus={() => setInspect(hint)}
                    onClick={() => setInspect(onApply(r, c))}
                    aria-label={label}
                    aria-pressed={here}
                  >
                    {v == null || Number.isNaN(v) ? "n/a" : v.toFixed(2)}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <p className="heat-status note" aria-live="polite">
        {inspect}
      </p>
    </>
  );
}

export function currentPrice(model: Workspace): number {
  return (model.valuation?.equity_bridge as { current_share_price?: number } | undefined)?.current_share_price || 0;
}

export function Heatmap({
  model,
  onApplyGrowth,
  bare,
}: {
  model: Workspace;
  onApplyGrowth: (g: number) => void;
  bare?: boolean;
}) {
  const table = model.sensitivity;
  const price = currentPrice(model);
  const symbol = currencySymbol(model.display.currency);

  if (!table) return <p className="muted">Sensitivity needs a valid WACC above g.</p>;

  const inner = (
    <>
      <div className="chart-head">
        <div>
          <h2>
            <Term id="sensitivity">WACC vs. Terminal Growth</Term>
          </h2>
          <p className="note">Implied share price sensitivity (Current Market: {perShare(price, symbol || "")})</p>
        </div>
      </div>
      <SensitivityGrid
        corner="WACC / g"
        rows={{ values: table.wacc_range, label: pct, base: nearestValue(table.wacc_range, Number(model.wacc.wacc)) }}
        cols={{ values: table.growth_range, label: pct, base: nearestValue(table.growth_range, model.drivers.terminal_growth) }}
        valueAt={(w, g) =>
          table.cells.find((c) => Math.abs(c.wacc - w) < 1e-9 && Math.abs(c.terminal_growth - g) < 1e-9)?.equity_value_per_share
        }
        price={price}
        describe={(w, g) => `WACC ${pct(w)}, g ${pct(g)}`}
        idle="Hover a cell. Click to set terminal growth g."
        clickHint="Click to set g."
        onApply={(_w, g) => {
          onApplyGrowth(g);
          return `Applied terminal growth ${pct(g)}.`;
        }}
      />
    </>
  );
  return bare ? <div>{inner}</div> : <div className="card">{inner}</div>;
}

export function ComboForecast({
  model,
  format,
}: {
  model: Workspace;
  format: (v: number) => string;
}) {
  return <LabeledBars points={revenuePoints(model)} title="Historical vs forecast revenue" format={format} />;
}

