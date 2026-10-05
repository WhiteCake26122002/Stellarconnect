import type {
  FeeConfig,
  Order,
  OrderType,
  PaperAccount,
  Position,
  Quote,
  Side,
  Trade,
} from "./types";
import { findSymbol } from "./universe";

export const DEFAULT_FEES: FeeConfig = {
  brokeragePct: 0,
  txnPct: 0,
  taxPct: 0,
  slippagePct: 0.01,
};

export function todayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function freshAccount(balance = 1_000_000): PaperAccount {
  return {
    startingBalance: balance,
    cash: balance,
    realizedPnl: 0,
    dayPnlStartEquity: balance,
    dayAnchor: todayKey(),
  };
}

export function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function feeOn(notional: number, fees: FeeConfig) {
  return notional * ((fees.brokeragePct + fees.txnPct + fees.taxPct) / 100);
}

export function marginFor(_symbol: string, px: number, qty: number) {
  return Math.abs(px * qty);
}

export function execPrice(side: Side, quote: Quote, type: OrderType, fees: FeeConfig, limit?: number) {
  const slip = quote.last * (fees.slippagePct / 100);
  if (type === "market") return side === "buy" ? quote.ask + slip : quote.bid - slip;
  if (type === "limit" && limit != null) return limit;
  if (type === "stop") return side === "buy" ? quote.ask + slip : quote.bid - slip;
  if (type === "stop_limit" && limit != null) return limit;
  return quote.last;
}

export function validateOrder(input: {
  side: Side;
  qty: number;
  type: OrderType;
  price?: number;
  trigger?: number;
  sl?: number;
  tp?: number;
  last: number;
}): string | null {
  if (!Number.isFinite(input.qty) || input.qty <= 0) return "Invalid quantity.";
  if (input.type !== "market") return "Only market orders are allowed.";
  const entry = input.price || input.last;
  if (input.sl != null) {
    if (input.side === "buy" && input.sl >= entry) return "Stop loss must be below entry price for a long position.";
    if (input.side === "sell" && input.sl <= entry) return "Stop loss must be above entry price for a short position.";
  }
  if (input.tp != null) {
    if (input.side === "buy" && input.tp <= entry) return "Take profit must be above entry price for a long position.";
    if (input.side === "sell" && input.tp >= entry) return "Take profit must be below entry price for a short position.";
  }
  return null;
}

export function riskReward(side: Side, entry: number, qty: number, sl?: number, tp?: number) {
  const dir = side === "buy" ? 1 : -1;
  const risk = sl != null ? Math.abs(entry - sl) * qty : 0;
  const reward = tp != null ? Math.abs(tp - entry) * qty : 0;
  const ratio = risk > 0 && reward > 0 ? reward / risk : 0;
  return { risk, reward, ratio, dir };
}

export type EngineState = {
  account: PaperAccount;
  orders: Order[];
  positions: Position[];
  trades: Trade[];
  fees: FeeConfig;
};

export function positionValue(p: Position, last: number) {
  return marginFor(p.symbol, p.avgPrice, p.qty) + unrealized(p, last);
}

export function equity(state: EngineState, quotes: Map<string, Quote>) {
  let mv = 0;
  for (const p of state.positions) {
    if (p.status === "closed") continue;
    const last = quotes.get(p.symbol)?.last ?? p.avgPrice;
    mv += positionValue(p, last);
  }
  return state.account.cash + mv;
}

export function invested(state: EngineState) {
  return usedMargin(state);
}

export function usedMargin(state: EngineState) {
  return state.positions.reduce((s, p) => (p.status === "closed" ? s : s + marginFor(p.symbol, p.avgPrice, p.qty)), 0);
}

export function unrealized(p: Position, last: number) {
  const dir = p.side === "long" ? 1 : -1;
  return (last - p.avgPrice) * p.qty * dir;
}

export function buyingPower(state: EngineState, _quotes?: Map<string, Quote>) {
  return Math.max(0, state.account.cash);
}

