import type {
  Fill,
  FeeConfig,
  Lot,
  Order,
  PaperAccount,
  Position,
  Product,
  Quote,
  Side,
  Trade,
  TradeSlice,
} from "./types";
import { findSymbol } from "./universe";
import {
  calculateTransactionCharges,
  emptyBreakdown,
  netTransactionValue,
  withCustomBrokerage,
  type ChargeBreakdown,
} from "../costs/charges";
import { chargeTarget, isEquityInstrument } from "../costs/classify";
import { allocatePaise, calculateRealizedGain, matchFifo } from "../costs/lots";
import { dayOf, roundPaise } from "../costs/rules";

export const DEFAULT_FEES: FeeConfig = {
  slippagePct: 0.01,
  profileId: "default-simulator",
};

/** Settings saved before charges had profiles carry brokerage percentages; they are dropped, not reinterpreted. */
export function normalizeFees(raw: Partial<FeeConfig> | undefined | null): FeeConfig {
  return {
    slippagePct: typeof raw?.slippagePct === "number" ? raw.slippagePct : DEFAULT_FEES.slippagePct,
    profileId: typeof raw?.profileId === "string" ? raw.profileId : DEFAULT_FEES.profileId,
    custom: raw?.custom,
  };
}

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

/** Cash a quantity costs at a price, before charges. Paper trading has no borrowing: cost is paid in full. */
export function costOf(px: number, qty: number) {
  return Math.abs(px * qty);
}

/** The price a market order fills at: the ask (or bid) plus the configured slippage. */
export function execPrice(side: Side, quote: Quote, fees: FeeConfig) {
  const slip = quote.last * (fees.slippagePct / 100);
  return side === "buy" ? quote.ask + slip : quote.bid - slip;
}

/** What is wrong with a quantity, in words a beginner can act on, or null. Whole shares for stocks and ETFs. */
export function validateQuantity(symbol: string, qty: number): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return "Enter a quantity of at least 1.";
  const cls = findSymbol(symbol).assetClass;
  if ((cls === "stock" || cls === "etf") && !Number.isInteger(qty)) return "Shares trade in whole numbers.";
  return null;
}

export type EngineState = {
  account: PaperAccount;
  orders: Order[];
  positions: Position[];
  trades: Trade[];
  fees: FeeConfig;
  /** Every execution with its charge breakdown, newest first. */
  fills: Fill[];
};

// --- products, lots and cost basis ------------------------------------------------------------

/** Only equity has a delivery/intraday choice; everything else is charged by its own segment. */
export function productFor(symbol: string, product?: Product): Product {
  return isEquityInstrument(findSymbol(symbol)) ? (product ?? "delivery") : "delivery";
}

const positionProduct = (p: Position): Product => p.product ?? "delivery";

/** The lots of a position. One saved before lots existed is described as a single lot at its average price. */
export function lotsOf(p: Position): Lot[] {
  if (p.lots && p.lots.length) return p.lots;
  if (p.qty <= 0 || p.status === "closed") return [];
  return [{ id: `${p.id}_l0`, qty: p.qty, price: p.avgPrice, openedAt: p.openedAt, openCharges: 0, openStt: 0 }];
}

/** Charges paid opening the quantity still held. */
export function openCharges(p: Position): number {
  return roundPaise(lotsOf(p).reduce((s, l) => s + l.openCharges, 0));
}

/** Average cost per unit including the charges paid to open it. */
export function costBasis(p: Position): number {
  return p.qty > 0 ? (p.avgPrice * p.qty + openCharges(p)) / p.qty : p.avgPrice;
}

