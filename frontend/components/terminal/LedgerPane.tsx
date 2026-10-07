"use client";

import { useState } from "react";
import "@/components/costs/cx.css";
import { ChargeSheet } from "@/components/costs/ChargeSheet";
import { fillsToCsv } from "@/lib/trading/engine";
import { inr, px } from "@/lib/trading/format";
import type { Fill } from "@/lib/trading/types";
import { findSymbol } from "@/lib/trading/universe";

const when = (t: number) => new Date(t).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Every execution with its charges: date, stock, buy or sell, quantity, price, gross value, charges
 * and the net debit or credit. A row opens the full charge breakdown, which is what makes the
 * ledger auditable.
 */
export function LedgerPane({ fills, onDownload }: { fills: Fill[]; onDownload?: (name: string, text: string) => void }) {
  const [open, setOpen] = useState<Fill | null>(null);
  if (fills.length === 0) {
    return (
      <div className="empty-compact">
        <strong>No transactions yet</strong>
        <p>Every simulated order will appear here with its gross value, charges and net amount.</p>
      </div>
    );
  }
  const totalCharges = fills.reduce((s, f) => s + f.charges.total, 0);
  return (
    <>
      <div className="wl-head">
        <span className="cx-quiet-text">{fills.length} transaction{fills.length === 1 ? "" : "s"} · charges {inr(totalCharges)}</span>
        {onDownload ? (
          <button type="button" className="btn ghost" onClick={() => onDownload("ledger.csv", fillsToCsv(fills))}>CSV</button>
        ) : null}
      </div>
      <div className="cx-table-wrap">
        <table className="cx-table" aria-label="Transaction ledger">
          <thead>
            <tr>
              {["Date", "Stock", "Buy/Sell", "Qty", "Price", "Gross", "Charges", "Net"].map((h) => <th key={h} scope="col">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {fills.map((f) => (
              <tr key={f.id} className="cx-click" onClick={() => setOpen(f)}>
                <td>{when(f.time)}</td>
                <td>
                  <button type="button" className="cx-rowbtn" aria-label={`Charge breakdown for ${f.side} ${f.qty} ${findSymbol(f.symbol).name}`} onClick={(e) => { e.stopPropagation(); setOpen(f); }}>
                    {findSymbol(f.symbol).name}
                  </button>
                  {f.product === "intraday" ? <small className="cx-quiet-text"> intraday</small> : null}
                </td>
                <td>{f.side === "buy" ? "BUY" : "SELL"}</td>
                <td>{f.qty}</td>
                <td>{px(f.price)}</td>
                <td>{inr(f.gross)}</td>
                <td>{f.charges.modelled ? inr(f.charges.total) : "—"}</td>
                <td>{f.side === "buy" ? `−${inr(f.net)}` : `+${inr(f.net)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <ChargeSheet
          charges={open.charges}
          title="Charge breakdown"
          subtitle={`${open.side === "buy" ? "Bought" : "Sold"} ${open.qty} ${findSymbol(open.symbol).name} at ₹${px(open.price)} · ${when(open.time)}${open.product === "intraday" ? " · intraday" : ""}`}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
