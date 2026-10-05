"use client";

import { useState } from "react";
import { validateOrder } from "@/lib/trading/engine";
import { inr, px } from "@/lib/trading/format";
import type { Quote, Side } from "@/lib/trading/types";
import { findSymbol } from "@/lib/trading/universe";

export type TicketValues = {
  side: Side;
  type: "market";
  qty: number;
  sl?: number;
  tp?: number;
};

export function TradeTicket({
  symbol,
  quote,
  initialSide = "buy",
  defaultQty,
  onSubmit,
  compact = false,
  cash,
  learning = false,
}: {
  symbol: string;
  quote: Quote | null;
  initialSide?: Side;
  defaultQty?: number;
  onSubmit: (v: TicketValues) => void;
  compact?: boolean;
  cash?: number;
  learning?: boolean;
}) {
  const info = findSymbol(symbol);
  const last = quote?.last || info.base;
  const [side, setSide] = useState<Side>(initialSide);
  const [qty, setQty] = useState(defaultQty || info.lotSize);
  const [sl, setSl] = useState<string>("");
  const [tp, setTp] = useState<string>("");
  const [err, setErr] = useState("");

  const slN = sl === "" ? undefined : Number(sl);
  const tpN = tp === "" ? undefined : Number(tp);
  const value = last * qty;
  const feesEst = 0;

  function place() {
    const v: TicketValues = {
      side,
      type: "market",
      qty,
      sl: slN,
      tp: tpN,
    };
    const msg = validateOrder({ ...v, last });
    if (msg) {
      setErr(msg);
      return;
    }
    setErr("");
    onSubmit(v);
  }

  return (
    <form
      className={`ticket ${compact ? "compact" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        place();
      }}
    >
      <header className="ticket-head">
        <div>
          <strong>{info.name}</strong>
          <span className="muted">
            {info.symbol} · {info.exchange} · market
          </span>
        </div>
        {quote ? (
          <div className="ticket-px">
            <b className="mono">{px(quote.last)}</b>
            <span className={quote.change >= 0 ? "up" : "down"}>
              {quote.change >= 0 ? "+" : "−"}
              {px(Math.abs(quote.changePct * 100), 2)}%
            </span>
          </div>
        ) : null}
      </header>
      {cash != null ? (
        <div className="ticket-avail" aria-label="Available cash">
          <span>Available cash</span>
          <b className="mono">{inr(cash, 0)}</b>
        </div>
      ) : null}
      {learning ? (
        <p className="learn-hint">
          Market fills at the last price. Quantity steps by {info.lotSize}.
        </p>
      ) : null}
      <div className="side-toggle" role="group" aria-label="Order side">
        <button type="button" className={side === "buy" ? "buy on" : "buy"} aria-pressed={side === "buy"} onClick={() => setSide("buy")}>
          BUY
        </button>
        <button type="button" className={side === "sell" ? "sell on" : "sell"} aria-pressed={side === "sell"} onClick={() => setSide("sell")}>
          SELL
        </button>
      </div>
      <div className="qty-field">
        <label htmlFor="ticket-qty">Quantity</label>
        <span className="qty-step">
          <button type="button" aria-label="Decrease lots" onClick={() => setQty(Math.max(info.lotSize, qty - info.lotSize))}>−</button>
          <input id="ticket-qty" type="number" min={info.lotSize} step={info.lotSize} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          <button type="button" aria-label="Increase lots" onClick={() => setQty(qty + info.lotSize)}>+</button>
        </span>
      </div>
      <label>
        Stop loss
        <input type="number" step={info.tickSize} placeholder="Optional" value={sl} onChange={(e) => setSl(e.target.value)} />
      </label>
      <label>
        Take profit
        <input type="number" step={info.tickSize} placeholder="Optional" value={tp} onChange={(e) => setTp(e.target.value)} />
      </label>
      <dl className="ticket-risk">
        <div>
          <dt>Order value</dt>
          <dd>{inr(value)}</dd>
        </div>
      </dl>
      {feesEst ? <p className="note">Est. fees {inr(feesEst)}</p> : null}
      {err ? <p className="error">{err}</p> : null}
      <button type="submit" className={`btn ticket-go ${side}`}>
        PLACE {side === "buy" ? "BUY" : "SELL"} ORDER
      </button>
    </form>
  );
}