export function placeOrder(
  state: EngineState,
  input: {
    symbol: string;
    side: Side;
    type: OrderType;
    qty: number;
    price?: number;
    trigger?: number;
    sl?: number;
    tp?: number;
    replay?: boolean;
  },
  quote: Quote,
  quotes: Map<string, Quote>,
): { state: EngineState; order: Order; error?: string } {
  const err = validateOrder({ ...input, last: quote.last });
  if (err) {
    const order: Order = {
      id: uid("ord"),
      time: Date.now(),
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      qty: input.qty,
      filledQty: 0,
      price: input.price,
      trigger: input.trigger,
      status: "rejected",
      rejectReason: err,
      replay: input.replay,
    };
    return { state: { ...state, orders: [order, ...state.orders] }, order, error: err };
  }

  const pxEst = execPrice(input.side, quote, "market", state.fees);
  const notion = marginFor(input.symbol, pxEst, input.qty);
  const bp = buyingPower(state, quotes);
  const existingPos = state.positions.find((p) => p.symbol === input.symbol && p.status !== "closed");
  const reducing =
    existingPos &&
    ((existingPos.side === "long" && input.side === "sell") || (existingPos.side === "short" && input.side === "buy"));
  const leftoverQty = reducing ? Math.max(0, input.qty - existingPos.qty) : input.qty;
  const needCash = reducing ? marginFor(input.symbol, pxEst, leftoverQty) : notion;
  if (input.type === "market" && needCash > bp + 1e-6) {
    const msg = "Not enough cash.";
    const order: Order = {
      id: uid("ord"),
      time: Date.now(),
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      qty: input.qty,
      filledQty: 0,
      status: "rejected",
      rejectReason: msg,
      replay: input.replay,
    };
    return { state: { ...state, orders: [order, ...state.orders] }, order, error: msg };
  }

  const order: Order = {
    id: uid("ord"),
    time: Date.now(),
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    qty: input.qty,
    filledQty: 0,
    price: input.price,
    trigger: input.trigger,
    status: "pending",
    replay: input.replay,
  };

  let next = { ...state, orders: [order, ...state.orders] };
  if (input.type === "market") {
    next = fillOrder(next, order.id, quote, input.sl, input.tp);
  }
  return { state: next, order: next.orders.find((o) => o.id === order.id) || order };
}

export function cancelWorkingOrders(state: EngineState): EngineState {
  return {
    ...state,
    orders: state.orders.map((order) =>
      order.status === "pending" && order.type !== "market" ? { ...order, status: "cancelled" as const } : order,
    ),
  };
}

