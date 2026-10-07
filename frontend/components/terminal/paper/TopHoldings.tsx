"use client";

import type { Holding } from "@/lib/trading/analytics";
import { compactInr, signedInr, weightPct } from "@/lib/trading/format";
import { EmptyState, Delta, Sparkline } from "./ui";

/** A ranked list: the biggest positions first, their share of the portfolio, open P&L and a month of price. */
export function TopHoldings({ holdings, closes, onOpen }: { holdings: Holding[]; closes: Map<string, number[]>; onOpen: (symbol: string) => void }) {
  if (!holdings.length) return <EmptyState title="No holdings yet" body="Your biggest positions are ranked here once you buy." />;
  return (
    <div className="pt-table-wrap">
      <table className="pt-table" aria-label="Top holdings">
        <thead>
          <tr>
            <th>Stock</th>
            <th className="num">Value</th>
            <th className="num">Weight</th>
            <th className="num">P&amp;L</th>
            <th>1M</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => (
            <tr key={h.symbol}>
              <td>
                <button type="button" className="pt-link strong" onClick={() => onOpen(h.symbol)}>
                  {h.name}
                </button>
              </td>
              <td className="num">{compactInr(h.value)}</td>
              <td className="num">{weightPct(h.weight, 0)}</td>
              <td className="num">
                <Delta value={h.pnl} text={signedInr(h.pnl, 0)} />
              </td>
              <td>
                <Sparkline values={closes.get(h.symbol) ?? []} label={`${h.name} last month`} width={64} height={22} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
