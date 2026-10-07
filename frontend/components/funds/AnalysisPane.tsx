"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, KpiSkeletons } from "./FundAtoms";
import { ChartSkeleton } from "@/components/funds/FundCharts";
import { DownMarketsPanel, portfolioSource, RiskReturnPanel, RollingReturnsPanel } from "./FundAnalytics";
import { OverlapDetector } from "./PortfolioTools";
import { AllocationPanel } from "./overview/AllocationPanel";
import { ConcentrationPanel } from "./overview/ConcentrationPanel";
import { MarketCapPanel } from "./overview/MarketCapPanel";
import { PerformancePanel } from "./overview/PerformancePanel";
import { RangeTabs } from "./overview/OverviewHero";
import { RiskPanel } from "./overview/RiskPanel";
import { HBars } from "./viz/HBars";
import { RANGES, rangeUsable, type RangeId } from "@/lib/funds/viz";
import { DAY } from "@/lib/funds/analytics";
import { BenchmarkSection, ChecksBanner, CostSection, FundsVsBenchmark, PeriodBanner, SnapshotSection, TrustSection } from "./AnalysisSections";
import { TaxEfficiencySection } from "./TaxCostsPane";
import { PlanScenarios } from "./PlanScenarios";
import { useAnalyticsTourDone } from "@/lib/funds/local";
import { useFundTax } from "@/lib/funds/useFundTax";
import type { FundPortfolio } from "@/lib/api";
import type { SeriesSet } from "@/lib/funds/analytics";
import type { TaxProfile } from "@/lib/costs/tax";
import type { AnalysisState } from "@/lib/funds/useFundsBook";

const AnalyticsTour = dynamic(() => import("./AnalyticsTour").then((m) => m.AnalyticsTour), { ssr: false });

function AmcBars({ report }: { report: NonNullable<AnalysisState["report"]> }) {
  if (!report.amc.length) return null;
  return (
    <section className="vz-section" aria-label="Fund houses">
      <h2 className="vz-h">Fund houses</h2>
      <p className="vz-sub">Share of value with each asset manager</p>
      <HBars rows={report.amc.map((a) => ({ id: a.label, label: a.label, value: a.pct, valueText: `${a.pct.toFixed(1)}%` }))} max={100} ariaLabel="Share of value by fund house" />
    </section>
  );
}

/** One range control over the growth-of-₹100 chart, sized to the history that exists. */
function PerformanceBlock({ series, status }: { series: SeriesSet | null; status: "loading" | "error" | "empty" | "ready" }) {
  const first = series?.subject[0]?.t ?? 0;
  const last = series ? (series.subject[series.subject.length - 1]?.t ?? 0) : 0;
  const count = series?.subject.length ?? 0;
  const usable = (id: RangeId) => rangeUsable(first, last, RANGES.find((r) => r.id === id)?.days ?? null, count);
  const [picked, setPicked] = useState<RangeId | null>(null);
  const range: RangeId = picked && usable(picked) ? picked : usable("1Y") ? "1Y" : "MAX";
  void DAY;
  return (
    <div>
      {series ? (
        <div className="vz-block-ranges">
          <RangeTabs value={range} onChange={setPicked} usable={usable} />
        </div>
      ) : null}
      <PerformancePanel series={series} range={range} status={status} />
    </div>
  );
}

export function AnalysisPane({ book, state, series, profile }: { book: FundPortfolio; state: AnalysisState; series: SeriesSet | null; profile: TaxProfile }) {
  const tax = useFundTax(profile, null, book.holdings.length > 0);
  const tourDone = useAnalyticsTourDone();
  const [touring, setTouring] = useState(false);
  const endTour = useCallback(() => setTouring(false), []);
  const { report, error } = state;
  const canTour = !!series && !!report?.ready;

  useEffect(() => {
    if (canTour && tourDone === false) setTouring(true);
  }, [canTour, tourDone]);

  if (error) return <div className="banner bad" role="alert">{error}</div>;
  if (!report) {
    return (
      <div className="funds-analysis" aria-busy="true" aria-label="Comparing your holdings with the market">
        <KpiSkeletons count={4} />
        <ChartSkeleton title="Risk and return" height={200} />
      </div>
    );
  }
  if (!report.ready || !report.portfolio || !report.period) {
    return (
      <EmptyState art="portfolio" title="Add a fund to see analysis">
        <p className="muted">{report.lookthrough}</p>
      </EmptyState>
    );
  }
  const ready = report as typeof report & { portfolio: NonNullable<typeof report.portfolio>; period: NonNullable<typeof report.period> };
  const source = portfolioSource(book.holdings.length, state, series);

  return (
    <div className="funds-analysis">
      <div className="page-head">
        <div>
          <h1>Analysis</h1>
          <p className="muted">Performance, risk, diversification and cost, each measured over a stated period. {report.disclaimer}</p>
        </div>
        {canTour ? (
          <button type="button" className="btn secondary small" onClick={() => setTouring(true)}>
            Explain these metrics
          </button>
        ) : null}
      </div>
      <PeriodBanner report={ready} />
      <ChecksBanner report={ready} />

      <SnapshotSection report={ready} />

      <h2 className="mf-block-title">Performance</h2>
      <PerformanceBlock series={series} status={state.error ? "error" : !state.report ? "loading" : series ? "ready" : "empty"} />
      <BenchmarkSection report={ready} />
      <FundsVsBenchmark report={ready} />
      <div data-tour="mf-rolling">
        <RollingReturnsPanel source={source} />
      </div>

      <h2 className="mf-block-title">Risk</h2>
      <RiskPanel holdings={book.holdings} series={series} />
      <div className="mf-grid-2">
        <div data-tour="mf-risk">
          <RiskReturnPanel source={source} />
        </div>
        <div data-tour="mf-down">
          <DownMarketsPanel source={source} />
        </div>
      </div>

      <h2 className="mf-block-title">Allocation and concentration</h2>
      <div className="vz-split">
        <AllocationPanel holdings={book.holdings} />
        <MarketCapPanel report={report} />
      </div>
      <div className="vz-split even">
        <ConcentrationPanel holdings={book.holdings} />
        <AmcBars report={report} />
      </div>
      <OverlapDetector holdings={book.holdings} />

      <h2 className="mf-block-title">Cost</h2>
      <CostSection holdings={book.holdings} />

      <h2 className="mf-block-title">Tax</h2>
      {tax.view ? <TaxEfficiencySection view={tax.view} /> : <p className="muted" aria-busy={tax.busy}>{tax.error || "Working out tax efficiency…"}</p>}

      <TrustSection report={ready} />
      <p className="muted">{report.lookthrough}</p>
      {touring ? <AnalyticsTour run={touring} onEnd={endTour} /> : null}
    </div>
  );
}

export function PlanPane({ book }: { book: FundPortfolio }) {
  return (
    <div className="funds-analysis">
      <div className="page-head">
        <div>
          <h1>Plan</h1>
          <p className="muted">What a monthly SIP or a lump sum could grow to under three different assumptions. {book.disclaimer}</p>
        </div>
      </div>
      <PlanScenarios holdings={book.holdings.filter((h) => h.data_available)} />
    </div>
  );
}