function applyFill(state: EngineState, order: Order, px: number, sl?: number, tp?: number): EngineState {
  const fees = feeOn(px * order.qty, state.fees);
  const info = findSymbol(order.symbol);
  const qty = order.qty;
  const posSide = order.side === "buy" ? "long" : "short";
  const existing = state.positions.find((p) => p.symbol === order.symbol && p.status !== "closed");
  const account = { ...state.account };
  let positions = state.positions.slice();
  let trades = state.trades.slice();

  if (!existing) {
    account.cash -= marginFor(order.symbol, px, qty) + fees;
    positions = [
      {
        id: uid("pos"),
        symbol: order.symbol,
        side: posSide,
        qty,
        avgPrice: px,
        sl,
        tp,
        openedAt: Date.now(),
        status: "open",
      },
      ...positions,
    ];
  } else if (existing.side === posSide) {
    const notional = existing.avgPrice * existing.qty + px * qty;
    const newQty = existing.qty + qty;
    account.cash -= marginFor(order.symbol, px, qty) + fees;
    positions = positions.map((p) =>
      p.id === existing.id
        ? { ...p, qty: newQty, avgPrice: notional / newQty, sl: sl ?? p.sl, tp: tp ?? p.tp }
        : p,
    );
  } else {
    const closeQty = Math.min(existing.qty, qty);
    const dir = existing.side === "long" ? 1 : -1;
    const pnl = (px - existing.avgPrice) * closeQty * dir - fees;
    account.cash += marginFor(existing.symbol, existing.avgPrice, closeQty) + pnl;
    account.realizedPnl += pnl;
    trades = [
      {
        id: uid("tr"),
        openedAt: existing.openedAt,
        closedAt: Date.now(),
        symbol: existing.symbol,
        side: existing.side,
        qty: closeQty,
        entry: existing.avgPrice,
        exit: px,
        pnl,
        returnPct: existing.avgPrice ? pnl / (existing.avgPrice * closeQty) : 0,
        durationMs: Date.now() - existing.openedAt,
        fees,
        replay: order.replay,
      },
      ...trades,
    ];
    const remain = existing.qty - closeQty;
    if (remain <= 0) {
      positions = positions.map((p) => (p.id === existing.id ? { ...p, qty: 0, status: "closed" as const } : p));
    } else {
      positions = positions.map((p) => (p.id === existing.id ? { ...p, qty: remain, status: "partial" as const } : p));
    }
    const leftover = qty - closeQty;
    if (leftover > 0) {
      account.cash -= marginFor(order.symbol, px, leftover);
      positions = [
        {
          id: uid("pos"),
          symbol: order.symbol,
          side: posSide,
          qty: leftover,
          avgPrice: px,
          sl,
          tp,
          openedAt: Date.now(),
          status: "open",
        },
        ...positions,
      ];
    }
  }
  void info;
  const orders = state.orders.map((o) =>
    o.id === order.id ? { ...o, status: "filled" as const, filledQty: order.qty, price: px } : o,
  );
  return { ...state, account, positions, trades, orders };
}

export function fillOrder(state: EngineState, orderId: string, quote: Quote, sl?: number, tp?: number): EngineState {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || order.status === "cancelled" || order.status === "filled") return state;
  const px = execPrice(order.side, quote, order.type, state.fees, order.price);
  return applyFill(state, order, px, sl, tp);
}

export function cancelOrder(state: EngineState, orderId: string): EngineState {
  return {
    ...state,
    orders: state.orders.map((o) => (o.id === orderId && o.status === "pending" ? { ...o, status: "cancelled" } : o)),
  };
}

export function modifyPosition(state: EngineState, id: string, patch: Partial<Pick<Position, "sl" | "tp" | "qty">>) {
  const next: Partial<Pick<Position, "sl" | "tp" | "qty">> = { ...patch };
  if ("tp" in next && (next.tp == null || !Number.isFinite(next.tp) || next.tp <= 0)) next.tp = undefined;
  if ("sl" in next && (next.sl == null || !Number.isFinite(next.sl) || next.sl <= 0)) next.sl = undefined;
  return {
    ...state,
    positions: state.positions.map((p) => (p.id === id ? { ...p, ...next } : p)),
  };
}

export function stopShouldFire(p: Position, last: number): "sl" | "tp" | null {
  if (p.status === "closed" || !Number.isFinite(last) || last <= 0) return null;
  const sl = p.sl;
  const tp = p.tp;
  if (p.side === "long") {
    if (sl != null && sl > 0 && sl < p.avgPrice && last <= sl) return "sl";
    if (tp != null && tp > 0 && tp > p.avgPrice && last >= tp) return "tp";
  } else {
    if (sl != null && sl > 0 && sl > p.avgPrice && last >= sl) return "sl";
    if (tp != null && tp > 0 && tp < p.avgPrice && last <= tp) return "tp";
  }
  return null;
}

export function closePosition(
  state: EngineState,
  id: string,
  quote: Quote,
  qty?: number,
): { state: EngineState; error?: string } {
  const p = state.positions.find((x) => x.id === id && x.status !== "closed");
  if (!p) return { state, error: "No open position." };
  const closeQty = qty ?? p.qty;
  const side: Side = p.side === "long" ? "sell" : "buy";
  const result = placeOrder(
    state,
    { symbol: p.symbol, side, type: "market", qty: closeQty },
    quote,
    new Map([[p.symbol, quote]]),
  );
  if (result.error) return { state: result.state, error: result.error };
  return { state: result.state };
}

