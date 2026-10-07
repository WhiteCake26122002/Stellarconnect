"use client";

import { useMemo, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import type { FundHistory, FundHolding } from "@/lib/api";
import { DAY, type SeriesSet } from "@/lib/funds/analytics";
import { longDate, monthYear, rupees, shortDate, signedPoints, signedRupees, tone } from "@/lib/funds/format";
import type { BenchView, ReturnView } from "@/lib/funds/returns";
import { RANGES, rangeUsable, rebase, type RangeId } from "@/lib/funds/viz";
import { benchColor } from "../chartTheme";
import { RangeTabs } from "../overview/OverviewHero";
import { LinesChart, type LineSeries } from "../viz/LinesChart";
import { TipRow } from "../viz/Tip";
import { VIZ } from "../viz/theme";

const pretty = (label: string) => label.replace("NIFTY", "Nifty");

/**
 * The top of a fund's page: what your holding is worth (or the latest NAV, if you do not hold it), what it
 * has returned, and the fund's growth of ₹100 against its own benchmark, from the fund's published NAV.
 */
export function FundHero({
  holding,
  nav,
  navDate,
  total,
  ret,
  bench,
  history,
  loading,
  set,
}: {
  holding: FundHolding | null;
  nav: number | null;
  navDate: string | null;
  total: number;
  ret: ReturnView;
  bench: BenchView;
  history: FundHistory | null;
  loading: boolean;
  set: SeriesSet | null;
}) {
  const [picked, setPicked] = useState<RangeId | null>(null);
  const first = set?.subject[0]?.t ?? 0;
  const last = set ? (set.subject[set.subject.length - 1]?.t ?? 0) : 0;
  const count = set?.subject.length ?? 0;
  const usable = (id: RangeId) => rangeUsable(first, last, RANGES.find((r) => r.id === id)?.days ?? null, count);
  const range: RangeId = picked && usable(picked) ? picked : usable("1Y") ? "1Y" : "MAX";
  const days = RANGES.find((r) => r.id === range)?.days ?? null;

  const lines = useMemo<LineSeries[]>(() => {
    if (!set) return [];
    const from = days == null ? first : Math.max(first, last - days * DAY);
    const subject = rebase(set.subject, from);
    if (subject.length < 2) return [];
    const out: LineSeries[] = [{ id: "fund", label: "Fund", color: VIZ.teal, points: subject, area: true, width: 2.2 }];
    set.benchmarks.forEach((b, i) => {
      const pts = rebase(b.points, from);
      if (pts.length === subject.length) out.push({ id: b.label, label: pretty(b.label), color: benchColor(b.label, i), points: pts, dash: "5 4", width: 1.5 });
    });
    return out;
  }, [set, days, first, last]);

  const endV = lines[0]?.points[lines[0].points.length - 1]?.v ?? null;
  const change = endV != null ? endV / 100 - 1 : null;
  const long = lines[0] ? lines[0].points[lines[0].points.length - 1].t - lines[0].points[0].t > 200 * DAY : false;

  return (
    <section className="vz-hero vz-fund-hero" aria-label="Fund value and growth">
      <div className="vz-hero-top">
        <div className="vz-hero-fig">
          <p className="vz-eyebrow">{holding ? "Your value" : "Latest NAV"}</p>
          <p className="vz-value">
            {holding ? <AnimatedNumber value={holding.value} format={(v) => rupees(v, 0)} /> : nav == null ? "n/a" : rupees(nav, 2)}
          </p>
          <p className="vz-gainline">
            {holding ? (
              <>
                <span className={`vz-chip ${tone(holding.gain)}`}>
                  {signedRupees(holding.gain)} · {signedPoints(holding.gain_pct)}
                </span>
                <span className="muted">
                  {total > 0 ? `${((holding.value / total) * 100).toFixed(1)}% of your portfolio · ` : ""}
                  {holding.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })} units
                </span>
              </>
            ) : (
              <span className="muted">NAV as of {navDate ?? "the latest date"}. Not in your portfolio.</span>
            )}
          </p>
        </div>
        {holding ? (
          <div className="vz-hero-xirr">
            <p className="vz-eyebrow">{ret.annualized ? "XIRR" : "Since purchase"}</p>
            <p className={`vz-xirr ${tone(ret.value)}`}>
              {signedPoints(ret.value)}
              <small>
                {ret.annualized ? "a year" : "not annualized"}
                {bench.available ? ` · ${pretty(bench.label ?? "benchmark")} ${signedPoints(bench.value)}` : ""}
              </small>
            </p>
          </div>
        ) : (
          <div />
        )}
        <RangeTabs value={range} onChange={setPicked} usable={usable} />
      </div>

      {loading ? (
        <div className="skel vz-plot-skel" aria-label="Loading NAV history" />
      ) : lines.length ? (
        <>
          <LinesChart
            series={lines}
            height={280}
            baseline={100}
            yFormat={(v) => `₹${v.toFixed(0)}`}
            xFormat={long ? monthYear : shortDate}
            title={(t) => longDate(t)}
            ariaLabel="Growth of ₹100 in the fund against its benchmark"
            drawKey={`f:${range}`}
            rows={(_, values) => (
              <>
                {lines.map((l) => (values[l.id] != null ? <TipRow key={l.id} color={l.color} label={l.label} value={`₹${(values[l.id] as number).toFixed(1)}`} /> : null))}
              </>
            )}
          />
          <div className="vz-chart-foot">
            <p className="vz-range-gain">
              Growth of ₹100 over this range{" "}
              {change != null ? (
                <b className={change >= 0 ? "bull" : "bear"}>
                  ₹{(100 * (1 + change)).toFixed(1)} ({signedPoints(change * 100)})
                </b>
              ) : null}
            </p>
          </div>
          <p className="vz-hint">
            {history?.benchmark ? (
              <>
                Benchmark: {pretty(history.benchmark.label)}
                {history.benchmark.proxy ? ` (a stand-in: ${history.benchmark.note})` : ""}. {history.benchmark.basis} Category average: unavailable, the free data source has no category series.
              </>
            ) : (
              <>No benchmark line: {history?.benchmark_reason ?? "none is available for this scheme."} Category average: unavailable.</>
            )}{" "}
            NAV is after the fund&apos;s running costs; for IDCW plans it also drops whenever income is paid out.
          </p>
        </>
      ) : (
        <p className="vz-note">{history ? "Insufficient history to draw this range." : "Unavailable: the NAV history could not be loaded."}</p>
      )}
    </section>
  );
}
