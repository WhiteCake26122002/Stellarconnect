"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { CHARGES } from "@/lib/costs/rules";
import type { ChargeBreakdown } from "@/lib/costs/charges";
import { calculateHoldings } from "@/lib/trading/analytics";
import type { EngineState } from "@/lib/trading/engine";
import { inr, px, signedInr, signedPx, pct } from "@/lib/trading/format";
import { checkTicket, maxBuyQty, parseQty, type TicketCheck } from "@/lib/trading/orderFlow";
import type { Quote, Side } from "@/lib/trading/types";
import { findSymbol } from "@/lib/trading/universe";
import { Delta, EmptyState, Skeleton, useDialog, useFlash } from "./ui";

/** The price in a header: eases between values and tints briefly in the direction of the move. */
export function LivePrice({ value, className }: { value: number; className?: string }) {
  const flash = useFlash(value);
  return (
    <b className={`pt-price mono${flash ? ` flash-${flash}` : ""}${className ? ` ${className}` : ""}`}>
      <AnimatedNumber value={value} format={(n) => px(n)} duration={350} />
    </b>
  );
}

export function BuySellToggle({ side, onChange }: { side: Side; onChange: (s: Side) => void }) {
  return (
    <div className="pt-toggle" role="group" aria-label="Order side">
      <button type="button" className={`buy${side === "buy" ? " on" : ""}`} aria-pressed={side === "buy"} onClick={() => onChange("buy")}>
        BUY
      </button>
      <button type="button" className={`sell${side === "sell" ? " on" : ""}`} aria-pressed={side === "sell"} onClick={() => onChange("sell")}>
        SELL
      </button>
    </div>
  );
}

export function QuantityInput({
  value,
  step,
  onChange,
  max,
  invalid,
  describedBy,
}: {
  value: string;
  step: number;
  onChange: (text: string) => void;
  /** The most that can be entered, when there is a limit (shares held for a sell). */
  max?: number;
  invalid?: boolean;
  describedBy?: string;
}) {
  const n = parseQty(value);
  const set = (next: number) => onChange(String(Math.max(0, Number(next.toFixed(6)))));
  return (
    <div className="pt-field">
      <label htmlFor="pt-qty">Quantity</label>
      <span className={`pt-qty${invalid ? " invalid" : ""}`}>
        <button type="button" aria-label="Decrease quantity" onClick={() => set(Number.isFinite(n) ? Math.max(step, n - step) : step)} disabled={Number.isFinite(n) && n <= step}>
          −
        </button>
        <input
          id="pt-qty"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          max={max}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              set(Number.isFinite(n) ? n + step : step);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              set(Number.isFinite(n) ? Math.max(step, n - step) : step);
            }
          }}
        />
        <button type="button" aria-label="Increase quantity" onClick={() => set(Number.isFinite(n) ? (max != null ? Math.min(max, n + step) : n + step) : step)} disabled={max != null && Number.isFinite(n) && n >= max}>
          +
        </button>
      </span>
    </div>
  );
}

/** Every charge on its own line, then the total. Used in the ticket (folded) and the confirmation (open). */
export function ChargeBreakdownRows({ charges, tradeValue }: { charges: ChargeBreakdown; tradeValue?: number }) {
  if (!charges.modelled) return <p className="pt-note">{charges.notes[0]}</p>;
  return (
    <dl className="pt-rows pt-charges" aria-label="Charge breakdown">
      {tradeValue != null ? (
        <div>
          <dt>Trade value</dt>
          <dd>{inr(tradeValue)}</dd>
        </div>
      ) : null}
      {charges.lines.map((l) => (
        <div key={l.key} className="quiet">
          <dt>
            <span>{l.label}</span>
            <small>{l.rateText}</small>
          </dt>
          <dd>{inr(l.amount)}</dd>
        </div>
      ))}
      <div className="total">
        <dt>Total charges</dt>
        <dd>{inr(charges.total)}</dd>
      </div>
    </dl>
  );
}

export type TicketProps = {
  symbol: string;
  side: Side;
  qtyText: string;
  quote: Quote | null;
  /** "loading" while a price for this symbol is being fetched; "error" when that failed. */
  priceState: "ok" | "loading" | "error";
  engine: EngineState;
  onSide: (s: Side) => void;
  onQty: (text: string) => void;
  onReview: () => void;
  onRetryPrice?: () => void;
};

