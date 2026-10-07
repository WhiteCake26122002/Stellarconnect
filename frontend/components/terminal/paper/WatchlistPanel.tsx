"use client";

import { pct, px } from "@/lib/trading/format";
import type { Quote, Side, Watchlist } from "@/lib/trading/types";
import { findSymbol, isPlaceholderSymbol } from "@/lib/trading/universe";
import { DeskMark } from "../DeskMark";
import { Delta, EmptyState, Skeleton, Sparkline } from "./ui";

/** The watchlist as a clean list: price, move, a month of closes, and Buy, or the shares held with Sell. */
export function WatchlistPanel({
  list,
  quotes,
  held,
  closes,
  loading,
  onTrade,
  onOpen,
  onSearch,
}: {
  list: Watchlist | undefined;
  quotes: Map<string, Quote>;
  held: Map<string, number>;
  closes: Map<string, number[]>;
  loading: boolean;
  onTrade: (symbol: string, side: Side) => void;
  onOpen: (symbol: string) => void;
  onSearch: () => void;
}) {
  const rows = (list?.symbols ?? []).filter((s) => !isPlaceholderSymbol(s)).slice(0, 12);
  if (!rows.length) return <EmptyState title="Your watchlist is empty" body="Add stocks to track them here." action={{ label: "Search stocks", onClick: onSearch }} />;
  return (
    <ul className="pt-watch" aria-label={`${list?.name ?? "Watchlist"} stocks`}>
      {rows.map((sym) => {
        const q = quotes.get(sym);
        const info = findSymbol(sym);
        const owned = held.get(sym) ?? 0;
        return (
          <li key={sym}>
            <button type="button" className="id" onClick={() => onOpen(sym)} aria-label={`${info.name}, open chart`}>
              <DeskMark info={info} size={22} />
              <span>
                <strong>{info.symbol}</strong>
                <small>{owned > 0 ? `${owned} ${owned === 1 ? "share" : "shares"}` : info.name}</small>
              </span>
            </button>
            <Sparkline values={closes.get(sym) ?? []} label={`${info.symbol} last month`} width={64} height={22} />
            <span className="px">
              {q && q.last > 0 ? (
                <>
                  <b className="mono">{px(q.last)}</b>
                  <Delta value={q.changePct} text={pct(q.changePct)} />
                </>
              ) : loading ? (
                <Skeleton w={70} h={16} label={`Loading ${info.symbol}`} />
              ) : (
                <span className="pt-muted">—</span>
              )}
            </span>
            <span className="acts">
              <button type="button" className="pt-mini buy" onClick={() => onTrade(sym, "buy")} aria-label={`Buy ${info.name}`}>
                Buy
              </button>
              {owned > 0 ? (
                <button type="button" className="pt-mini sell" onClick={() => onTrade(sym, "sell")} aria-label={`Sell ${info.name}`}>
                  Sell
                </button>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
