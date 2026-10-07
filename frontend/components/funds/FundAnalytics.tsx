"use client";

import { ReactNode, useId, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  DAY,
  MARKET_DRAWDOWNS,
  maxDrawdown,
  REQUIREMENTS,
  parseDay,
  riskStats,
  RollingStats,
  rollingReturns,
  SeriesSet,
  WindowResult,
  windowReturn,
  YEAR,
} from "@/lib/funds/analytics";
import { frac, longDate, monthYear, ratio, shortDate, signedFrac, yearsText } from "@/lib/funds/format";
import type { GapId } from "@/lib/funds/gaps";
import type { AnalysisState } from "@/lib/funds/useFundsBook";
import { useReducedMotion } from "@/lib/motion";
import { benchColor, GRID, INK, MUTED, PREFERRED_BENCH, SUBJECT_COLOR } from "./chartTheme";
import { DataGap, GapNote, PanelEmpty, PanelSkeleton } from "./FundAtoms";

export type AnalyticsSource =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "empty"; message: string }
  | { state: "gap"; gaps: GapId[]; detail?: string }
  | { state: "ready"; set: SeriesSet; basis: string };

/** Map the portfolio's load state onto the panels' states. */
export function portfolioSource(holdings: number, analysis: AnalysisState, series: SeriesSet | null): AnalyticsSource {
  if (!holdings) return { state: "empty", message: "Add a fund to see this." };
  if (analysis.error) return { state: "error", message: analysis.error };
  if (!analysis.report) return { state: "loading" };
  if (!analysis.report.ready) return { state: "empty", message: "None of these schemes has a live NAV right now, so there is no value history." };
  if (analysis.report.blocked?.includes("performance")) return { state: "empty", message: "Withheld: the time-weighted path disagreed with the table beside it, so it is not drawn until that is resolved." };
  if (!series) return { state: "empty", message: "This appears once a holding has at least two weekly marks after its purchase date." };
  return { state: "ready", set: series, basis: "Time-weighted (new money is not counted as return) from" };
}

function benchOf(set: SeriesSet): string | undefined {
  return set.benchmarks.find((b) => b.label === PREFERRED_BENCH)?.label ?? set.benchmarks[0]?.label;
}

function prettyBench(label: string | undefined): string {
  if (!label) return "benchmark";
  return label.replace("NIFTY", "Nifty");
}

/** Shared non-ready rendering so every panel has a loading, error, empty and needs-data state. */
function NotReady({ source, title, height }: { source: Exclude<AnalyticsSource, { state: "ready" }>; title: string; height?: number }) {
  if (source.state === "loading") return <PanelSkeleton title={title} height={height} />;
  if (source.state === "error") return <PanelEmpty title={title}>Could not load the value history: {source.message}</PanelEmpty>;
  if (source.state === "empty") return <PanelEmpty title={title}>{source.message}</PanelEmpty>;
  return (
    <DataGap title={title} gaps={source.gaps}>
      {source.detail ? <p className="muted">{source.detail}</p> : null}
    </DataGap>
  );
}