/**
 * The one order ticket. Every Buy and Sell in the app opens this: the header buttons, the watchlist, the positions
 * table, the heat map. It always places a market order, long only, paid for in cash; there is nothing else to pick.
 */
export function OrderTicket({ symbol, side, qtyText, quote, priceState, engine, onSide, onQty, onReview, onRetryPrice }: TicketProps) {
  const info = findSymbol(symbol);
  const qty = parseQty(qtyText);
  const check = useMemo(() => checkTicket({ engine, symbol, side, qty, quote }), [engine, symbol, side, qty, quote]);
  const [showCharges, setShowCharges] = useState(false);
  const [nudge, setNudge] = useState(0);
  const alertRef = useRef<HTMLDivElement>(null);
  const holding = useMemo(() => (quote ? calculateHoldings(engine, new Map([[symbol, quote]])).find((h) => h.symbol === symbol) : calculateHoldings(engine, new Map()).find((h) => h.symbol === symbol)), [engine, symbol, quote]);
  const buy = side === "buy";
  const last = quote?.last ?? 0;
  const blocking = check.issues.filter((i) => i.blocking);
  const warnings = check.issues.filter((i) => !i.blocking);
  const emptyQty = !Number.isFinite(qty);
  // A blank box is not an error yet: the ticket asks for a quantity, it does not scold.
  const sellNothing = !buy && check.held <= 0;
  // The "You don't own this" panel already says it; a missing price is "Loading", not an error, while it is on its way.
  const showBlocking = blocking.filter((i) => !(emptyQty && i.code === "bad_quantity") && !(sellNothing && i.code === "not_owned") && !(priceState === "loading" && i.code === "no_price"));

  function review() {
    if (check.ok) onReview();
    else {
      setNudge((n) => n + 1);
      alertRef.current?.focus();
    }
  }

  const ctaLabel = `${buy ? "BUY" : "SELL"} ${info.symbol}`;

  return (
    <section className="pt-ticket" aria-label="Order ticket">
      <header className="pt-tk-head">
        <div>
          <strong>{info.name}</strong>
          <span>
            {info.symbol} · {info.exchange}
          </span>
        </div>
        <div className="pt-tk-px">
          {quote && last > 0 ? (
            <>
              <LivePrice value={last} />
              <Delta value={quote.change} text={`${signedPx(quote.change)} (${pct(quote.changePct)})`} />
            </>
          ) : priceState === "loading" ? (
            <Skeleton w={84} h={20} label={`Loading the price of ${info.name}`} />
          ) : (
            <span className="pt-muted">Price unavailable</span>
          )}
        </div>
      </header>

      <BuySellToggle side={side} onChange={onSide} />

      {priceState === "error" && !last ? (
        <div className="pt-inline-error" role="alert">
          <span>Couldn’t get a price for {info.name}.</span>
          {onRetryPrice ? (
            <button type="button" className="pt-link" onClick={onRetryPrice}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      {!buy && holding ? (
        <dl className="pt-rows pt-position" aria-label={`Your ${info.name} position`}>
          <div>
            <dt>Owned quantity</dt>
            <dd>{holding.qty}</dd>
          </div>
          <div>
            <dt>Average buy price</dt>
            <dd>{inr(holding.avgPrice)}</dd>
          </div>
          <div>
            <dt>Current price</dt>
            <dd>{holding.hasQuote ? inr(holding.last) : "—"}</dd>
          </div>
          <div>
            <dt>Market value</dt>
            <dd>{inr(holding.value)}</dd>
          </div>
          <div>
            <dt>Unrealized P&amp;L</dt>
            <dd>
              <Delta value={holding.pnl} text={signedInr(holding.pnl)} />
            </dd>
          </div>
        </dl>
      ) : null}

      {sellNothing ? (
        <EmptyState
          title="You don’t own this stock"
          body="You can only sell stocks currently held in your portfolio."
          action={{ label: "Buy instead", onClick: () => onSide("buy") }}
        />
      ) : (
        <>
          <QuantityInput
            value={qtyText}
            step={info.lotSize}
            onChange={onQty}
            max={buy ? undefined : check.held}
            invalid={showBlocking.length > 0}
            describedBy="pt-issues"
          />
          <div className="pt-chips" role="group" aria-label="Quick amounts">
            {buy ? (
              <button type="button" onClick={() => onQty(String(Math.max(1, maxBuyQty(engine, symbol, quote))))} disabled={maxBuyQty(engine, symbol, quote) <= 0}>
                Max
              </button>
            ) : (
              [0.25, 0.5, 0.75, 1].map((f) => {
                const n = f === 1 ? check.held : Math.max(1, Math.floor(check.held * f));
                return (
                  <button key={f} type="button" onClick={() => onQty(String(n))} aria-label={f === 1 ? `Sell all ${check.held}` : `Sell ${f * 100} percent`}>
                    {f === 1 ? "All" : `${f * 100}%`}
                  </button>
                );
              })
            )}
          </div>

          <dl className="pt-rows" aria-label="Order summary" aria-live="polite">
            <div>
              <dt>Estimated price</dt>
              <dd>{check.price != null ? inr(check.price) : "—"}</dd>
            </div>
            <div>
              <dt>Trade value</dt>
              <dd>{check.price != null && !emptyQty && check.value > 0 ? inr(check.value) : "—"}</dd>
            </div>
            <div>
              <dt>
                <button type="button" className="pt-link" aria-expanded={showCharges} onClick={() => setShowCharges((v) => !v)}>
                  Estimated charges {showCharges ? "▴" : "▾"}
                </button>
              </dt>
              <dd>{check.breakdown ? inr(check.charges) : "—"}</dd>
            </div>
            {showCharges && check.breakdown ? <ChargeBreakdownRows charges={check.breakdown} /> : null}
            <div className="total">
              <dt>{buy ? "Total required" : "Net proceeds"}</dt>
              <dd>{check.breakdown ? inr(check.total) : "—"}</dd>
            </div>
            {buy ? (
              <>
                <div>
                  <dt>Available cash</dt>
                  <dd>{inr(check.cash, 0)}</dd>
                </div>
                {check.shortfall > 0 ? (
                  <div className="short">
                    <dt>Shortfall</dt>
                    <dd>{inr(check.shortfall)}</dd>
                  </div>
                ) : (
                  <div>
                    <dt>Cash after trade</dt>
                    <dd>{check.breakdown ? inr(check.cashAfter, 0) : "—"}</dd>
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <dt>Selling</dt>
                  <dd>{Number.isFinite(qty) && qty > 0 ? `${qty} ${qty === 1 ? "share" : "shares"}` : "—"}</dd>
                </div>
                <div>
                  <dt>Remaining</dt>
                  <dd>{Number.isFinite(qty) && qty > 0 && qty <= check.held ? `${check.remaining} ${check.remaining === 1 ? "share" : "shares"}` : `${check.held} ${check.held === 1 ? "share" : "shares"}`}</dd>
                </div>
                <div>
                  <dt>Cash after sale</dt>
                  <dd>{check.breakdown ? inr(check.cashAfter, 0) : "—"}</dd>
                </div>
              </>
            )}
          </dl>
        </>
      )}

      <div id="pt-issues" ref={alertRef} tabIndex={-1} className={`pt-issues${showBlocking.length ? " has" : ""}`} key={nudge} data-nudge={nudge > 0 ? "1" : undefined}>
        {showBlocking.map((i) => (
          <p key={i.code} role="alert" className="pt-issue block">
            {i.message}
            {i.code === "insufficient_cash" && check.shortfall > 0 ? ` · Shortfall ${inr(check.shortfall)}` : ""}
          </p>
        ))}
        {warnings.map((i) => (
          <p key={i.code} role="status" className="pt-issue warn">
            {i.message}
          </p>
        ))}
      </div>

      {!sellNothing ? (
        <button type="button" className={`pt-cta ${side}`} aria-disabled={!check.ok} onClick={review}>
          {ctaLabel}
        </button>
      ) : null}
      <p className="pt-fine">Market order at the estimated price. {CHARGES.disclaimer}</p>
    </section>
  );
}

/** The ticket in a floating panel: a centred dialog on a desktop, a sheet that rises from the bottom on a phone. */
export function OrderSheet({ onClose, children, label }: { onClose: () => void; children: React.ReactNode; label: string }) {
  const ref = useDialog(onClose);
  return (
    <div className="pt-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pt-sheet" role="dialog" aria-modal="true" aria-label={label} ref={ref}>
        <button type="button" className="pt-x" aria-label="Close order ticket" onClick={onClose}>
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

export type { TicketCheck };
