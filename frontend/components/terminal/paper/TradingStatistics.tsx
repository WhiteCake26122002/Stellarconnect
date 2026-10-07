"use client";

import type { TradeStats } from "@/lib/trading/analytics";
import { inr, signedInr, weightPct } from "@/lib/trading/format";
import { findSymbol } from "@/lib/trading/universe";
import { EmptyState } from "./ui";

const money = (v: number | null) => (v == null ? "—" : signedInr(v, 0));

/** How often are my trades successful? Counts and averages, with the win/loss split drawn as two bars. */
export function TradingStatistics({ stats }: { stats: TradeStats }) {
  if (!stats.total) return <EmptyState title="No closed trades yet" body="Sell a position and your win rate, average win and average loss appear here." />;
  const win = stats.winRate ?? 0;
  const loss = stats.lossRate ?? 0;
  return (
    <div className="pt-stats">
      <dl className="pt-kv">
        <div>
          <dt>Winning trades</dt>
          <dd>{stats.wins}</dd>
        </div>
        <div>
          <dt>Losing trades</dt>
          <dd>{stats.losses}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>{weightPct(win, 0)}</dd>
        </div>
        <div>
          <dt>Total trades</dt>
          <dd>{stats.total}</dd>
        </div>
        <div>
          <dt>Average win</dt>
          <dd className="up">{money(stats.avgWin)}</dd>
        </div>
        <div>
          <dt>Average loss</dt>
          <dd className="down">{money(stats.avgLoss)}</dd>
        </div>
        <div>
          <dt>Best trade</dt>
          <dd className="up">{stats.best ? `${money(stats.best.pnl)}` : "—"}{stats.best ? <small>{findSymbol(stats.best.symbol).symbol}</small> : null}</dd>
        </div>
        <div>
          <dt>Worst trade</dt>
          <dd className="down">{stats.worst ? `${money(stats.worst.pnl)}` : "—"}{stats.worst ? <small>{findSymbol(stats.worst.symbol).symbol}</small> : null}</dd>
        </div>
      </dl>
      <div className="pt-winloss" role="img" aria-label={`Wins ${weightPct(win, 0)}, losses ${weightPct(loss, 0)}${stats.flat ? `, breakeven ${stats.flat}` : ""}`}>
        <div>
          <span>Wins</span>
          <i className="track">
            <b className="win" style={{ transform: `scaleX(${win})` }} />
          </i>
          <em>{weightPct(win, 0)}</em>
        </div>
        <div>
          <span>Losses</span>
          <i className="track">
            <b className="loss" style={{ transform: `scaleX(${loss})`, animationDelay: "50ms" }} />
          </i>
          <em>{weightPct(loss, 0)}</em>
        </div>
      </div>
      <p className="pt-fine">Results are after the charges on both legs of each trade. Net of {inr(stats.grossProfit + stats.grossLoss, 0)} overall.{stats.flat ? ` ${stats.flat} closed at exactly breakeven.` : ""}</p>
    </div>
  );
}
