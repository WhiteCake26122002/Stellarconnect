"use client";

import { useMemo } from "react";
import type { FundHolding } from "@/lib/api";
import { riskStats, type SeriesSet } from "@/lib/funds/analytics";
import { categoryRisk, RISK_LABELS, type RiskLevel } from "@/lib/funds/category";
import { frac, longDate, monthYear, ratio, signedFrac } from "@/lib/funds/format";
import { drawdownSeries } from "@/lib/funds/viz";
import { LinesChart } from "../viz/LinesChart";
import { Spectrum } from "../viz/Spectrum";
import { TipRow } from "../viz/Tip";
import { VIZ } from "../viz/theme";

/** The Sharpe ratio needs a risk-free rate; this is the assumption the Analysis tab also starts from. */
export const RISK_FREE = 0.065;

/** Value-weighted AMFI risk level (1 lowest, 6 highest), or null when no fund has one. */
export function weightedRisk(holdings: FundHolding[]): number | null {
  let weight = 0;
  let sum = 0;
  for (const h of holdings) {
    if (!h.data_available || !(h.value > 0)) continue;
    const level = categoryRisk(h.scheme_category, h.scheme_name);
    if (level == null) continue;
    weight += h.value;
    sum += h.value * level;
  }
  return weight > 0 ? sum / weight : null;
}

function Metric({ label, value, note, tone }: { label: string; value: string | null; note: string; tone?: "bull" | "bear" }) {
  return (
    <div className="vz-metric">
      <span className="vz-metric-label">{label}</span>
      {value == null ? <b className="vz-na">Insufficient history</b> : <b className={tone}>{value}</b>}
      <small>{note}</small>
    </div>
  );
}

/**
 * Risk in two honest pieces: where the funds sit on the AMFI risk scale (from their categories, not from
 * measured swings), and what the value path has actually done: volatility, deepest fall and Sharpe.
 */
export function RiskPanel({ holdings, series }: { holdings: FundHolding[]; series: SeriesSet | null }) {
  const avg = weightedRisk(holdings);
  const level = avg == null ? null : (Math.min(6, Math.max(1, Math.round(avg))) as RiskLevel);
  const benchLabel = series?.benchmarks.find((b) => b.label === "NIFTY 500")?.label ?? series?.benchmarks[0]?.label;
  const stats = useMemo(() => (series ? riskStats(series, (iv) => iv.subject, series.subject, RISK_FREE, benchLabel) : null), [series, benchLabel]);
  const dd = useMemo(() => (series ? drawdownSeries(series.subject) : []), [series]);
  const worst = stats?.drawdown ?? null;

  return (
    <section className="vz-section" aria-label="Risk profile">
      <h2 className="vz-h">Risk profile</h2>
      <div className="vz-risk">
        <div className="vz-risk-scale">
          <p className="vz-sub">Where your funds sit on the AMFI risk scale</p>
          <Spectrum at={avg == null ? null : (avg - 1) / 5} label={level ? RISK_LABELS[level] : "Unavailable"} stops={["Low", "Moderate", "Very high"]} />
          <p className="vz-hint">Value-weighted, estimated from each fund&apos;s AMFI category. It is not a measured swing in price.</p>
        </div>
        <div className="vz-risk-measures">
          <Metric label="Volatility" value={stats?.volatility == null ? null : frac(stats.volatility)} note="Annualized, from weekly marks; needs about a year" />
          <Metric
            label="Max drawdown"
            value={worst ? (worst.depth === 0 ? "No fall yet" : signedFrac(worst.depth)) : null}
            tone={worst && worst.depth < 0 ? "bear" : undefined}
            note={worst && worst.depth < 0 ? `${longDate(worst.peak)} to ${longDate(worst.trough)}` : "Deepest fall from a peak"}
          />
          <Metric label="Sharpe ratio" value={stats?.sharpe == null ? null : ratio(stats.sharpe)} note={`Assumes ${(RISK_FREE * 100).toFixed(1)}% risk-free; needs a year`} />
        </div>
      </div>
      {series && dd.length > 2 ? (
        <>
          <p className="vz-sub">Fall from the previous peak</p>
          <LinesChart
            series={[{ id: "dd", label: "Below peak", color: VIZ.red, points: dd.map((d) => ({ t: d.t, v: d.dd })), area: true, width: 1.6 }]}
            height={140}
            drawdown
            yFormat={(v) => `${(v * 100).toFixed(0)}%`}
            xFormat={monthYear}
            title={(t) => longDate(t)}
            ariaLabel="Drawdown of the portfolio over time"
            rows={(_, values) => <TipRow color={VIZ.red} label="Below peak" value={values.dd == null ? "n/a" : signedFrac(values.dd)} />}
          />
        </>
      ) : null}
    </section>
  );
}
