// The buy/sell flow as plain logic: what a ticket checks before it lets an order through, and the order of
// steps from picking a stock to seeing it filled. The components only draw this.
//
//   IDLE → QUANTITY → (validate) → REVIEW → EXECUTING → SUCCESS
//                                              ↘ ERROR → back to QUANTITY
import { availableCash, execPrice, sellableQty, validateQuantity, previewCharges, type EngineState } from "./engine";
import type { ChargeBreakdown } from "../costs/charges";
import { findSymbol } from "./universe";
import type { Quote, Side } from "./types";

export const MARKET = "MARKET" as const;

// --- the checks ---------------------------------------------------------------------------------------------

export type IssueCode = "no_price" | "stale_price" | "simulated_price" | "bad_quantity" | "insufficient_cash" | "not_owned" | "over_owned";

export type TicketIssue = {
  code: IssueCode;
  message: string;
  /** A blocking issue stops the order; a warning is shown and the order can still go ahead. */
  blocking: boolean;
};

export type TicketCheck = {
  ok: boolean;
  issues: TicketIssue[];
  /** The price the order is estimated to fill at: the live price with the configured slippage. Null with no price. */
  price: number | null;
  /** Quantity x price. */
  value: number;
  charges: number;
  /** Each charge that makes up `charges`, for the breakdown. Null when there is no price or no valid quantity. */
  breakdown: ChargeBreakdown | null;
  /** Buy: what leaves the account (value + charges). Sell: what comes in (value - charges). */
  total: number;
  cash: number;
  cashAfter: number;
  /** How much more cash a buy needs; zero when it can be paid for. */
  shortfall: number;
  held: number;
  /** Shares left after a sell. */
  remaining: number;
};

/** A reading older than this, from a live feed, is shown with a warning. The feed refreshes every 20 seconds. */
export const STALE_AFTER_MS = 5 * 60_000;

export function parseQty(text: string): number {
  const n = Number(text.trim().replace(/,/g, ""));
  return text.trim() === "" ? Number.NaN : n;
}

/**
 * Everything the ticket shows and everything that can stop an order, for one side, quantity and price. It uses the
 * engine's own functions for the fill price, the charges and the sell limit, so the number a user is shown is the
 * number the engine will apply.
 */
