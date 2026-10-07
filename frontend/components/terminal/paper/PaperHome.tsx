"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DeskHero } from "@/components/desk/DeskHero";
import { inr } from "@/lib/trading/format";
import { calculateHoldings, calculateSummary, type EquityPoint } from "@/lib/trading/analytics";
import * as candleCache from "@/lib/trading/candleCache";
import type { EngineState } from "@/lib/trading/engine";
import type { Candle, Quote, Side, Watchlist } from "@/lib/trading/types";
import { MarketOverview } from "./MarketOverview";
import { PortfolioAnalytics } from "./PortfolioAnalytics";
import { PortfolioPerformance } from "./PortfolioPerformance";
import { PortfolioSummary } from "./PortfolioSummary";
import { PositionsTable } from "./PositionsTable";
import { WatchlistPanel } from "./WatchlistPanel";
import { Reveal, SectionHead } from "./ui";
import { useCloses } from "./useCloses";

const HeatMap = dynamic(() => import("../HeatMap").then((m) => m.HeatMap), {
  ssr: false,
  loading: () => <div className="pt-skel-block" aria-busy="true" aria-label="Loading the heat map"><span className="pt-skel" style={{ width: "100%", height: 280 }} /></div>,
});

/** Real daily NIFTY bars for the performance chart's comparison line; never simulated ones. */
function useBenchmark() {
  const [state, setState] = useState<{ candles: Candle[] | null; status: "loading" | "ok" | "unavailable" }>(() => {
    const hit = candleCache.peek("NIFTY", "1D");
    return hit ? { candles: hit.candles, status: "ok" } : { candles: null, status: "loading" };
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let gone = false;
    candleCache.load("NIFTY", "1D").then((c) => {
      if (!gone) setState(c ? { candles: c, status: "ok" } : { candles: null, status: "unavailable" });
    });
    return () => {
      gone = true;
    };
  }, [attempt]);
  return { ...state, retry: useCallback(() => { setState((s) => ({ ...s, status: "loading" })); setAttempt((n) => n + 1); }, []) };
}

/**
 * The Paper Trading home, top to bottom: the market, my portfolio, how it has performed, the whole market's
 * movement, my watchlist, what I hold, and the analytics behind it.
 */
export function PaperHome({
  engine,
  quotes,
  quotesLoading,
  history,
  watchlist,
  universeLoading,
  onTrade,
  onOpenChart,
  onSearch,
  onOpenHeatmap,
  onRetryQuotes,
}: {
  engine: EngineState;
  quotes: Map<string, Quote>;
  quotesLoading: boolean;
  history: EquityPoint[];
  watchlist: Watchlist | undefined;
  universeLoading: boolean;
  onTrade: (symbol: string, side: Side) => void;
  onOpenChart: (symbol: string) => void;
  onSearch: () => void;
  onOpenHeatmap: () => void;
  onRetryQuotes: () => void;
}) {
  const holdings = useMemo(() => calculateHoldings(engine, quotes), [engine, quotes]);
  const summary = useMemo(() => calculateSummary(engine, holdings), [engine, holdings]);
  const held = useMemo(() => new Map(holdings.filter((h) => h.side === "long").map((h) => [h.symbol, h.qty])), [holdings]);
  const wanted = useMemo(() => ["NIFTY", "BANKNIFTY", "SENSEX", ...(watchlist?.symbols ?? []).slice(0, 8), ...holdings.map((h) => h.symbol)], [watchlist, holdings]);
  const closes = useCloses(wanted);
  const bench = useBenchmark();
  const loading = quotesLoading && quotes.size === 0;
  const [hover, setHover] = useState<string | null>(null);

  return (
    <div className="board-page pt-home">
      <DeskHero
        compact
        n="01"
        kicker="Market"
        echo="Practice"
        title="Paper trading"
        lead="Practice with virtual cash at market prices. Search a stock, buy or sell, and watch the effect on your portfolio."
        stats={
          loading
            ? undefined
            : [
                { k: "Cash", v: inr(summary.cash, 0) },
                { k: "Positions", v: String(summary.holdingsCount) },
              ]
        }
        scene="tape"
        sceneLabel="A candlestick tape with the last price tagged"
      />

      <Reveal index={0} className="pt-section" aria-labelledby="pt-h-market">
        <SectionHead id="pt-h-market" title="Market overview" />
        <MarketOverview quotes={quotes} closes={closes} loading={loading} onOpen={onOpenChart} onRetry={onRetryQuotes} />
      </Reveal>

      <Reveal index={1} className="pt-section" aria-labelledby="pt-h-summary">
        <SectionHead id="pt-h-summary" title="Your portfolio" />
        <PortfolioSummary summary={summary} loading={loading} />
      </Reveal>

      <Reveal index={2} className="pt-section" aria-labelledby="pt-h-perf">
        <SectionHead id="pt-h-perf" title="Portfolio performance" sub="How has my portfolio performed?" />
        <PortfolioPerformance history={history} benchmark={bench.candles} benchmarkState={bench.status} hasTrades={engine.fills.length > 0} value={summary.value} onRetryBenchmark={bench.retry} />
      </Reveal>

      <Reveal index={3} className="pt-section pt-heat" aria-labelledby="pt-h-heat">
        <SectionHead id="pt-h-heat" title="Market heat map" sub="What is happening across the market?" right={<button type="button" className="pt-link" onClick={onOpenHeatmap}>Open full heat map →</button>} />
        <HeatMap quotes={quotes} loading={quotesLoading} onPick={onOpenChart} compact />
      </Reveal>

      <Reveal index={4} className="pt-section" aria-labelledby="pt-h-watch">
        <SectionHead id="pt-h-watch" title={watchlist?.name ?? "Watchlist"} right={<button type="button" className="pt-link" onClick={onSearch}>Search stocks</button>} />
        <WatchlistPanel list={watchlist} quotes={quotes} held={held} closes={closes} loading={loading || universeLoading} onTrade={onTrade} onOpen={onOpenChart} onSearch={onSearch} />
      </Reveal>

      <Reveal index={5} className="pt-section" aria-labelledby="pt-h-pos">
        <SectionHead id="pt-h-pos" title="Positions" />
        <PositionsTable holdings={holdings} onTrade={onTrade} onOpen={onOpenChart} onExplore={onSearch} />
      </Reveal>

      <Reveal index={6} className="pt-section" aria-labelledby="pt-h-analytics">
        <SectionHead id="pt-h-analytics" title="Portfolio analytics" />
        <PortfolioAnalytics engine={engine} holdings={holdings} summary={summary} history={history} closes={closes} onOpen={onOpenChart} hover={hover} onHover={setHover} />
      </Reveal>
    </div>
  );
}
