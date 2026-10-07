"use client";

import { useMemo } from "react";
import { DAY, type SeriesSet } from "@/lib/funds/analytics";
import { longDate, monthYear, shortDate, signedFrac } from "@/lib/funds/format";
import { RANGES, rebase, trailing, type RangeId } from "@/lib/funds/viz";
import { benchColor, PREFERRED_BENCH } from "../chartTheme";
import { LinesChart, type LineSeries } from "../viz/LinesChart";
import { TipRow } from "../viz/Tip";
import { VIZ } from "../viz/theme";

const WINDOWS = [
  { years: 1, label: "1Y" },
  { years: 3, label: "3Y" },
  { years: 5, label: "5Y" },
] as const;

const pretty = (label: string) => label.replace("NIFTY", "Nifty");

/**
 * The portfolio against the market, two ways: trailing returns in a small table and the growth of ₹100
 * since the start of the chosen range. Both are time-weighted, so money you added is not counted as return.
 */
export function PerformancePanel({ series, range, status }: { series: SeriesSet | null; range: RangeId; status: "loading" | "error" | "empty" | "ready"; }) {
  const bench = series ? (series.benchmarks.find((b) => b.label === PREFERRED_BENCH) ?? series.benchmarks[0] ?? null) : null;

  const lines = useMemo<LineSeries[]>(() => {
    if (!series) return [];
    const last = series.subject[series.subject.length - 1]?.t ?? 0;
    const days = RANGES.find((r) => r.id === range)?.days ?? null;
    const from = days == null ? series.subject[0].t : Math.max(series.subject[0].t, last - days * DAY);
    const subject = rebase(series.subject, from);
    if (subject.length < 2) return [];
    const out: LineSeries[] = [{ id: "portfolio", label: "Portfolio", color: VIZ.teal, points: subject, area: true, width: 2.2 }];
    series.benchmarks.forEach((b, i) => {
      const pts = rebase(b.points, from);
      if (pts.length === subject.length) out.push({ id: b.label, label: pretty(b.label), color: benchColor(b.label, i), points: pts, dash: i === 0 ? "5 4" : "2 3", width: 1.5 });
    });
    return out;
  }, [series, range]);

  if (status === "loading") return <section className="vz-section"><h2 className="vz-h">Performance</h2><div className="skel vz-plot-skel" aria-label="Loading performance" /></section>;
  if (!series) {
    return (
      <section className="vz-section" aria-label="Performance against the market">
        <h2 className="vz-h">Performance</h2>
        <p className="vz-unavailable">{status === "error" ? "Unavailable: the analysis could not load." : "Insufficient history: this appears once a holding has two weekly marks after its purchase date."}</p>
      </section>
    );
  }

  return (
    <section className="vz-section" aria-label="Performance against the market">
      <h2 className="vz-h">Performance</h2>
      <table className="vz-ptable">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Portfolio</th>
            <th scope="col">{bench ? pretty(bench.label) : "Benchmark"}</th>
          </tr>
        </thead>
        <tbody>
          {WINDOWS.map((w) => {
            const mine = trailing(series.subject, w.years, series);
            const theirs = bench ? trailing(bench.points, w.years, series) : null;
            const cell = (r: ReturnType<typeof trailing>) => (r ? <span className={r.value >= 0 ? "bull" : "bear"}>{signedFrac(r.value)}</span> : <span className="vz-na">Insufficient history</span>);
            return (
              <tr key={w.label}>
                <th scope="row">
                  {w.label}
                  <small>{w.years > 1 ? "a year" : "total"}</small>
                </th>
                <td>{cell(mine)}</td>
                <td>{bench ? cell(theirs) : <span className="vz-na">Unavailable</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {lines.length ? (
        <>
          <p className="vz-sub">Growth of ₹100 over the chosen range</p>
          <LinesChart
            series={lines}
            height={210}
            baseline={100}
            yFormat={(v) => `₹${v.toFixed(0)}`}
            xFormat={lines[0].points.length > 1 && lines[0].points[lines[0].points.length - 1].t - lines[0].points[0].t > 200 * DAY ? monthYear : shortDate}
            title={(t) => longDate(t)}
            ariaLabel="Growth of ₹100, portfolio against the market"
            drawKey={`g:${range}`}
            rows={(_, values) => (
              <>
                {lines.map((l) => (values[l.id] != null ? <TipRow key={l.id} color={l.color} label={l.label} value={`₹${(values[l.id] as number).toFixed(1)}`} /> : null))}
              </>
            )}
          />
          <p className="vz-hint">Time-weighted from the start of the range, so every line begins at ₹100 and new money is not counted as return. Benchmarks are price indices: dividends are not included.</p>
        </>
      ) : null}
    </section>
  );
}