function Basis({ set, basis }: { set: SeriesSet; basis: string }) {
  return (
    <p className="mf-basis">
      {basis} {set.intervals.length} marks
      {set.excluded ? `, ${set.excluded} ${set.excluded === 1 ? "interval" : "intervals"} with a purchase left out (new money is not return)` : ""}.
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Risk / return

/** `subject` null means the measure cannot be reported yet; `need` then says what it requires. */
type MetricRow = { key: string; label: string; hint: string; subject: string | null; need?: string; bench: string | null; toneValue?: number | null };

export function RiskReturnPanel({ source, title = "Risk and return" }: { source: AnalyticsSource; title?: string }) {
  const rfId = useId();
  const [rfText, setRfText] = useState("6.5");
  if (source.state !== "ready") return <NotReady source={source} title={title} />;
  const { set, basis } = source;
  const benchLabel = benchOf(set);
  const rfNum = Number(rfText);
  const rf = rfText.trim() !== "" && Number.isFinite(rfNum) ? rfNum / 100 : null;
  const s = riskStats(set, (iv) => iv.subject, set.subject, rf, benchLabel);
  const benchPoints = set.benchmarks.find((b) => b.label === benchLabel)?.points;
  const b = benchLabel && benchPoints ? riskStats(set, (iv) => iv.bench[benchLabel] ?? null, benchPoints, rf) : null;
  const benchName = prettyBench(benchLabel);
  const short = s.annualized == null;

  const dd = (d: typeof s.drawdown) =>
    d ? (d.depth === 0 ? "No drawdown" : `${signedFrac(d.depth)}`) : "n/a";
  const rows: MetricRow[] = [
    short
      ? { key: "ret", label: "Return (not annualized)", hint: `Only ${yearsText(s.years)} of marks. ${REQUIREMENTS.annualized}`, subject: signedFrac(s.cumulative), bench: b ? signedFrac(b.cumulative) : null, toneValue: s.cumulative }
      : { key: "ret", label: "Annualized return", hint: "Time-weighted, so the timing of your purchases does not flatter or penalize it.", subject: signedFrac(s.annualized), bench: b ? signedFrac(b.annualized) : null, toneValue: s.annualized },
    { key: "vol", label: "Volatility", hint: `Annualized standard deviation of returns between marks (about every ${Math.round(set.step / DAY)} days).`, subject: s.volatility == null ? null : frac(s.volatility), need: REQUIREMENTS.volatility, bench: b ? (b.volatility == null ? null : frac(b.volatility)) : null },
    { key: "sharpe", label: "Sharpe ratio", hint: "Return above the risk-free rate per unit of volatility.", subject: s.sharpe == null ? null : ratio(s.sharpe), need: REQUIREMENTS.sharpe, bench: b ? (b.sharpe == null ? null : ratio(b.sharpe)) : null },
    { key: "dd", label: "Max drawdown", hint: s.drawdown && s.drawdown.depth < 0 ? `Over ${longDate(set.subject[0].t)} to ${longDate(set.subject[set.subject.length - 1].t)}: ${longDate(s.drawdown.peak)} → ${longDate(s.drawdown.trough)}, ${s.drawdown.recovered ? `recovered ${longDate(s.drawdown.recovered)}` : "not yet recovered"}.` : `Deepest peak-to-trough fall over ${longDate(set.subject[0].t)} to ${longDate(set.subject[set.subject.length - 1].t)}.`, subject: dd(s.drawdown), bench: b ? dd(b.drawdown) : null, toneValue: s.drawdown?.depth ? s.drawdown.depth : null },
    { key: "beta", label: `Beta vs ${benchName}`, hint: "1.0 moves with the index; below 1 swings less.", subject: s.beta == null ? null : ratio(s.beta), need: REQUIREMENTS.beta, bench: benchLabel ? "1.00" : null },
    { key: "down", label: "Downside capture", hint: `Share of ${benchName}'s falling periods you took. Under 100% is gentler.`, subject: s.downCapture == null ? null : frac(s.downCapture, 0), need: REQUIREMENTS.capture, bench: null },
    { key: "up", label: "Upside capture", hint: `Share of ${benchName}'s rising periods you kept.`, subject: s.upCapture == null ? null : frac(s.upCapture, 0), need: REQUIREMENTS.capture, bench: null },
  ];
  const thin = s.volatility == null;

  return (
    <section className="card mf-panel" aria-label={title}>
      <div className="mf-panel-head">
        <div>
          <h2>{title}</h2>
          <Basis set={set} basis={basis} />
        </div>
        <label className="mf-rf" htmlFor={rfId}>
          <span>Risk-free rate</span>
          <span className="mf-input-suffix">
            <input id={rfId} inputMode="decimal" value={rfText} onChange={(e) => setRfText(e.target.value)} aria-describedby={`${rfId}-h`} />
            <span aria-hidden>%</span>
          </span>
          <small id={`${rfId}-h`}>Your assumption, used for Sharpe</small>
        </label>
      </div>
      {thin ? (
        <p className="banner mf-inline-banner">
          Not enough history for volatility, Sharpe, beta or capture ratios: this series covers {yearsText(s.years)} and these measures need at least a year. They appear on their own as history builds.
        </p>
      ) : null}
      <div className="table-wrap mf-metrics-wrap">
        <table className="mf-metrics">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">{set.subjectLabel}</th>
              {b ? <th scope="col">{benchName}</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} data-tour={`mf-${row.key}`}>
                <th scope="row">
                  {row.label}
                  <small>{row.subject == null && row.need ? row.need : row.hint}</small>
                </th>
                {row.subject == null ? (
                  <td className="mf-na" title={row.need}>
                    Not enough history
                  </td>
                ) : (
                  <td className={row.toneValue == null ? "" : row.toneValue > 0 ? "bull" : row.toneValue < 0 ? "bear" : ""}>{row.subject}</td>
                )}
                {b ? <td className="muted">{row.bench ?? "—"}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GapNote gaps={["risk-free"]}>Beta and capture are measured against {benchName}, a broad-market reference, not each fund&apos;s own benchmark.</GapNote>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Rolling returns

const WINDOWS = [1, 3, 5];

function RangeBar({ stats, lo, hi }: { stats: RollingStats; lo: number; hi: number }) {
  const span = hi - lo || 1;
  const pos = (v: number) => `${((v - lo) / span) * 100}%`;
  return (
    <span className="mf-range" aria-hidden="true">
      {lo < 0 && hi > 0 ? <i className="mf-range-zero" style={{ left: pos(0) }} /> : null}
      <i className="mf-range-fill" style={{ left: pos(stats.min), width: `calc(${pos(stats.max)} - ${pos(stats.min)})` }} />
      <i className="mf-range-mid" style={{ left: pos(stats.median) }} />
    </span>
  );
}

export function RollingReturnsPanel({ source, title = "Rolling returns" }: { source: AnalyticsSource; title?: string }) {
  if (source.state !== "ready") return <NotReady source={source} title={title} height={140} />;
  const { set } = source;
  const benchLabel = benchOf(set);
  const history = (set.subject[set.subject.length - 1].t - set.subject[0].t) / YEAR;
  const stats = WINDOWS.map((w) => ({ w, s: rollingReturns(set, w, benchLabel) }));
  const present = stats.filter((x) => x.s).map((x) => x.s as RollingStats);
  const lo = Math.min(0, ...present.map((s) => s.min));
  const hi = Math.max(0, ...present.map((s) => s.max));
  const missing = stats.filter((x) => !x.s).map((x) => `${x.w}Y`);

  if (!present.length) {
    return (
      <PanelEmpty title={title}>
        Rolling returns need at least one full year of history, and this portfolio has {yearsText(history)}. The 1Y, 3Y and 5Y windows appear as each becomes possible.
      </PanelEmpty>
    );
  }

  return (
    <section className="card mf-panel" aria-label={title}>
      <h2>{title}</h2>
      <p className="mf-basis">
        Every window of that length inside {yearsText(history)} of history, annualized. A tight range means the result did not hinge on one lucky start date.
      </p>
      <div className="table-wrap">
        <table className="mf-rolling">
          <thead>
            <tr>
              <th scope="col">Window</th>
              <th scope="col">Worst</th>
              <th scope="col">Median</th>
              <th scope="col">Best</th>
              <th scope="col" className="mf-range-col">
                Spread
              </th>
              <th scope="col">Positive</th>
              <th scope="col">Beat {prettyBench(benchLabel)}</th>
            </tr>
          </thead>
          <tbody>
            {stats.filter((x) => x.s).map(({ w, s }) =>
              s ? (
                <tr key={w}>
                  <th scope="row">
                    {w}Y <small>{s.count} windows</small>
                  </th>
                  <td className={s.min < 0 ? "bear" : ""} title={`Window ending ${longDate(s.worstEnd)}`}>
                    {signedFrac(s.min)}
                  </td>
                  <td>{signedFrac(s.median)}</td>
                  <td className={s.max > 0 ? "bull" : ""}>{signedFrac(s.max)}</td>
                  <td className="mf-range-col">
                    <RangeBar stats={s} lo={lo} hi={hi} />
                  </td>
                  <td>{frac(s.positiveShare, 0)}</td>
                  <td>{s.beatShare == null ? "n/a" : frac(s.beatShare, 0)}</td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </div>
      {missing.length ? <p className="mf-basis">{missing.join(" and ")} windows are not shown: this series covers {yearsText(history)}.</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Growth of ₹100 overlay

const OVERLAY_RANGES = [
  { id: "6M", years: 0.5 },
  { id: "1Y", years: 1 },
  { id: "3Y", years: 3 },
  { id: "5Y", years: 5 },
  { id: "All", years: null },
] as const;
type OverlayRange = (typeof OVERLAY_RANGES)[number]["id"];

export function GrowthOverlayPanel({ source, title = "Growth of ₹100" }: { source: AnalyticsSource; title?: string }) {
  const reduce = useReducedMotion();
  const set = source.state === "ready" ? source.set : null;
  const first = set?.subject[0]?.t ?? 0;
  const last = set ? set.subject[set.subject.length - 1].t : 0;
  const fits = (years: number | null) => years == null || last - years * YEAR >= first;
  const [chosen, setRange] = useState<OverlayRange | null>(null);
  const range: OverlayRange = chosen ?? (fits(1) ? "1Y" : "All");
  const picked = OVERLAY_RANGES.find((r) => r.id === range) ?? OVERLAY_RANGES[OVERLAY_RANGES.length - 1];
  const from = picked.years == null || !fits(picked.years) ? first : last - picked.years * YEAR;

  const data = useMemo(() => {
    if (!set) return [];
    const start = Math.max(0, set.subject.findIndex((p) => p.t >= from));
    const base = set.subject[start].v;
    const benchBase = set.benchmarks.map((b) => b.points[start].v);
    return set.subject.slice(start).map((p, k) => {
      const row: Record<string, number> = { t: p.t, s: (p.v / base) * 100 };
      set.benchmarks.forEach((b, j) => {
        row[`b${j}`] = (b.points[start + k].v / benchBase[j]) * 100;
      });
      return row;
    });
  }, [set, from]);

  if (source.state !== "ready" || !set) {
    return source.state === "ready" ? <PanelEmpty title={title}>No value path to draw.</PanelEmpty> : <NotReady source={source} title={title} height={240} />;
  }
  const end = data[data.length - 1];

  return (
    <section className="card mf-panel" aria-label={title}>
      <div className="mf-panel-head">
        <div>
          <h2>{title}</h2>
          <p className="mf-basis">
            If ₹100 had been invested at the start of the range. Time-weighted, so money you add later is not counted as return; indices are price indices and exclude dividends.{" "}
            {end ? (
              <>
                Now: <strong>{set.subjectLabel} {end.s.toFixed(1)}</strong>
                {set.benchmarks.map((b, j) => (
                  <span key={b.label}>
                    {" "}
                    · {prettyBench(b.label)} {Number(end[`b${j}`]).toFixed(1)}
                  </span>
                ))}
              </>
            ) : null}
          </p>
        </div>
        <div className="fund-range" role="group" aria-label="Time range">
          {OVERLAY_RANGES.map((r) => (
            <button key={r.id} type="button" aria-pressed={range === r.id} disabled={!fits(r.years)} title={fits(r.years) ? undefined : "Not enough history for this range"} onClick={() => setRange(r.id)}>
              {r.id}
            </button>
          ))}
        </div>
      </div>
      <div className="fund-plot">
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={shortDate} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} minTickGap={36} />
            <YAxis tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]} />
            <ReferenceLine y={100} stroke={INK} strokeOpacity={0.25} strokeDasharray="3 3" />
            <Tooltip
              cursor={{ stroke: MUTED, strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as Record<string, number> | undefined) : undefined;
                if (!row) return null;
                return (
                  <div className="fund-tip">
                    <strong>{longDate(row.t)}</strong>
                    <span>
                      <i style={{ background: SUBJECT_COLOR }} /> {set.subjectLabel} <b>{row.s.toFixed(1)}</b>
                    </span>
                    {set.benchmarks.map((b, j) => (
                      <span key={b.label}>
                        <i style={{ background: benchColor(b.label, j) }} /> {prettyBench(b.label)} <b>{Number(row[`b${j}`]).toFixed(1)}</b>
                      </span>
                    ))}
                  </div>
                );
              }}
            />
            <Line type="monotone" dataKey="s" stroke={SUBJECT_COLOR} strokeWidth={2.2} dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={!reduce} animationDuration={400} />
            {set.benchmarks.map((b, j) => (
              <Line key={b.label} type="monotone" dataKey={`b${j}`} stroke={benchColor(b.label, j)} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} isAnimationActive={!reduce} animationDuration={400} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="alloc-legend mf-legend">
        <li>
          <i style={{ background: SUBJECT_COLOR }} />
          <span>{set.subjectLabel}</span>
        </li>
        {set.benchmarks.map((b, j) => (
          <li key={b.label}>
            <i style={{ background: benchColor(b.label, j) }} />
            <span>{prettyBench(b.label)}</span>
          </li>
        ))}
      </ul>
      <GapNote gaps={["category-average"]}>No category-average line is drawn, because there is no data behind one.</GapNote>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Down markets

function Fall({ label, sub, result, benchName }: { label: string; sub: string; result: WindowResult; benchName: string }) {
  const worst = Math.min(result.subject, result.bench ?? 0, -0.0001);
  const w = (v: number) => `${Math.min(100, (Math.abs(Math.min(v, 0)) / Math.abs(worst)) * 100)}%`;
  const gentler = result.bench != null ? result.subject > result.bench : null;
  return (
    <li className="mf-fall">
      <div className="mf-fall-head">
        <strong>{label}</strong>
        <span className="muted">{sub}</span>
      </div>
      <div className="mf-fall-bars" role="img" aria-label={`You ${signedFrac(result.subject)}${result.bench != null ? `, ${benchName} ${signedFrac(result.bench)}` : ""}`}>
        <span>You</span>
        <i className="mf-fall-track">
          <i className={`mf-fall-fill ${result.subject < 0 ? "bear" : "bull"}`} style={{ width: result.subject < 0 ? w(result.subject) : "2px" }} />
        </i>
        <b className={result.subject < 0 ? "bear" : "bull"}>{signedFrac(result.subject)}</b>
        {result.bench != null ? (
          <>
            <span>{benchName}</span>
            <i className="mf-fall-track">
              <i className="mf-fall-fill bench" style={{ width: result.bench < 0 ? w(result.bench) : "2px" }} />
            </i>
            <b>{signedFrac(result.bench)}</b>
          </>
        ) : null}
      </div>
      {gentler != null ? (
        <p className={`mf-fall-verdict ${gentler ? "bull" : "bear"}`}>
          {gentler
            ? `Fell ${frac(Math.abs((result.bench as number) - result.subject))} less than ${benchName}.`
            : `Fell ${frac(Math.abs((result.bench as number) - result.subject))} more than ${benchName}.`}
        </p>
      ) : null}
    </li>
  );
}

export function DownMarketsPanel({ source, title = "How it did in down markets" }: { source: AnalyticsSource; title?: string }) {
  if (source.state !== "ready") return <NotReady source={source} title={title} height={120} />;
  const { set } = source;
  const benchLabel = benchOf(set);
  const benchName = prettyBench(benchLabel);
  const named = MARKET_DRAWDOWNS.map((m) => ({ m, r: windowReturn(set, parseDay(m.from), parseDay(m.to), benchLabel) })).filter(
    (x): x is { m: (typeof MARKET_DRAWDOWNS)[number]; r: WindowResult } => x.r != null,
  );
  const benchPoints = set.benchmarks.find((b) => b.label === benchLabel)?.points;
  const worst = benchPoints ? maxDrawdown(benchPoints) : null;
  const worstResult = worst && worst.depth <= -0.05 ? windowReturn(set, worst.peak, worst.trough, benchLabel) : null;
  const duplicate = worstResult && named.some((x) => Math.abs(x.r.from - worstResult.from) < 45 * 86_400_000);
  const items: ReactNode[] = named.map(({ m, r }) => <Fall key={m.id} label={m.label} sub={`${monthYear(r.from)} – ${monthYear(r.to)}`} result={r} benchName={benchName} />);
  if (worstResult && !duplicate) {
    items.push(<Fall key="worst" label={`Largest ${benchName} fall in this history`} sub={`${longDate(worstResult.from)} – ${longDate(worstResult.to)}`} result={worstResult} benchName={benchName} />);
  }
  const start = set.subject[0].t;

  return (
    <section className="card mf-panel" aria-label={title}>
      <h2>{title}</h2>
      {items.length ? (
        <>
          <p className="mf-basis">
            Peak-to-trough windows of broad sell-offs, measured on the same marks as the rest of this page. Marks are about {Math.round(set.step / DAY)} days apart, so the exact
            peak and trough days can fall between them and the falls read slightly shallower than the index&apos;s worst day.
          </p>
          <ul className="mf-falls">{items}</ul>
        </>
      ) : (
        <p className="muted mf-empty-line">
          This history starts {longDate(start)}. None of the tracked sell-offs ({MARKET_DRAWDOWNS.map((m) => m.label).join(", ")}) fall inside it, and {benchName} has not dropped
          5% or more since, so there is no down market to show yet.
        </p>
      )}
    </section>
  );
}
