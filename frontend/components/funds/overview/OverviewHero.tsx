"use client";

import { useMemo, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import type { FundAnalysis, FundPortfolio } from "@/lib/api";
import { longDate, monthYear, rupees, rupeesCompact, shortDate, signedPoints, signedRupees, tone } from "@/lib/funds/format";
import { RANGES, rangeUsable, type RangeId } from "@/lib/funds/viz";
import { DAY } from "@/lib/funds/analytics";
import { LinesChart, type LineSeries } from "../viz/LinesChart";
import { TipRow } from "../viz/Tip";
import { VIZ } from "../viz/theme";

type Row = { t: number; portfolio: number | null; invested: number | null; n500: number | null; profit: number | null };

export function RangeTabs({ value, onChange, usable }: { value: RangeId; onChange: (id: RangeId) => void; usable: (id: RangeId) => boolean }) {
  return (
    <div className="vz-ranges" role="group" aria-label="Time range">
      {RANGES.map((r) => {
        const ok = usable(r.id);
        return (
          <button key={r.id} type="button" aria-pressed={value === r.id} disabled={!ok} title={ok ? undefined : "Not enough history for this range yet"} onClick={() => onChange(r.id)}>
            {r.id === "MAX" ? "Max" : r.id}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The first thing on the page: what the portfolio is worth, what it has made, and the path it took.
 * The gain for a range is profit made inside it, so money added during the range is never read as return.
 */
export function OverviewHero({
  book,
  report,
  busy,
  range,
  setRange,
  usable,
}: {
  book: FundPortfolio;
  report: FundAnalysis | null;
  busy: boolean;
  range: RangeId;
  setRange: (id: RangeId) => void;
  usable: (id: RangeId) => boolean;
}) {
  const { totals } = book;
  const [showBench, setShowBench] = useState(false);
  const [showInvested, setShowInvested] = useState(true);
  const blocked = report?.blocked ?? [];

  const all = useMemo<Row[]>(
    () =>
      (report?.growth ?? [])
        .map((p) => ({
          t: new Date(`${p.date}T00:00:00`).getTime(),
          portfolio: p.portfolio,
          invested: p.invested ?? null,
          n500: p.benchmarks["NIFTY 500"] ?? null,
          profit: p.portfolio != null && p.invested != null ? p.portfolio - p.invested : null,
        }))
        .filter((r) => Number.isFinite(r.t))
        .sort((a, b) => a.t - b.t),
    [report],
  );
  const days = RANGES.find((r) => r.id === range)?.days ?? null;
  const last = all.length ? all[all.length - 1].t : 0;
  const rows = days == null || !usable(range) ? all : all.filter((r) => r.t >= last - days * DAY);
  const hasBench = rows.some((r) => r.n500 != null);

  const start = rows.find((r) => r.profit != null);
  const end = [...rows].reverse().find((r) => r.profit != null);
  const moved = start && end ? (end.profit as number) - (start.profit as number) : null;
  const base = start && end ? (start.portfolio as number) + ((end.invested as number) - (start.invested as number)) : null;
  const movedPct = moved != null && base && base > 0 ? (moved / base) * 100 : null;
  const added = start && end ? (end.invested as number) - (start.invested as number) : 0;

  const xirr = report?.portfolio?.xirr;
  const xirrShown = xirr && xirr.annualized && xirr.value != null && !blocked.includes("xirr");

  const series: LineSeries[] = [
    { id: "portfolio", label: "Portfolio", color: VIZ.teal, points: rows.map((r) => ({ t: r.t, v: r.portfolio })), area: true, width: 2.2 },
    ...(showInvested ? [{ id: "invested", label: "Invested", color: VIZ.grey, points: rows.map((r) => ({ t: r.t, v: r.invested })), dash: "5 4", width: 1.4, step: true }] : []),
    ...(showBench && hasBench ? [{ id: "n500", label: "Nifty 500, same rupees", color: VIZ.gold, points: rows.map((r) => ({ t: r.t, v: r.n500 })), dash: "2 3", width: 1.6 }] : []),
  ];
  const byT = new Map(rows.map((r) => [r.t, r]));
  const spanDays = rows.length > 1 ? (rows[rows.length - 1].t - rows[0].t) / DAY : 0;
  const empty = !book.holdings.length;

  return (
    <section className="vz-hero" aria-label="Portfolio value over time">
      <div className="vz-hero-top">
        <div className="vz-hero-fig">
          <p className="vz-eyebrow">Portfolio value</p>
          <p className="vz-value">
            <AnimatedNumber value={totals.value} format={(v) => rupees(v, 0)} />
          </p>
          <p className="vz-gainline">
            <span className={`vz-chip ${tone(totals.gain)}`}>
              {signedRupees(totals.gain)} · {signedPoints(totals.gain_pct)}
            </span>
            <span className="muted">since you started, on {rupees(totals.invested, 0)} invested</span>
          </p>
        </div>
        <div className="vz-hero-xirr">
          <p className="vz-eyebrow">XIRR</p>
          {xirrShown ? (
            <p className={`vz-xirr ${tone(xirr.value)}`}>
              {signedPoints(xirr.value)}
              <small> a year</small>
            </p>
          ) : (
            <p className="vz-xirr na" title={xirr?.note}>
              Unavailable
              <small>{report ? (xirr?.status === "short_history" ? "Needs about a year of holding" : (xirr?.note ?? "Needs more history")) : "Working it out…"}</small>
            </p>
          )}
        </div>
        <RangeTabs value={range} onChange={setRange} usable={usable} />
      </div>

      {empty ? null : blocked.includes("growth") ? (
        <p className="vz-note">Withheld: the chart ended at a different value from the portfolio total, so it is not drawn until the two agree.</p>
      ) : rows.length < 2 ? (
        busy || !report ? (
          <div className="skel vz-plot-skel" aria-label="Loading the value path" />
        ) : (
          <p className="vz-note">A path appears once a holding has at least a week of NAV history after its purchase date.</p>
        )
      ) : (
        <>
          <LinesChart
            series={series}
            height={300}
            yFormat={rupeesCompact}
            xFormat={spanDays > 200 ? monthYear : shortDate}
            title={(t) => longDate(t)}
            ariaLabel="Portfolio value over time"
            drawKey={`${range}:${showInvested}:${showBench}`}
            rows={(t, values) => {
              const row = byT.get(t);
              return (
                <>
                  <TipRow color={VIZ.teal} label="Portfolio" value={values.portfolio == null ? "n/a" : rupees(values.portfolio, 0)} />
                  {row?.invested != null ? <TipRow color={VIZ.grey} label="Invested" value={rupees(row.invested, 0)} /> : null}
                  {row?.profit != null ? <TipRow label="Gain" value={signedRupees(row.profit)} tone={row.profit >= 0 ? "bull" : "bear"} /> : null}
                  {values.n500 != null ? <TipRow color={VIZ.gold} label="Nifty 500" value={rupees(values.n500, 0)} /> : null}
                </>
              );
            }}
          />
          <div className="vz-chart-foot">
            <div className="vz-toggles" role="group" aria-label="Lines on the chart">
              <button type="button" aria-pressed={showInvested} onClick={() => setShowInvested((v) => !v)}>
                <i style={{ background: VIZ.grey }} /> Invested
              </button>
              {hasBench ? (
                <button type="button" aria-pressed={showBench} onClick={() => setShowBench((v) => !v)}>
                  <i style={{ background: VIZ.gold }} /> Nifty 500, same rupees
                </button>
              ) : null}
            </div>
            {moved != null ? (
              <p className="vz-range-gain">
                Made in this range{" "}
                <b className={moved >= 0 ? "bull" : "bear"}>
                  {signedRupees(moved)}
                  {movedPct != null ? ` (${signedPoints(movedPct)})` : ""}
                </b>
                {added > 1 ? <span className="muted"> after setting aside {rupees(added, 0)} of new money</span> : null}
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

export { rangeUsable };
