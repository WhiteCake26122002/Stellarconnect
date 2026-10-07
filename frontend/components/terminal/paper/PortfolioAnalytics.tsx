"use client";

import { useMemo } from "react";
import {
  calculateConcentration,
  calculateDailyPnl,
  calculatePortfolioAllocation,
  calculateSectorExposure,
  calculateTopHoldings,
  calculateTradeStats,
  type EquityPoint,
  type Holding,
  type PortfolioSummary,
} from "@/lib/trading/analytics";
import type { EngineState } from "@/lib/trading/engine";
import { inr, pct, signedInr, weightPct } from "@/lib/trading/format";
import { DailyPnlChart } from "./DailyPnl";
import { PortfolioAllocation } from "./PortfolioAllocation";
import { SectorExposure } from "./SectorExposure";
import { TopHoldings } from "./TopHoldings";
import { TradingStatistics } from "./TradingStatistics";
import { Reveal, SectionHead } from "./ui";

function Group({ title, rows }: { title: string; rows: [string, string, ("up" | "down")?][] }) {
  return (
    <div className="pt-group">
      <h3>{title}</h3>
      <dl className="pt-kv tight">
        {rows.map(([k, v, tone]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={tone}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Portfolio analytics: every chart and figure is computed by lib/trading/analytics from the same engine state the
 * tables use, so the donut, the bars and the positions table can never disagree.
 */
export function PortfolioAnalytics({
  engine,
  holdings,
  summary,
  history,
  closes,
  onOpen,
  hover,
  onHover,
}: {
  engine: EngineState;
  holdings: Holding[];
  summary: PortfolioSummary;
  history: EquityPoint[];
  closes: Map<string, number[]>;
  onOpen: (symbol: string) => void;
  hover?: string | null;
  onHover?: (id: string | null) => void;
}) {
  const cash = engine.account.cash;
  const slices = useMemo(() => calculatePortfolioAllocation(holdings, cash), [holdings, cash]);
  const sectors = useMemo(() => calculateSectorExposure(holdings, cash), [holdings, cash]);
  const conc = useMemo(() => calculateConcentration(holdings, cash), [holdings, cash]);
  const days = useMemo(() => calculateDailyPnl(history), [history]);
  const stats = useMemo(() => calculateTradeStats(engine.trades), [engine.trades]);
  const top = useMemo(() => calculateTopHoldings(holdings, 5), [holdings]);

  return (
    <div className="pt-analytics">
      <div className="pt-groups">
        <Group
          title="Performance"
          rows={[
            ["Portfolio value", inr(summary.value, 0)],
            ["Total return", pct(summary.totalReturn), summary.totalReturn >= 0 ? "up" : "down"],
            ["Day return", pct(summary.dayReturn), summary.dayReturn >= 0 ? "up" : "down"],
            ["Unrealized P&L", signedInr(summary.unrealized, 0), summary.unrealized >= 0 ? "up" : "down"],
            ["Realized P&L", signedInr(summary.realized, 0), summary.realized >= 0 ? "up" : "down"],
            ["Charges paid", inr(summary.charges, 0)],
          ]}
        />
        <Group
          title="Risk and concentration"
          rows={[
            ["Top holding", conc.topHolding ? `${conc.topHolding.name} · ${weightPct(conc.topHolding.weight, 0)}` : "—"],
            ["Top sector", conc.topSector ? `${conc.topSector.label} · ${weightPct(conc.topSector.weight, 0)}` : "—"],
            ["Holdings", String(conc.holdingsCount)],
            ["Cash", weightPct(conc.cashPct, 0)],
          ]}
        />
        <Group
          title="Trading behaviour"
          rows={[
            ["Win rate", stats.winRate == null ? "—" : weightPct(stats.winRate, 0)],
            ["Average win", stats.avgWin == null ? "—" : signedInr(stats.avgWin, 0), "up"],
            ["Average loss", stats.avgLoss == null ? "—" : signedInr(stats.avgLoss, 0), "down"],
            ["Best trade", stats.best ? signedInr(stats.best.pnl, 0) : "—"],
            ["Worst trade", stats.worst ? signedInr(stats.worst.pnl, 0) : "—"],
            ["Total trades", String(stats.total)],
          ]}
        />
      </div>

      <div className="pt-two">
        <Reveal index={0} className="pt-block" aria-labelledby="pt-h-alloc">
          <SectionHead id="pt-h-alloc" title="Portfolio allocation" sub="Where is my money invested?" />
          <PortfolioAllocation slices={slices} onOpen={onOpen} hover={hover} onHover={onHover} />
        </Reveal>
        <Reveal index={1} className="pt-block" aria-labelledby="pt-h-sector">
          <SectionHead id="pt-h-sector" title="Sector exposure" sub="Which sectors am I exposed to?" />
          <SectorExposure rows={sectors} />
        </Reveal>
      </div>
      <div className="pt-two">
        <Reveal index={2} className="pt-block" aria-labelledby="pt-h-daily">
          <SectionHead id="pt-h-daily" title="Daily P&L" sub="When am I making or losing money?" />
          <DailyPnlChart days={days} />
        </Reveal>
        <Reveal index={3} className="pt-block" aria-labelledby="pt-h-top">
          <SectionHead id="pt-h-top" title="Top holdings" sub="Ranked by value" />
          <TopHoldings holdings={top} closes={closes} onOpen={onOpen} />
        </Reveal>
      </div>
      <Reveal index={4} className="pt-block" aria-labelledby="pt-h-stats">
        <SectionHead id="pt-h-stats" title="Trading performance" sub="How often are my trades successful?" />
        <TradingStatistics stats={stats} />
      </Reveal>
    </div>
  );
}
