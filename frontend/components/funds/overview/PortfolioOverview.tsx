"use client";

import { useCallback, useMemo, useState } from "react";
import type { FundPortfolio } from "@/lib/api";
import { parseDay, type SeriesSet } from "@/lib/funds/analytics";
import { useFundInsights, type TaxInfo } from "@/lib/funds/useFundInsights";
import type { AnalysisState } from "@/lib/funds/useFundsBook";
import { healthScore, RANGES, rangeUsable, type RangeId } from "@/lib/funds/viz";
import { AllocationPanel } from "./AllocationPanel";
import { ConcentrationPanel } from "./ConcentrationPanel";
import { HealthPanel } from "./HealthPanel";
import { MarketCapPanel } from "./MarketCapPanel";
import { OverviewHero } from "./OverviewHero";
import { PerformancePanel } from "./PerformancePanel";
import { RiskPanel } from "./RiskPanel";

/**
 * The portfolio at a glance, built as a few large sections rather than a wall of cards: what it is worth
 * and how it got here, where the money is, how it did against the market, how concentrated and how healthy
 * it is, and what risk it carries. One time range drives both charts.
 */
export function PortfolioOverview({ book, analysis, series, taxProfile }: { book: FundPortfolio; analysis: AnalysisState; series: SeriesSet | null; taxProfile: TaxInfo }) {
  const report = analysis.report;
  const growth = report?.growth ?? [];
  const times = useMemo(() => growth.map((g) => parseDay(g.date)).filter(Number.isFinite), [growth]);
  const first = times.length ? Math.min(...times) : 0;
  const last = times.length ? Math.max(...times) : 0;
  const usable = useCallback(
    (id: RangeId) => rangeUsable(first, last, RANGES.find((r) => r.id === id)?.days ?? null, times.length),
    [first, last, times.length],
  );
  const [picked, setPicked] = useState<RangeId | null>(null);
  const range: RangeId = picked && usable(picked) ? picked : usable("1Y") ? "1Y" : "MAX";

  const insights = useFundInsights(book.holdings, taxProfile);
  const suit = insights.data?.suitability;
  const bench = report?.benchmarks.find((b) => b.key === "NIFTY 500") ?? report?.benchmarks[0] ?? null;
  const relativePp = bench && report?.period?.annualizable && bench.relative_pp != null && bench.verdict !== "too_early" && bench.verdict !== "unavailable" ? bench.relative_pp : null;
  const health = useMemo(
    () =>
      healthScore({
        holdings: book.holdings,
        relativePp,
        benchmarkLabel: bench?.label.replace("NIFTY", "Nifty") ?? null,
        suitability: suit ? { equityPct: suit.equity_pct, low: suit.reference_low, high: suit.reference_high } : null,
      }),
    [book.holdings, relativePp, bench?.label, suit],
  );

  const status: "loading" | "error" | "empty" | "ready" = analysis.error ? "error" : !report ? "loading" : series ? "ready" : "empty";

  return (
    <div className="vz-overview">
      <OverviewHero book={book} report={report} busy={analysis.busy} range={range} setRange={setPicked} usable={usable} />
      <div className="vz-split">
        <AllocationPanel holdings={book.holdings} />
        <PerformancePanel series={series} range={range} status={status} />
      </div>
      <div className="vz-split even">
        <ConcentrationPanel holdings={book.holdings} />
        <HealthPanel health={health} pending={insights.loading && !insights.data} />
      </div>
      <div className="vz-split even">
        <RiskPanel holdings={book.holdings} series={series} />
        <MarketCapPanel report={report} />
      </div>
    </div>
  );
}