export function positionValue(p: Position, last: number) {
  return costOf(p.avgPrice, p.qty) + unrealized(p, last);
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

/** Money tied up in open positions, including the charges paid to open them. */
export function invested(state: EngineState) {
  return roundPaise(
    state.positions.reduce((s, p) => (p.status === "closed" ? s : s + costOf(p.avgPrice, p.qty) + openCharges(p)), 0),
  );
}

/** Price move on the open quantity, before any charge. */
export function unrealized(p: Position, last: number) {
  const dir = p.side === "long" ? 1 : -1;
  return (last - p.avgPrice) * p.qty * dir;
}

/** The same move after the charges already paid to open the position. Exit charges are not guessed. */
export function unrealizedNet(p: Position, last: number) {
  return unrealized(p, last) - openCharges(p);
}

/** Cash that can still be spent. Never negative: there is no margin or borrowing. */
export function availableCash(state: EngineState) {
  return Math.max(0, state.account.cash);
}

// --- charges ----------------------------------------------------------------------------------

function brokerProfileFor(fees: FeeConfig) {
  return fees.profileId === "custom" && fees.custom ? withCustomBrokerage(fees.custom) : null;
}

/**
 * The charges for one execution. Pure: the ticket and the confirmation use it before an order is
 * placed and the engine uses it at the fill, so the number a user approves is the number charged.
 */
export function previewCharges(input: {
  fees: FeeConfig;
  fills: Fill[];
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  product?: Product;
  when?: number;
}): ChargeBreakdown {
  const info = findSymbol(input.symbol);
  const product = productFor(input.symbol, input.product);
  const target = chargeTarget(info, product);
  if (!target.modelled) return emptyBreakdown(input.side, input.qty, input.price, target.reason);
  const when = input.when ?? Date.now();
  const today = dayOf(when);
  const dpAlreadyCharged =
    target.segment === "equityDelivery" &&
    input.fills.some((f) => f.symbol === input.symbol && f.side === "sell" && f.product === "delivery" && f.charges.other > 0 && dayOf(f.time) === today);
  const out = calculateTransactionCharges({
    segment: target.segment,
    exchange: target.exchange,
    side: input.side,
    quantity: input.qty,
    price: input.price,
    date: when,
    profileId: input.fees.profileId,
    customProfile: brokerProfileFor(input.fees),
    dpAlreadyCharged,
  });
  if (target.note) out.notes.push(target.note);
  return out;
}

/** Every charge paid in the ledger. */
export function totalCharges(state: Pick<EngineState, "fills">): number {
  return roundPaise(state.fills.reduce((s, f) => s + f.charges.total, 0));
}

// --- orders -----------------------------------------------------------------------------------

function reject(state: EngineState, input: { symbol: string; side: Side; qty: number; replay?: boolean; product?: Product }, msg: string) {
  const order: Order = {
    id: uid("ord"),
    time: Date.now(),
    symbol: input.symbol,
    side: input.side,
    type: "market",
    qty: input.qty,
    filledQty: 0,
    status: "rejected",
    rejectReason: msg,
    replay: input.replay,
    product: input.product,
  };
  return { state: { ...state, orders: [order, ...state.orders] }, order, error: msg };
}

function findPosition(state: EngineState, symbol: string, product: Product) {
  return state.positions.find((p) => p.symbol === symbol && positionProduct(p) === product && p.status !== "closed");
}

/** Open positions in one symbol, oldest first. Normally one long delivery position; older saves may hold more. */
function openIn(state: EngineState, symbol: string) {
  return state.positions.filter((p) => p.symbol === symbol && p.status !== "closed").sort((a, b) => a.openedAt - b.openedAt);
}

/** How many shares of a symbol can be sold right now: what is held long. */
export function sellableQty(state: EngineState, symbol: string): number {
  return openIn(state, symbol)
    .filter((p) => p.side === "long")
    .reduce((s, p) => s + p.qty, 0);
}

/** Why a sell cannot go through, or null. The ticket shows this before the user can confirm. */
export function sellBlock(state: EngineState, symbol: string, qty: number): string | null {
  const held = sellableQty(state, symbol);
  const name = findSymbol(symbol).name;
  if (held <= 0) return `You don't own ${name}. You can only sell stocks currently held in your portfolio.`;
  if (qty > held + 1e-9) return `You hold ${held} of ${name}, so you can sell at most ${held}.`;
  return null;
}

/**
 * The only way an order enters the book. Market orders, long only, paid for in cash: a buy needs the cash
 * (price plus charges) and a sell can use at most the shares held. Nothing can open a short position.
 */
export function placeOrder(
  state: EngineState,
  input: {
    symbol: string;
    side: Side;
    qty: number;
    replay?: boolean;
  },
  quote: Quote,
): { state: EngineState; order: Order; error?: string } {
  const qtyErr = validateQuantity(input.symbol, input.qty);
  if (qtyErr) return reject(state, input, qtyErr);

  const open = openIn(state, input.symbol);
  let product: Product = "delivery";
  if (input.side === "sell") {
    // Sell the oldest long position first; a short (from an older save) cannot be sold further.
    const target = open.find((p) => p.side === "long");
    const block = sellBlock(state, input.symbol, input.qty);
    if (block || !target) return reject(state, { ...input, product }, block ?? "You don't own this stock.");
    product = positionProduct(target);
    if (input.qty > target.qty + 1e-9) {
      return reject(state, { ...input, product }, `Your ${findSymbol(input.symbol).name} is held in more than one lot group; sell up to ${target.qty} first.`);
    }
  } else {
    // A buy first covers a short left over from an older save, so it can be closed; otherwise it adds to a long.
    const cover = open.find((p) => p.side === "short");
    if (cover) product = positionProduct(cover);
  }

  const existingPos = findPosition(state, input.symbol, product);
  const reducing = existingPos && ((existingPos.side === "long" && input.side === "sell") || (existingPos.side === "short" && input.side === "buy"));
  const pxEst = execPrice(input.side, quote, state.fees);
  const closeQty = reducing ? Math.min(existingPos!.qty, input.qty) : 0;
  const openQty = input.qty - closeQty;
  const charges = previewCharges({ fees: state.fees, fills: state.fills, symbol: input.symbol, side: input.side, qty: input.qty, price: pxEst, product });
  const needCash = openQty > 0 ? costOf(pxEst, openQty) + (charges.total * openQty) / input.qty : 0;
  if (needCash > availableCash(state) + 1e-6) {
    return reject(state, { ...input, product }, "Not enough cash.");
  }

  const order: Order = {
    id: uid("ord"),
    time: Date.now(),
    symbol: input.symbol,
    side: input.side,
    type: "market",
    qty: input.qty,
    filledQty: 0,
    status: "pending",
    replay: input.replay,
    product,
  };

  const next = fillOrder({ ...state, orders: [order, ...state.orders] }, order.id, quote);
  return { state: next, order: next.orders.find((o) => o.id === order.id) || order };
}

/** Orders saved before the desk was market-only that never filled are cancelled on load: nothing waits in the book any more. */
export function cancelWorkingOrders(state: EngineState): EngineState {
  return {
    ...state,
    orders: state.orders.map((order) => (order.status === "pending" ? { ...order, status: "cancelled" as const } : order)),
  };
}

const sumQty = (lots: Lot[]) => lots.reduce((s, l) => s + l.qty, 0);
const weightedPrice = (lots: Lot[]) => {
  const q = sumQty(lots);
  return q > 0 ? lots.reduce((s, l) => s + l.price * l.qty, 0) / q : 0;
};

/**
 * Executes `order` at `px`. Cash, lots, average cost and realised P&L all move by the same
 * charges the ticket showed: an opening leg pays its charges in cash at once and the charges stay
 * with the lot; a closing leg pays its charges out of the proceeds and the lot's opening charges
 * are released into the realised result. Lots are matched oldest first.
 */
function applyFill(state: EngineState, order: Order, px: number): EngineState {
  const now = Date.now();
  const qty = order.qty;
  const product = order.product ?? "delivery";
  const posSide = order.side === "buy" ? "long" : "short";
  const existing = findPosition(state, order.symbol, product);
  const reducing = existing && existing.side !== posSide;
  const closeQty = reducing ? Math.min(existing!.qty, qty) : 0;
  const openQty = qty - closeQty;

  const charges = previewCharges({ fees: state.fees, fills: state.fills, symbol: order.symbol, side: order.side, qty, price: px, product, when: now });
  const [closeCharge, openCharge] = allocatePaise(charges.total, [closeQty, openQty]);
  const [closeStt, openStt] = allocatePaise(charges.stt, [closeQty, openQty]);

  const account = { ...state.account };
  let positions = state.positions.slice();
  let trades = state.trades.slice();

  if (closeQty > 0 && existing) {
    const lots = lotsOf(existing).map((l) => ({ ...l }));
    const { slices } = matchFifo(lots, closeQty);
    const closeShares = allocatePaise(closeCharge, slices.map((s) => s.qty));
    const closeSttShares = allocatePaise(closeStt, slices.map((s) => s.qty));
    const tradeSlices: TradeSlice[] = [];
    let released = 0;
    slices.forEach((s, i) => {
      const lot = s.lot;
      const whole = Math.abs(lot.qty - s.qty) < 1e-9;
      const openChargeShare = whole ? lot.openCharges : roundPaise((lot.openCharges * s.qty) / lot.qty);
      const openSttShare = whole ? lot.openStt : roundPaise((lot.openStt * s.qty) / lot.qty);
      const gain = calculateRealizedGain({
        qty: s.qty,
        side: existing.side,
        openPrice: lot.price,
        closePrice: px,
        openCharges: openChargeShare,
        closeCharges: closeShares[i],
        openStt: openSttShare,
        closeStt: closeSttShares[i],
      });
      tradeSlices.push({
        qty: s.qty,
        openedAt: lot.openedAt,
        openPrice: lot.price,
        closePrice: px,
        openCharges: openChargeShare,
        closeCharges: closeShares[i],
        openStt: openSttShare,
        closeStt: closeSttShares[i],
        gross: gain.gross,
        net: gain.net,
        taxable: gain.taxable,
      });
      released += costOf(lot.price, s.qty) + gain.gross;
      lot.qty -= s.qty;
      lot.openCharges = roundPaise(lot.openCharges - openChargeShare);
      lot.openStt = roundPaise(lot.openStt - openSttShare);
    });

    const remainingLots = lots.filter((l) => l.qty > 1e-9);
    const gross = roundPaise(tradeSlices.reduce((a, t) => a + t.gross, 0));
    const net = roundPaise(tradeSlices.reduce((a, t) => a + t.net, 0));
    const fees = roundPaise(tradeSlices.reduce((a, t) => a + t.openCharges + t.closeCharges, 0));
    const entry = tradeSlices.reduce((a, t) => a + t.openPrice * t.qty, 0) / closeQty;
    const openedAt = Math.min(...tradeSlices.map((t) => t.openedAt));

    account.cash += released - closeCharge;
    account.realizedPnl += net;
    trades = [
      {
        id: uid("tr"),
        openedAt,
        closedAt: now,
        symbol: existing.symbol,
        side: existing.side,
        qty: closeQty,
        entry,
        exit: px,
        pnl: net,
        returnPct: entry ? net / (entry * closeQty) : 0,
        durationMs: now - openedAt,
        fees,
        replay: order.replay,
        product,
        grossPnl: gross,
        slices: tradeSlices,
      },
      ...trades,
    ];

    const remain = sumQty(remainingLots);
    positions = positions.map((p) =>
      p.id === existing.id
        ? {
            ...p,
            qty: remain,
            lots: remainingLots,
            avgPrice: remain > 0 ? weightedPrice(remainingLots) : p.avgPrice,
            status: remain <= 1e-9 ? ("closed" as const) : ("partial" as const),
          }
        : p,
    );
  }

  if (openQty > 0) {
    const lot: Lot = { id: uid("lot"), qty: openQty, price: px, openedAt: now, openCharges: openCharge, openStt: openStt };
    account.cash -= costOf(px, openQty) + openCharge;
    const sameSide = existing && existing.side === posSide;
    if (sameSide && existing) {
      const lots = [...lotsOf(existing), lot];
      positions = positions.map((p) =>
        p.id === existing.id
          ? { ...p, qty: sumQty(lots), lots, avgPrice: weightedPrice(lots) }
          : p,
      );
    } else {
      positions = [
        {
          id: uid("pos"),
          symbol: order.symbol,
          side: posSide,
          qty: openQty,
          avgPrice: px,
          openedAt: now,
          status: "open",
          product,
          lots: [lot],
        },
        ...positions,
      ];
    }
  }

  const fill: Fill = {
    id: uid("fill"),
    time: now,
    orderId: order.id,
    symbol: order.symbol,
    side: order.side,
    qty,
    price: px,
    product,
    gross: charges.turnover,
    charges,
    net: netTransactionValue(charges),
    replay: order.replay,
  };
  const orders = state.orders.map((o) =>
    o.id === order.id ? { ...o, status: "filled" as const, filledQty: order.qty, price: px } : o,
  );
  return { ...state, account, positions, trades, orders, fills: [fill, ...state.fills] };
}

export function fillOrder(state: EngineState, orderId: string, quote: Quote): EngineState {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || order.status === "cancelled" || order.status === "filled") return state;
  return applyFill(state, order, execPrice(order.side, quote, state.fees));
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
  const result = placeOrder(state, { symbol: p.symbol, side, qty: closeQty }, quote);
  if (result.error) return { state: result.state, error: result.error };
  return { state: result.state };
}

