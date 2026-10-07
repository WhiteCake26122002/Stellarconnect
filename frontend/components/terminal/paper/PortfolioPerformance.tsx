"use client";

import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { rebaseBenchmark, RANGES, sliceHistory, type EquityPoint, type RangeId } from "@/lib/trading/analytics";
import { compactInr, inr, pct, signedInr } from "@/lib/trading/format";
import { useReducedMotion } from "@/lib/motion";
import type { Candle } from "@/lib/trading/types";
import { Delta, EmptyState, ErrorState, SkeletonBlock } from "./ui";

const TEAL = "#111111";
const BENCH = "#8a9694";

type Datum = { t: number; v: number; b?: number };

const stamp = (t: number, range: RangeId) =>
  range === "1D"
    ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", ...(range === "1Y" || range === "ALL" ? { year: "2-digit" } : {}) });

/**
 * How has my portfolio performed? The value of the account over time from the readings saved on this device, with the
 * NIFTY 50 rebased to the same start when real index data is available. A range with fewer than two readings is
 * disabled rather than drawn from nothing; a range longer than the history says how far back the history goes.
 */
export function PortfolioPerformance({
  history,
  benchmark,
  benchmarkState,
  hasTrades,
  value,
  onRetryBenchmark,
}: {
  history: EquityPoint[];
  /** Real daily NIFTY bars; null when the feed has none (the chart then shows the portfolio alone). */
  benchmark: Candle[] | null;
  benchmarkState: "loading" | "ok" | "unavailable";
  hasTrades: boolean;
  value: number;
  onRetryBenchmark?: () => void;
}) {
  const reduce = useReducedMotion();
  const [range, setRange] = useState<RangeId>("ALL");
  const now = Date.now();
  const views = useMemo(() => Object.fromEntries(RANGES.map((r) => [r, sliceHistory(history, r, now)])) as Record<RangeId, ReturnType<typeof sliceHistory>>, [history, now]);
  const view = views[range];
  const bench = useMemo(() => (range === "1D" || !benchmark ? [] : rebaseBenchmark(view.points, benchmark)), [range, benchmark, view.points]);
  const data: Datum[] = useMemo(() => {
    const b = new Map(bench.map((p) => [p.t, p.v]));
    return view.points.map((p) => ({ t: p.t, v: p.v, b: b.get(p.t) }));
  }, [view.points, bench]);
  const benchChange = bench.length >= 2 ? bench[bench.length - 1].v / bench[0].v - 1 : null;
  const portfolioChange = view.changePct;

  if (!hasTrades && history.length < 2) {
    return <EmptyState title="Your portfolio value starts here" body="Make your first paper trade and this chart will track your account as the prices move." />;
  }

  const lo = data.length ? Math.min(...data.flatMap((d) => (d.b != null ? [d.v, d.b] : [d.v]))) : 0;
  const hi = data.length ? Math.max(...data.flatMap((d) => (d.b != null ? [d.v, d.b] : [d.v]))) : 1;
  const pad = (hi - lo || hi * 0.01 || 1) * 0.15;
  const summary = view.points.length >= 2 ? `Portfolio value ${inr(view.points[0].v, 0)} to ${inr(view.points[view.points.length - 1].v, 0)} over ${range}, a change of ${signedInr(view.change, 0)}.` : "Not enough readings to draw this range yet.";

  return (
    <div className="pt-perf">
      <div className="pt-perf-top">
        <div>
          <b className="pt-perf-value">
            <AnimatedNumber value={value} format={(n) => inr(n, 0)} />
          </b>
          {view.points.length >= 2 ? (
            <Delta value={view.change} text={`${signedInr(view.change, 0)}${portfolioChange != null ? ` (${pct(portfolioChange)})` : ""}`} />
          ) : null}
          <small className="pt-muted">
            {view.from != null && view.points.length >= 2 ? `${range === "ALL" ? "Since" : view.partial ? "Since" : "Over"} ${stamp(view.from, range === "1D" ? "1D" : "1W")}${view.partial ? ` · history is shorter than ${range}` : ""}` : "Not enough readings in this range"}
          </small>
        </div>
        <div className="pt-ranges" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} disabled={r !== "ALL" && views[r].points.length < 2} title={views[r].points.length < 2 && r !== "ALL" ? "Not enough history for this range yet" : undefined} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {benchmarkState === "loading" && range !== "1D" ? (
        <p className="pt-fine">Loading the NIFTY 50 for comparison…</p>
      ) : benchChange != null ? (
        <p className="pt-fine pt-bench-note">
          <i aria-hidden /> NIFTY 50 over the same period <b>{pct(benchChange)}</b>, rebased to your starting value
        </p>
      ) : range !== "1D" && view.points.length >= 2 ? (
        <p className="pt-fine">{benchmarkState === "unavailable" ? "No index comparison: NIFTY 50 history isn’t available right now." : "No index comparison for this range."}{onRetryBenchmark && benchmarkState === "unavailable" ? <button type="button" className="pt-link" onClick={onRetryBenchmark}> Try again</button> : null}</p>
      ) : null}
      {view.anySimulated ? <p className="pt-fine pt-sim">Some readings in this range used simulated prices.</p> : null}

      {data.length >= 2 ? (
        <div className="pt-chart" role="img" aria-label={summary}>
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pt-perf-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TEAL} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(19, 19, 19,0.07)" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(t: number) => stamp(t, range)} tick={{ fontSize: 10, fill: "#5d6665" }} tickLine={false} axisLine={false} minTickGap={36} />
              <YAxis domain={[lo - pad, hi + pad]} tickFormatter={(v: number) => compactInr(v)} tick={{ fontSize: 10, fill: "#5d6665" }} tickLine={false} axisLine={false} width={54} />
              <Tooltip
                cursor={{ stroke: "#131313", strokeOpacity: 0.25, strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as Datum;
                  return (
                    <div className="pt-tip" role="tooltip">
                      <strong>{new Date(d.t).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</strong>
                      <span>
                        <i style={{ background: TEAL }} /> Portfolio <b>{inr(d.v, 0)}</b>
                      </span>
                      {d.b != null ? (
                        <span>
                          <i style={{ background: BENCH }} /> NIFTY 50 (rebased) <b>{inr(d.b, 0)}</b>
                        </span>
                      ) : null}
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="v" stroke={TEAL} strokeWidth={2} fill="url(#pt-perf-fill)" dot={false} isAnimationActive={!reduce} animationDuration={700} animationEasing="ease-out" />
              {bench.length ? <Line type="monotone" dataKey="b" stroke={BENCH} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={!reduce} animationDuration={700} /> : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState title="Collecting readings" body="The chart needs at least two readings of your portfolio value. They are saved while this page is open, about every few minutes." />
      )}
    </div>
  );
}

export function PerformanceLoading() {
  return <SkeletonBlock rows={4} label="Loading portfolio performance" />;
}

export function PerformanceError({ onRetry }: { onRetry: () => void }) {
  return <ErrorState title="Unable to load your portfolio history" body="We couldn’t read the saved value history on this device." onRetry={onRetry} />;
}