export function checkTicket(input: {
  engine: EngineState;
  symbol: string;
  side: Side;
  qty: number;
  quote: Quote | null;
  now?: number;
}): TicketCheck {
  const { engine, symbol, side, qty, quote } = input;
  const now = input.now ?? Date.now();
  const issues: TicketIssue[] = [];
  const cash = availableCash(engine);
  const held = sellableQty(engine, symbol);
  const name = findSymbol(symbol).name;

  const qtyProblem = validateQuantity(symbol, qty);
  const validQty = qtyProblem === null;
  if (!validQty) issues.push({ code: "bad_quantity", message: qtyProblem, blocking: true });

  const hasPrice = !!quote && Number.isFinite(quote.last) && quote.last > 0;
  const price = hasPrice ? execPrice(side, quote!, engine.fees) : null;
  if (!hasPrice) {
    issues.push({ code: "no_price", message: `Price unavailable for ${name} right now. Try again in a moment.`, blocking: true });
  } else if (quote!.live === false) {
    issues.push({ code: "simulated_price", message: "This is a simulated price, not the market's.", blocking: false });
  } else if (quote!.ts > 0 && now - quote!.ts > STALE_AFTER_MS) {
    const when = new Date(quote!.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    issues.push({ code: "stale_price", message: `Market data may be delayed. Last updated ${when}.`, blocking: false });
  }

  const q = validQty ? qty : 0;
  const value = price != null ? price * q : 0;
  const breakdown = price != null && q > 0 ? previewCharges({ fees: engine.fees, fills: engine.fills, symbol, side, qty: q, price }) : null;
  const charges = breakdown?.total ?? 0;
  const total = side === "buy" ? value + charges : value - charges;

  let shortfall = 0;
  if (side === "buy" && price != null && validQty) {
    shortfall = Math.max(0, total - cash);
    if (shortfall > 1e-6) issues.push({ code: "insufficient_cash", message: "Insufficient cash", blocking: true });
    else shortfall = 0;
  }
  if (side === "sell" && validQty) {
    if (held <= 0) issues.push({ code: "not_owned", message: `You don't own ${name}. You can only sell stocks currently held in your portfolio.`, blocking: true });
    else if (qty > held + 1e-9) issues.push({ code: "over_owned", message: `You hold ${held}, so you can sell at most ${held}.`, blocking: true });
  }

  return {
    ok: !issues.some((i) => i.blocking),
    issues,
    price,
    value,
    charges,
    breakdown,
    total,
    cash,
    cashAfter: side === "buy" ? cash - total : cash + total,
    shortfall,
    held,
    remaining: Math.max(0, held - (validQty ? qty : 0)),
  };
}

/** The most shares a buy can be for with the cash at hand, charges included. Zero when not even one can be paid for. */
export function maxBuyQty(engine: EngineState, symbol: string, quote: Quote | null): number {
  if (!quote || !(quote.last > 0)) return 0;
  const price = execPrice("buy", quote, engine.fees);
  let qty = Math.floor(availableCash(engine) / price);
  while (qty > 0 && checkTicket({ engine, symbol, side: "buy", qty, quote, now: 0 }).issues.some((i) => i.code === "insufficient_cash")) qty -= 1;
  return Math.max(0, qty);
}

// --- what a finished order reports ---------------------------------------------------------------------------

export type Receipt = {
  side: Side;
  symbol: string;
  name: string;
  qty: number;
  price: number;
  value: number;
  charges: number;
  total: number;
  /** For a sell: profit or loss booked, after the charges on both legs. */
  realized: number | null;
  cashAfter: number;
  time: number;
};

// --- the steps -------------------------------------------------------------------------------------------------

export type FlowStep = "idle" | "quantity" | "review" | "executing" | "success" | "error";

export type FlowState = {
  step: FlowStep;
  symbol: string | null;
  side: Side;
  /** What is typed in the quantity box, kept as text so a half-typed number is not rewritten under the user. */
  qtyText: string;
  receipt: Receipt | null;
  error: string | null;
};

export const IDLE_FLOW: FlowState = { step: "idle", symbol: null, side: "buy", qtyText: "1", receipt: null, error: null };

export type FlowAction =
  | { type: "open"; symbol: string; side: Side; qty?: number }
  | { type: "side"; side: Side }
  | { type: "qty"; text: string }
  | { type: "review"; ok: boolean }
  | { type: "back" }
  | { type: "confirm" }
  | { type: "filled"; receipt: Receipt }
  | { type: "failed"; message: string }
  | { type: "close" };

/** A move that does not belong to the current step is ignored, so a double click or a late callback cannot skip one. */
export function flowReducer(state: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case "open":
      return { step: "quantity", symbol: a.symbol, side: a.side, qtyText: String(a.qty ?? 1), receipt: null, error: null };
    case "side":
      return state.step === "quantity" ? { ...state, side: a.side } : state;
    case "qty":
      return state.step === "quantity" ? { ...state, qtyText: a.text } : state;
    case "review":
      return state.step === "quantity" && a.ok ? { ...state, step: "review" } : state;
    case "back":
      return state.step === "review" || state.step === "error" ? { ...state, step: "quantity", error: null } : state;
    case "confirm":
      return state.step === "review" ? { ...state, step: "executing" } : state;
    case "filled":
      return state.step === "executing" ? { ...state, step: "success", receipt: a.receipt } : state;
    case "failed":
      return state.step === "executing" ? { ...state, step: "error", error: a.message } : state;
    case "close":
      return IDLE_FLOW;
    default:
      return state;
  }
}