export function rolloverDay(state: EngineState, quotes: Map<string, Quote>): EngineState {
  const key = todayKey();
  if (state.account.dayAnchor === key) return state;
  // The day's opening value is only meaningful with a price for everything held; until they arrive the old anchor stays.
  if (state.positions.some((p) => p.status !== "closed" && !((quotes.get(p.symbol)?.last ?? 0) > 0))) return state;
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
    fills: opts.history || opts.balance || opts.positions ? [] : state.fills,
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
  const header = "Date,Symbol,Side,Product,Entry,Exit,Quantity,Gross P&L,Charges,Net P&L,Return %,Duration ms";
  const rows = trades.map((t) =>
    [
      new Date(t.closedAt).toISOString(),
      t.symbol,
      t.side,
      t.product ?? "delivery",
      t.entry,
      t.exit,
      t.qty,
      (t.grossPnl ?? t.pnl + t.fees).toFixed(2),
      t.fees.toFixed(2),
      t.pnl.toFixed(2),
      (t.returnPct * 100).toFixed(2),
      t.durationMs,
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

export function fillsToCsv(fills: Fill[]) {
  const header = "Date,Symbol,Side,Product,Quantity,Price,Gross,Brokerage,STT/CTT,Exchange,SEBI,Stamp duty,GST,Other,Total charges,Net";
  const rows = fills.map((f) =>
    [
      new Date(f.time).toISOString(),
      f.symbol,
      f.side,
      f.product,
      f.qty,
      f.price,
      f.gross.toFixed(2),
      f.charges.brokerage.toFixed(2),
      f.charges.stt.toFixed(2),
      f.charges.exchangeCharges.toFixed(2),
      f.charges.sebi.toFixed(2),
      f.charges.stampDuty.toFixed(2),
      f.charges.gst.toFixed(2),
      f.charges.other.toFixed(2),
      f.charges.total.toFixed(2),
      f.net.toFixed(2),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}
