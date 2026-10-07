"use client";

import { AnimatedNumber } from "@/components/AnimatedNumber";
import type { Holding } from "@/lib/trading/analytics";
import { inr, pct, px, signedInr } from "@/lib/trading/format";
import type { Side } from "@/lib/trading/types";
import { findSymbol } from "@/lib/trading/universe";
import { DeskMark } from "../DeskMark";
import { Delta, EmptyState } from "./ui";

/**
 * What I hold. Each row's SELL opens the standard order ticket for that stock. A position left over from before the
 * desk was long-only shows "Cover" instead, which buys it back.
 */
export function PositionsTable({
  holdings,
  onTrade,
  onOpen,
  onExplore,
}: {
  holdings: Holding[];
  onTrade: (symbol: string, side: Side) => void;
  onOpen: (symbol: string) => void;
  onExplore: () => void;
}) {
  if (!holdings.length) {
    return <EmptyState title="No positions yet" body="Buy your first stock to start building your paper portfolio." action={{ label: "Explore stocks", onClick: onExplore }} />;
  }
  return (
    <div className="pt-table-wrap">
      <table className="pt-table pt-positions" aria-label="Positions">
        <thead>
          <tr>
            <th>Stock</th>
            <th className="num">Qty</th>
            <th className="num">Avg price</th>
            <th className="num">LTP</th>
            <th className="num">Market value</th>
            <th className="num">Day P&amp;L</th>
            <th className="num">Total P&amp;L</th>
            <th className="num">Return</th>
            <th>
              <span className="pt-visually">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => (
            <tr key={h.symbol} className="pt-row-in">
              <td>
                <span className="pos-id">
                  <DeskMark info={findSymbol(h.symbol)} size={18} />
                  <button type="button" className="pt-link strong" onClick={() => onOpen(h.symbol)}>
                    {h.name}
                  </button>
                  {h.side === "short" ? <small className="pt-muted">older short</small> : null}
                </span>
              </td>
              <td className="num">{h.qty}</td>
              <td className="num">{px(h.avgPrice)}</td>
              <td className="num">{h.hasQuote ? px(h.last) : <span title="No price yet; shown at cost">—</span>}</td>
              <td className="num">
                <AnimatedNumber value={h.value} format={(v) => inr(v, 0)} />
              </td>
              <td className="num">{h.hasQuote ? <Delta value={h.dayPnl} text={signedInr(h.dayPnl, 0)} /> : "—"}</td>
              <td className="num">
                <Delta value={h.pnl} text={signedInr(h.pnl, 0)} />
              </td>
              <td className="num">
                <Delta value={h.returnPct} text={pct(h.returnPct)} />
              </td>
              <td className="act">
                {h.side === "short" ? (
                  <button type="button" className="pt-mini cover" onClick={() => onTrade(h.symbol, "buy")} aria-label={`Cover ${h.name}`}>
                    Cover
                  </button>
                ) : (
                  <button type="button" className="pt-mini sell" onClick={() => onTrade(h.symbol, "sell")} aria-label={`Sell ${h.name}`}>
                    SELL
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
