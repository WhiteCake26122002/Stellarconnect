"use client";

import Link from "next/link";
import { ReactNode } from "react";
import type { FundAnalysis, FundHolding } from "@/lib/api";
import { longDate, rupees, signedPoints, signedRupees, tone } from "@/lib/funds/format";
import { parseDay } from "@/lib/funds/analytics";
import { benchView, pts, returnView, spanText, VERDICT_LABEL, verdictTone } from "@/lib/funds/returns";
import { GapNote } from "./FundAtoms";

type Report = FundAnalysis & { portfolio: NonNullable<FundAnalysis["portfolio"]>; period: NonNullable<FundAnalysis["period"]> };

const date = (iso: string) => longDate(parseDay(iso));

/** "Why this number?": the inputs behind a figure, one click away and never in the way. */
export function Why({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="mf-why">
      <summary aria-label={`Why this number? ${label}`}>Why this number?</summary>
      <div>{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------

export function PeriodBanner({ report }: { report: Report }) {
  const { period } = report;
  return (
    <p className="mf-period" role="note">
      <strong>Measured over</strong> {period.label}. NAVs as of {date(report.as_of ?? period.end)}.
      {period.annualizable ? "" : " Under a year, so returns are shown as plain gains, not annualized."}
    </p>
  );
}

export function ChecksBanner({ report }: { report: Report }) {
  const blocking = report.checks.filter((c) => c.status === "block");
  const warns = report.checks.filter((c) => c.status === "warn");
  if (!blocking.length && !warns.length) return null;
  return (
    <div className={`banner ${blocking.length ? "bad" : "warn"} mf-checks`} role="status">
      <strong>{blocking.length ? "Some figures were withheld because they disagreed with each other." : "Worth knowing about the data."}</strong>
      <ul>
        {[...blocking, ...warns].map((c) => (
          <li key={c.id}>{c.message}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function SnapshotSection({ report }: { report: Report }) {
  const p = report.portfolio;
  const x = p.xirr;
  const blocked = report.blocked ?? [];
  const showX = x.annualized && x.value != null && !blocked.includes("xirr");
  const flowText = `${p.transactions} dated ${p.transactions === 1 ? "purchase" : "purchases"}${p.realised_proceeds > 0 ? " and redemptions" : ""}`;
  return (
    <section className="mf-section-block" aria-labelledby="mf-snap-t">
      <h2 id="mf-snap-t" className="mf-block-title">
        Portfolio snapshot
      </h2>
      <div className="funds-kpis mf-kpis-4">
        <article className="kpi">
          <div className="kpi-top">Current value</div>
          <div className="v">{rupees(p.value, 0)}</div>
          <div className="kpi-foot">
            <span className="muted">Units × latest NAV</span>
          </div>
          <Why label="Current value">Each fund&apos;s units multiplied by the latest published AMFI NAV, as of {date(report.as_of ?? report.period.end)}, added up.</Why>
        </article>
        <article className="kpi">
          <div className="kpi-top">Invested</div>
          <div className="v">{rupees(p.total_invested, 0)}</div>
          <div className="kpi-foot">
            <span className="muted">{p.realised_proceeds > 0 ? `${rupees(p.realised_proceeds, 0)} already redeemed` : "Units × the NAV you paid"}</span>
          </div>
          <Why label="Invested">The sum of units × purchase NAV over {flowText}, from {date(report.period.start)}.</Why>
        </article>
        <article className="kpi">
          <div className="kpi-top">Gain / loss</div>
          <div className={`v ${tone(p.gain)}`}>{signedRupees(p.gain).replace(/\.\d\d$/, "")}</div>
          <div className="kpi-foot">
            <span className={`delta ${tone(p.absolute_return_pct)}`}>{signedPoints(p.absolute_return_pct, 2)}</span>
            <span className="muted"> · absolute return</span>
          </div>
          <Why label="Gain or loss">
            Value {rupees(p.value, 0)}
            {p.realised_proceeds > 0 ? ` plus ${rupees(p.realised_proceeds, 0)} redeemed` : ""} minus {rupees(p.total_invested, 0)} invested, divided by the amount invested. Not annualized and not adjusted for when money went in.
          </Why>
        </article>
        <article className="kpi">
          <div className="kpi-top">{showX ? "XIRR (annualized)" : "Annualized return"}</div>
          <div className={`v ${showX ? tone(x.value) : "muted"}`}>{showX ? signedPoints(x.value, 1) : "Not yet"}</div>
          <div className="kpi-foot">
            <span className="muted">{showX ? "Your own annual return" : `Needs at least a year; this is ${spanText(report.period.days)}`}</span>
          </div>
          <Why label="XIRR">
            {showX
              ? `Solved from ${flowText} between ${date(report.period.start)} and ${date(report.period.end)}, with today's value as the closing amount. It is a personal, money-weighted return: when you invested changes it.`
              : x.note}
            {p.transactions_source === "aggregated" ? " One or more holdings only record a single purchase date, so this treats all their units as bought that day." : ""}
          </Why>
        </article>
      </div>
      <p className="mf-basis">
        <strong>Three different returns, on purpose.</strong> The gain above is a simple absolute return. XIRR is annualized and depends on when you added money. The time-weighted return below measures the portfolio itself, ignoring when you added money, and is what to compare with an index.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export function BenchmarkSection({ report }: { report: Report }) {
  const p = report.portfolio;
  return (
    <section className="card mf-panel" aria-labelledby="mf-bench-t">
      <h2 id="mf-bench-t">Portfolio against the market</h2>
      <p className="mf-basis">
        The same rupees put in on the same dates, over <strong>{report.period.label}</strong>. Each index is a broad-market reference; every fund&apos;s own benchmark is in the table below.
      </p>
      <div className="mf-table-wrap">
        <table className="mf-bench-table">
          <thead>
            <tr>
              <th scope="col">Measured against</th>
              <th scope="col" className="num">
                Return
              </th>
              <th scope="col" className="num">
                Your portfolio vs it
              </th>
              <th scope="col">Reading</th>
            </tr>
          </thead>
          <tbody>
            <tr className="mf-row-self">
              <th scope="row">Your portfolio, absolute return</th>
              <td className={`num ${tone(p.absolute_return_pct)}`} data-label="Return">
                {signedPoints(p.absolute_return_pct, 2)}
              </td>
              <td className="num" data-label="vs it">—</td>
              <td data-label="Reading" className="muted">
                {p.twr_pct != null ? `Time-weighted ${signedPoints(p.twr_pct, 2)}` : ""}
              </td>
            </tr>
            {report.benchmarks.map((b) => (
              <tr key={b.key}>
                <th scope="row">
                  {b.label}
                  <small>same rupees, same dates</small>
                </th>
                <td className={`num ${tone(b.return_pct)}`} data-label="Return">
                  {b.return_pct == null ? "Unavailable" : signedPoints(b.return_pct, 2)}
                </td>
                <td className={`num ${verdictTone(b.verdict)}`} data-label="vs it">
                  {b.relative_pp == null ? "n/a" : pts(b.relative_pp)}
                </td>
                <td data-label="Reading">{b.return_pct == null ? "Index history does not cover this period." : b.verdict_text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GapNote gaps={["benchmark-levels"]}>Indices are price indices (dividends excluded), so a total-return index would read slightly higher.</GapNote>
    </section>
  );
}

export function FundsVsBenchmark({ report }: { report: Report }) {
  const blocked = report.blocked ?? [];
  const funds = [...report.funds].sort((a, b) => b.value - a.value);
  if (blocked.includes("fund-vs-benchmark")) {
    return (
      <section className="card mf-panel">
        <h2>Each fund against its own benchmark</h2>
        <p className="muted mf-empty-line">Withheld: the comparison windows did not line up, so no fund is judged until they do.</p>
      </section>
    );
  }
  return (
    <section className="card mf-panel" aria-labelledby="mf-fvb-t">
      <h2 id="mf-fvb-t">Each fund against its own benchmark</h2>
      <p className="mf-basis">
        Same start and end dates for the fund and its index. A verdict appears only after 30 days of holding, and a fund that lost less than a falling index is described as exactly that, not as simply &ldquo;ahead&rdquo;.
      </p>
      <div className="mf-table-wrap">
        <table className="mf-fvb">
          <thead>
            <tr>
              <th scope="col">Fund</th>
              <th scope="col" className="num">Fund return</th>
              <th scope="col" className="num">Benchmark return</th>
              <th scope="col" className="num">Relative</th>
              <th scope="col">Reading</th>
            </tr>
          </thead>
          <tbody>
            {funds.map((f) => {
              const b = benchView(f);
              const r = returnView(f, blocked);
              return (
                <tr key={f.scheme_code}>
                  <th scope="row">
                    <Link href={`/funds/${f.scheme_code}`}>{f.scheme_name}</Link>
                    <small>{f.period.label}</small>
                  </th>
                  <td className={`num ${tone(r.value)}`} data-label={r.annualized ? "Fund (XIRR)" : "Fund return"}>
                    {signedPoints(r.value, 2)}
                  </td>
                  <td className={`num ${tone(b.value)}`} data-label="Benchmark">
                    {b.available ? signedPoints(b.value, 2) : "—"}
                    <small>{b.label ? `${b.label}${b.proxy ? " (proxy)" : ""}` : "None"}</small>
                  </td>
                  <td className={`num ${verdictTone(f.verdict)}`} data-label="Relative">
                    {b.available ? pts(f.relative_pp) : "n/a"}
                  </td>
                  <td data-label="Reading">
                    {b.available ? (
                      <>
                        <b className={verdictTone(f.verdict)}>{VERDICT_LABEL[f.verdict]}</b>
                        <small>{f.verdict_text}</small>
                      </>
                    ) : (
                      <span className="muted">Benchmark unavailable. {b.note}</span>
                    )}
                    {b.proxy && b.available ? <small className="muted">{b.note}</small> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <GapNote gaps={["category-average"]}>Category-average comparison is not shown: there is no data behind one.</GapNote>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export function CostSection({ holdings }: { holdings: FundHolding[] }) {
  const live = holdings.filter((h) => h.data_available && h.value > 0);
  const total = live.reduce((a, h) => a + h.value, 0);
  const regular = live.filter((h) => h.plan === "Regular");
  const regularPct = total > 0 ? (regular.reduce((a, h) => a + h.value, 0) / total) * 100 : 0;
  const direct = live.filter((h) => h.plan === "Direct").length;
  return (
    <section className="card mf-panel" aria-labelledby="mf-cost-t">
      <h2 id="mf-cost-t">Cost</h2>
      <p className="mf-basis">What can be said about cost from the data connected here, and what cannot.</p>
      <dl className="mf-cost-facts">
        <div>
          <dt>Direct plans</dt>
          <dd>{direct} of {live.length}</dd>
        </div>
        <div>
          <dt>Regular plans</dt>
          <dd>
            {regular.length} of {live.length}
            <small>{regularPct.toFixed(0)}% of value</small>
          </dd>
        </div>
        <div>
          <dt>Weighted expense ratio</dt>
          <dd className="muted">Unavailable</dd>
        </div>
      </dl>
      <p className="mf-basis">
        {regular.length
          ? "A regular plan carries a distributor commission inside its expense ratio, so a direct plan of the same fund usually costs less. Open a fund and use its Direct vs Regular tab to compare before deciding anything; this page does not suggest switching."
          : "Every fund here is a direct plan, or its plan type is not stated in the scheme name."}
      </p>
      <GapNote gaps={["expense-ratio"]}>Expense ratios are not connected, so no cost figure is estimated.</GapNote>
    </section>
  );
}

export function TrustSection({ report }: { report: Report }) {
  return (
    <details className="card mf-panel mf-trust">
      <summary>
        <h2>How these numbers were made</h2>
        <span className="muted">Sources, periods and what is unavailable</span>
      </summary>
      <div className="mf-table-wrap">
        <table className="mf-trust-table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Status</th>
              <th scope="col">Source</th>
              <th scope="col">As of</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {report.data_quality.map((d) => (
              <tr key={d.metric}>
                <th scope="row">{d.metric}</th>
                <td>
                  <span className={`mf-status ${d.status}`}>{d.status === "available" ? "Available" : "Unavailable"}</span>
                </td>
                <td>{d.source}</td>
                <td>{d.as_of ? date(d.as_of) : "—"}</td>
                <td className="muted">{d.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="mf-trust-sub">Consistency checks run before this page was drawn</h3>
      <ul className="mf-check-list">
        {report.checks.map((c) => (
          <li key={c.id} className={c.status}>
            <span className="mf-check-dot" aria-hidden />
            {c.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function HoldingsOverlapUnavailable() {
  return (
    <section className="card mf-panel mf-unavail" aria-labelledby="mf-ov-t">
      <div className="mf-gap-head">
        <h2 id="mf-ov-t">Holdings overlap unavailable</h2>
        <span className="mf-tag">Not available yet</span>
      </div>
      <p className="mf-basis">
        Real overlap between two funds is the sum, across stocks, of the smaller of the two weights. That needs each fund&apos;s latest monthly portfolio disclosure, which is not connected here, so no overlap, sector exposure or top-stock concentration is shown. Funds that merely share a category are listed below as a similarity, not as measured overlap.
      </p>
    </section>
  );
}
