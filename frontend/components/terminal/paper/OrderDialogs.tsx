"use client";

import { useState } from "react";
import { inr, signedInr } from "@/lib/trading/format";
import type { Receipt, TicketCheck } from "@/lib/trading/orderFlow";
import type { Side } from "@/lib/trading/types";
import { findSymbol } from "@/lib/trading/universe";
import { ChargeBreakdownRows } from "./OrderTicket";
import { Delta, useDialog } from "./ui";

const unit = (n: number) => (n === 1 ? "share" : "shares");

/** "Confirm order": what will happen, with the numbers the engine will use, and one clear way forward. */
export function OrderConfirmation({
  symbol,
  side,
  qty,
  check,
  busy,
  onCancel,
  onConfirm,
}: {
  symbol: string;
  side: Side;
  qty: number;
  check: TicketCheck;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (thesis: { why: string; expected: string } | null) => void;
}) {
  const info = findSymbol(symbol);
  const ref = useDialog(onCancel);
  const buy = side === "buy";
  const [why, setWhy] = useState("");
  const [expected, setExpected] = useState("");
  return (
    <div className="pt-overlay confirm" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="pt-dialog" role="dialog" aria-modal="true" aria-label="Confirm order" ref={ref}>
        <header>
          <h2>Confirm order</h2>
        </header>
        <p className={`pt-confirm-lead ${side}`}>
          <b>
            {buy ? "BUY" : "SELL"} {info.symbol}
          </b>
          <span>
            {qty} {unit(qty)}
          </span>
        </p>
        <dl className="pt-rows">
          <div>
            <dt>Estimated price</dt>
            <dd>{check.price != null ? inr(check.price) : "—"}</dd>
          </div>
          <div>
            <dt>Trade value</dt>
            <dd>{inr(check.value)}</dd>
          </div>
          <div>
            <dt>Estimated charges</dt>
            <dd>{inr(check.charges)}</dd>
          </div>
          <div className="total">
            <dt>{buy ? "Total" : "Net proceeds"}</dt>
            <dd>{inr(check.total)}</dd>
          </div>
          <div>
            <dt>Cash after order</dt>
            <dd>{inr(check.cashAfter, 0)}</dd>
          </div>
          {!buy ? (
            <div>
              <dt>Shares remaining</dt>
              <dd>{check.remaining}</dd>
            </div>
          ) : null}
        </dl>
        {check.breakdown ? (
          <details className="pt-more">
            <summary>How the charges add up</summary>
            <ChargeBreakdownRows charges={check.breakdown} />
          </details>
        ) : null}
        {buy ? (
          <details className="pt-more pt-thesis">
            <summary>Add your reason (optional)</summary>
            <label htmlFor="pt-why">Why are you buying?</label>
            <textarea id="pt-why" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Results look strong, breakout above resistance…" />
            <label htmlFor="pt-exp">What do you expect to happen?</label>
            <textarea id="pt-exp" rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Up 8% in three months…" />
          </details>
        ) : null}
        <p className="pt-fine">Paper trade at a market price. Confirming does not send a live order.</p>
        <div className="pt-actions">
          <button type="button" className="pt-btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`pt-cta ${side}${busy ? " busy" : ""}`}
            data-autofocus
            disabled={busy}
            onClick={() => onConfirm(buy && (why.trim() || expected.trim()) ? { why: why.trim(), expected: expected.trim() } : null)}
          >
            {busy ? "Placing order…" : buy ? "Confirm Buy" : "Confirm Sell"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A tick that draws itself once. Under reduced motion it simply appears. */
function Tick() {
  return (
    <svg className="pt-tick" viewBox="0 0 52 52" width="52" height="52" aria-hidden>
      <circle cx="26" cy="26" r="23" fill="none" strokeWidth="2.5" />
      <path d="M15 27.5l8 8 15-17" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
    </svg>
  );
}

export function OrderSuccess({ receipt, onClose, onView }: { receipt: Receipt; onClose: () => void; onView: () => void }) {
  const ref = useDialog(onClose);
  const buy = receipt.side === "buy";
  return (
    <div className="pt-overlay confirm" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pt-dialog success" role="dialog" aria-modal="true" aria-label="Order executed" ref={ref}>
        <Tick />
        <h2>{buy ? "Buy" : "Sell"} order executed</h2>
        <p className="pt-success-name">{receipt.name}</p>
        <dl className="pt-rows">
          <div>
            <dt>{receipt.qty === 1 ? "1 share" : `${receipt.qty} shares`}</dt>
            <dd>{inr(receipt.price)}</dd>
          </div>
          <div>
            <dt>Charges</dt>
            <dd>{inr(receipt.charges)}</dd>
          </div>
          <div className="total">
            <dt>{buy ? "Total" : "Net proceeds"}</dt>
            <dd>{inr(receipt.total)}</dd>
          </div>
          {receipt.realized != null ? (
            <div>
              <dt>Realized P&amp;L</dt>
              <dd>
                <Delta value={receipt.realized} text={signedInr(receipt.realized)} />
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Cash now</dt>
            <dd>{inr(receipt.cashAfter, 0)}</dd>
          </div>
        </dl>
        <div className="pt-actions">
          <button type="button" className="pt-btn ghost" onClick={onClose} data-autofocus>
            Done
          </button>
          <button type="button" className="pt-btn" onClick={onView}>
            {buy ? "View position →" : "View portfolio →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OrderFailure({ message, onBack, onClose }: { message: string; onBack: () => void; onClose: () => void }) {
  const ref = useDialog(onClose);
  return (
    <div className="pt-overlay confirm" role="presentation">
      <div className="pt-dialog" role="alertdialog" aria-modal="true" aria-label="Order not placed" ref={ref}>
        <h2>Order not placed</h2>
        <p>{message}</p>
        <p className="pt-fine">Nothing was bought or sold and your cash is unchanged.</p>
        <div className="pt-actions">
          <button type="button" className="pt-btn ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="pt-btn" onClick={onBack} data-autofocus>
            Back to ticket
          </button>
        </div>
      </div>
    </div>
  );
}
