"use client";

import { AnimatedNumber } from "@/components/AnimatedNumber";
import type { PortfolioSummary as Summary } from "@/lib/trading/analytics";
import { inr, pct, signedInr } from "@/lib/trading/format";
import { Delta, Skeleton } from "./ui";

/** Four compact figures: what the account is worth, what it has made, what it made today, and the cash that can be spent. */
export function PortfolioSummary({ summary, loading }: { summary: Summary; loading: boolean }) {
  const n0 = (v: number) => inr(v, 0);
  const s0 = (v: number) => signedInr(v, 0);
  return (
    <dl className="pt-summary" aria-label="Portfolio summary" aria-busy={loading || undefined}>
      <div>
        <dt>Portfolio value</dt>
        <dd className="big">{loading ? <Skeleton w={120} h={24} label="Loading portfolio value" /> : <AnimatedNumber value={summary.value} format={n0} />}</dd>
        <small>
          {summary.holdingsCount} {summary.holdingsCount === 1 ? "holding" : "holdings"}
          {summary.unpriced ? ` · ${summary.unpriced} valued at cost until a price arrives` : ""}
        </small>
      </div>
      <div>
        <dt>Total P&amp;L</dt>
        <dd className="big">
          {loading ? <Skeleton w={96} h={24} /> : <Delta value={summary.totalPnl} text={s0(summary.totalPnl)} />}
        </dd>
        <small>{pct(summary.totalReturn)} on {inr(summary.value - summary.totalPnl, 0)} starting balance · after charges</small>
      </div>
      <div>
        <dt>Today’s P&amp;L</dt>
        <dd className="big">{loading ? <Skeleton w={96} h={24} /> : <Delta value={summary.dayPnl} text={s0(summary.dayPnl)} />}</dd>
        <small>{pct(summary.dayReturn)} since the day’s first reading</small>
      </div>
      <div>
        <dt>Cash</dt>
        <dd className="big">{loading ? <Skeleton w={96} h={24} /> : <AnimatedNumber value={summary.cash} format={n0} />}</dd>
        <small>Available to buy · no margin</small>
      </div>
    </dl>
  );
}
