"use client";

import { useEffect, useState } from "react";
import { clockTime, marketStatus } from "@/lib/trading/session";
import { indexLevel, pct, signedPx } from "@/lib/trading/format";
import type { Quote } from "@/lib/trading/types";
import { Delta, ErrorState, Skeleton, Sparkline } from "./ui";

const INDICES = [
  { symbol: "NIFTY", label: "NIFTY 50" },
  { symbol: "BANKNIFTY", label: "BANK NIFTY" },
  { symbol: "SENSEX", label: "SENSEX" },
];

/** What is the market doing? Three indices with a month of closes, and a status line that never calls delayed data live. */
export function MarketOverview({
  quotes,
  closes,
  loading,
  onOpen,
  onRetry,
}: {
  quotes: Map<string, Quote>;
  closes: Map<string, number[]>;
  loading: boolean;
  onOpen: (symbol: string) => void;
  onRetry?: () => void;
}) {
  // Re-evaluated every 15 seconds so "Market open" turns into "Delayed data" if the feed stops, without a new quote.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const status = marketStatus(INDICES.map((i) => quotes.get(i.symbol)), now);
  return (
    <div className="pt-market">
      <p className={`pt-status ${status.kind}`} role="status">
        <i aria-hidden />
        <b>{status.label}</b>
        {status.updatedAt ? <span>Last updated {clockTime(status.updatedAt)}</span> : null}
      </p>
      {status.kind === "simulated" ? (
        <ErrorState title="Unable to load market data" body="We couldn’t retrieve the latest prices, so the figures below are simulated." onRetry={onRetry} />
      ) : null}
      {status.kind === "delayed" ? <p className="pt-issue warn" role="status">Market data may be delayed. Last updated {status.updatedAt ? clockTime(status.updatedAt) : "a while ago"}.</p> : null}
      <ul className="pt-indices" aria-label="Market indices">
        {INDICES.map((ix) => {
          const q = quotes.get(ix.symbol);
          return (
            <li key={ix.symbol}>
              <button type="button" onClick={() => onOpen(ix.symbol)} aria-label={`${ix.label} ${q ? `${indexLevel(q.last)}, ${pct(q.changePct)}` : "price loading"}. Open chart`}>
                <span className="n">{ix.label}</span>
                {q && q.last > 0 ? (
                  <>
                    <b className="mono">{indexLevel(q.last)}</b>
                    <Delta value={q.change} text={`${signedPx(q.change)} · ${pct(q.changePct)}`} />
                  </>
                ) : loading ? (
                  <Skeleton w={110} h={18} label={`Loading ${ix.label}`} />
                ) : (
                  <span className="pt-muted">Unavailable</span>
                )}
                <Sparkline values={closes.get(ix.symbol) ?? []} label={`${ix.label} last month`} width={96} height={28} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