export function matchPending(state: EngineState, quotes: Map<string, Quote>): EngineState {
  let next = state;
  for (const o of state.orders) {
    if (o.status !== "pending") continue;
    const q = quotes.get(o.symbol);
    if (!q) continue;
    if (o.type === "limit") {
      if (o.side === "buy" && o.price != null && q.last <= o.price) next = fillOrder(next, o.id, q);
      if (o.side === "sell" && o.price != null && q.last >= o.price) next = fillOrder(next, o.id, q);
    }
    if (o.type === "stop" || o.type === "stop_limit") {
      if (o.side === "buy" && o.trigger != null && q.last >= o.trigger) next = fillOrder(next, o.id, q);
      if (o.side === "sell" && o.trigger != null && q.last <= o.trigger) next = fillOrder(next, o.id, q);
    }
  }
  for (const p of next.positions) {
    if (p.status === "closed") continue;
    const q = quotes.get(p.symbol);
    if (!q) continue;
    const hit = stopShouldFire(p, q.last);
    if (hit === "sl" && p.sl != null) {
      const r = closePosition(next, p.id, { ...q, last: p.sl, bid: p.sl, ask: p.sl });
      next = r.state;
    } else if (hit === "tp" && p.tp != null) {
      const r = closePosition(next, p.id, { ...q, last: p.tp, bid: p.tp, ask: p.tp });
      next = r.state;
    }
  }
  return rolloverDay(next, quotes);
}

export function rolloverDay(state: EngineState, quotes: Map<string, Quote>): EngineState {
  const key = todayKey();
  if (state.account.dayAnchor === key) return state;
  return {
    ...state,
    account: { ...state.account, dayAnchor: key, dayPnlStartEquity: equity(state, quotes) },
  };
}

export function stats(trades: Trade[]) {
  const closed = trades.filter((t) => t.qty > 0);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl < 0);
  const winRate = closed.length ? wins.length / closed.length : 0;
  const gp = wins.reduce((s, t) => s + t.pnl, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = gl > 0 ? gp / gl : gp > 0 ? Infinity : 0;
  let peak = 0;
  let eq = 0;
  let dd = 0;
  const curve: { t: number; v: number }[] = [];
  for (const t of [...closed].reverse()) {
    eq += t.pnl;
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq - peak);
    curve.push({ t: t.closedAt, v: eq });
  }
  return { winRate, profitFactor, drawdown: dd, curve, count: closed.length };
}

export function resetAccount(
  state: EngineState,
  opts: { balance?: boolean; positions?: boolean; orders?: boolean; history?: boolean },
): EngineState {
  const start = state.account.startingBalance;
  return {
    fees: state.fees,
    account: opts.balance || opts.positions ? freshAccount(start) : state.account,
    positions: opts.positions ? [] : state.positions,
    orders: opts.orders ? [] : state.orders,
    trades: opts.history ? [] : state.trades,
  };
}

export function historyFilter(trades: Trade[], range: "today" | "week" | "month" | "all") {
  if (range === "all") return trades;
  const now = Date.now();
  const start =
    range === "today"
      ? new Date().setHours(0, 0, 0, 0)
      : range === "week"
        ? now - 7 * 86400000
        : now - 30 * 86400000;
  return trades.filter((t) => t.closedAt >= start);
}

export function toCsv(trades: Trade[]) {
  const header = "Date,Symbol,Side,Entry,Exit,Quantity,P&L,Return %,Duration ms,Fees";
  const rows = trades.map((t) =>
    [
      new Date(t.closedAt).toISOString(),
      t.symbol,
      t.side,
      t.entry,
      t.exit,
      t.qty,
      t.pnl.toFixed(2),
      (t.returnPct * 100).toFixed(2),
      t.durationMs,
      t.fees.toFixed(2),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}
