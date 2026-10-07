// The paper-trading engine with charges and lots, and the capital-gains view built on it.
// Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { calculateEquityTax, equityTaxYears, unrealizedLots } from "../costs/equityTax";
import { calculateAfterTaxReturn } from "../costs/pnl";
import { availableCash, closePosition, costBasis, equity, fillsToCsv, freshAccount, invested, openCharges, placeOrder, previewCharges, rolloverDay, sellableQty, totalCharges, toCsv, unrealized, unrealizedNet, validateQuantity, type EngineState } from "./engine";
import type { Position, Quote, Side } from "./types";

const near = (a: number, b: number, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

const quote = (symbol: string, price: number): Quote => ({ symbol, last: price, bid: price, ask: price, open: price, high: price, low: price, change: 0, changePct: 0, volume: 0, ts: 0 });
const fresh = (cash = 1_000_000, profileId = "default-simulator"): EngineState => ({
  account: freshAccount(cash),
  orders: [],
  positions: [],
  trades: [],
  fees: { slippagePct: 0, profileId },
  fills: [],
});
const at = (iso: string) => mock.method(Date, "now", () => Date.parse(iso));
const trade = (state: EngineState, symbol: string, side: Side, qty: number, price: number) => placeOrder(state, { symbol, side, qty }, quote(symbol, price));

/** A position of the kind an older save can hold: nothing in the engine can open one any more. */
const legacy = (state: EngineState, p: Partial<Position> & Pick<Position, "symbol" | "side" | "qty" | "avgPrice">): EngineState => ({
  ...state,
  positions: [{ id: `pos_${p.symbol}_${p.side}`, openedAt: Date.parse("2026-10-05T09:30:00Z"), status: "open", ...p }, ...state.positions],
});

afterEach(() => mock.restoreAll());

describe("a delivery buy", () => {
  it("charges cash for the gross value and every charge, and the ledger shows them", () => {
    at("2026-10-05T10:00:00Z");
    const { state, error } = trade(fresh(), "TCS", "buy", 100, 1000);
    assert.equal(error, undefined);
    near(state.account.cash, 1_000_000 - 100000 - 354.74);
    assert.equal(state.fills.length, 1);
    const f = state.fills[0];
    assert.equal(f.gross, 100000);
    assert.equal(f.charges.total, 354.74);
    near(f.net, 100354.74);
    assert.equal(f.product, "delivery");
  });

  it("the charges become part of invested capital and average cost, not of the quoted price", () => {
    at("2026-10-05T10:00:00Z");
    const { state } = trade(fresh(), "TCS", "buy", 100, 1000);
    const p = state.positions[0];
    assert.equal(p.avgPrice, 1000); // chart levels still use the price paid
    near(openCharges(p), 354.74);
    near(costBasis(p), 1003.5474, 1e-4);
    near(invested(state), 100354.74);
  });

  it("equity falls by exactly the charges when the price has not moved", () => {
    at("2026-10-05T10:00:00Z");
    const { state } = trade(fresh(), "TCS", "buy", 100, 1000);
    near(equity(state, new Map([["TCS", quote("TCS", 1000)]])), 1_000_000 - 354.74);
    near(unrealized(state.positions[0], 1000), 0);
    near(unrealizedNet(state.positions[0], 1000), -354.74);
  });

  it("is refused when the cash covers the shares but not the charges", () => {
    at("2026-10-05T10:00:00Z");
    const poor = fresh(100_200);
    const r = trade(poor, "TCS", "buy", 100, 1000);
    assert.equal(r.error, "Not enough cash.");
    assert.equal(trade(fresh(100_400), "TCS", "buy", 100, 1000).error, undefined);
  });
});

describe("a delivery sell", () => {
  it("a round trip at the same price loses exactly the charges on both legs", () => {
    at("2026-10-05T10:00:00Z");
    const bought = trade(fresh(), "TCS", "buy", 100, 1000).state;
    const sold = trade(bought, "TCS", "sell", 100, 1000).state;
    near(sold.account.cash, 1_000_000 - 354.74 - 355.08);
    near(sold.account.realizedPnl, -709.82);
    const t = sold.trades[0];
    near(t.pnl, -709.82);
    assert.equal(t.grossPnl, 0);
    near(t.fees, 709.82);
    near(totalCharges(sold), 709.82);
  });

  it("a profit: net proceeds flow into cash and realised P&L is after both legs' charges", () => {
    at("2026-10-05T10:00:00Z");
    const bought = trade(fresh(), "TCS", "buy", 100, 1000).state;
    const sold = trade(bought, "TCS", "sell", 100, 1100).state;
    const sellCharges = sold.fills[0].charges.total;
    assert.equal(sellCharges, 389.06);
    near(sold.trades[0].grossPnl!, 10000);
    near(sold.trades[0].pnl, 10000 - 354.74 - 389.06);
    near(sold.account.cash, 1_000_000 + 10000 - 354.74 - 389.06);
  });

  it("cannot sell shares you do not hold, so no short position can be opened", () => {
    at("2026-10-05T10:00:00Z");
    const r = trade(fresh(), "TCS", "sell", 10, 1000);
    assert.ok(r.error?.includes("own"), r.error);
    assert.equal(r.state.positions.length, 0);
    assert.equal(r.state.account.cash, 1_000_000);
    assert.equal(r.state.orders[0].status, "rejected");
    const held = trade(fresh(), "TCS", "buy", 10, 1000).state;
    const over = trade(held, "TCS", "sell", 11, 1000);
    assert.ok(over.error?.includes("at most 10"), over.error);
    assert.equal(sellableQty(over.state, "TCS"), 10);
    assert.equal(over.state.positions[0].qty, 10);
  });

  it("selling what you hold never leaves a negative quantity", () => {
    at("2026-10-05T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 10, 1000).state;
    s = trade(s, "TCS", "sell", 10, 1000).state;
    assert.equal(sellableQty(s, "TCS"), 0);
    assert.ok(trade(s, "TCS", "sell", 1, 1000).error);
    assert.ok(s.positions.every((p) => p.qty >= 0 && p.side === "long"));
  });

  it("quantities must be positive, and whole for shares", () => {
    assert.ok(validateQuantity("TCS", 0));
    assert.ok(validateQuantity("TCS", -3));
    assert.ok(validateQuantity("TCS", 1.5));
    assert.ok(validateQuantity("TCS", Number.NaN));
    assert.equal(validateQuantity("TCS", 10), null);
    assert.equal(validateQuantity("BTCUSD", 0.01), null);
  });

  it("cash never goes below zero: a buy that cannot be paid for is refused", () => {
    at("2026-10-05T10:00:00Z");
    const r = trade(fresh(10_000), "TCS", "buy", 12, 1000);
    assert.equal(r.error, "Not enough cash.");
    assert.equal(availableCash(r.state), 10_000);
  });

  it("the depository charge is taken once per scrip per day", () => {
    at("2026-10-05T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000).state;
    s = trade(s, "TCS", "sell", 40, 1000).state;
    s = trade(s, "TCS", "sell", 60, 1000).state;
    const [second, first] = s.fills;
    assert.equal(first.charges.other, 13);
    assert.equal(second.charges.other, 0);
  });
});

describe("lots", () => {
  it("sells the oldest lot first and keeps the rest with their own charges", () => {
    at("2026-01-05T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000).state;
    at("2026-05-05T10:00:00Z");
    s = trade(s, "TCS", "buy", 50, 1200).state;
    assert.equal(s.positions[0].lots!.length, 2);
    near(s.positions[0].avgPrice, (100 * 1000 + 50 * 1200) / 150);

    at("2026-06-05T10:00:00Z");
    s = trade(s, "TCS", "sell", 120, 1300).state;
    const t = s.trades[0];
    assert.equal(t.slices!.length, 2);
    assert.deepEqual(t.slices!.map((x) => [x.qty, x.openPrice]), [[100, 1000], [20, 1200]]);
    near(t.grossPnl!, 100 * 300 + 20 * 100);
    const p = s.positions[0];
    assert.equal(p.status, "partial");
    assert.equal(p.qty, 30);
    assert.equal(p.avgPrice, 1200); // only the second lot is left
    // 30 of the 50 shares in the second lot remain, so 30/50 of its opening charges
    near(openCharges(p), (s.fills[1].charges.total * 30) / 50, 0.02); // fills[1] is the second purchase
  });

  it("the whole ledger reconciles: equity change = price moves minus all charges paid", () => {
    at("2026-01-05T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000).state;
    at("2026-05-05T10:00:00Z");
    s = trade(s, "TCS", "buy", 50, 1200).state;
    at("2026-06-05T10:00:00Z");
    s = trade(s, "TCS", "sell", 120, 1300).state;
    const last = 1250;
    const realizedGross = s.trades.reduce((a, t) => a + (t.grossPnl ?? 0), 0);
    const open = s.positions.filter((p) => p.status !== "closed");
    const unrealizedGross = open.reduce((a, p) => a + unrealized(p, last), 0);
    near(equity(s, new Map([["TCS", quote("TCS", last)]])) - 1_000_000, realizedGross + unrealizedGross - totalCharges(s), 0.02);
  });

  it("closing through closePosition sells the whole holding", () => {
    at("2026-10-05T10:00:00Z");
    const s = trade(fresh(), "TCS", "buy", 10, 1000).state;
    const closed = closePosition(s, s.positions[0].id, quote("TCS", 1000)).state;
    assert.equal(closed.fills[0].side, "sell");
    assert.equal(closed.positions[0].status, "closed");
  });
});

describe("what the desk allows", () => {
  it("every order is a market order, and delivery", () => {
    at("2026-10-05T10:00:00Z");
    const s = trade(fresh(), "TCS", "buy", 10, 1000).state;
    assert.equal(s.orders[0].type, "market");
    assert.equal(s.fills[0].product, "delivery");
    assert.equal(s.fills[0].charges.segment, "equityDelivery");
  });

  it("an instrument without a charge model carries no charges", () => {
    at("2026-10-05T10:00:00Z");
    const btc = trade(fresh(), "BTCUSD", "buy", 0.01, 64000).state;
    assert.equal(btc.fills[0].charges.modelled, false);
    assert.equal(btc.fills[0].charges.total, 0);
    near(btc.account.cash, 1_000_000 - 640);
  });

  it("the preview a ticket shows is the charge the fill applies", () => {
    at("2026-10-05T10:00:00Z");
    const s = fresh();
    const preview = previewCharges({ fees: s.fees, fills: s.fills, symbol: "TCS", side: "buy", qty: 100, price: 1000 });
    const filled = trade(s, "TCS", "buy", 100, 1000).state;
    assert.equal(filled.fills[0].charges.total, preview.total);
  });

  it("a custom profile changes brokerage", () => {
    at("2026-10-05T10:00:00Z");
    const s = { ...fresh(1_000_000, "custom"), fees: { slippagePct: 0, profileId: "custom", custom: { equityDelivery: { flat: 0 } } } };
    assert.equal(trade(s, "TCS", "buy", 100, 1000).state.fills[0].charges.brokerage, 0);
  });
});

describe("legacy state", () => {
  it("an intraday short from an older save can still be covered, and a sell is refused", () => {
    at("2026-10-05T10:00:00Z");
    const s = legacy(fresh(), { symbol: "TCS", side: "short", qty: 10, avgPrice: 1000, product: "intraday" });
    s.account.cash = 1_000_000 - 10_000;
    const covered = trade(s, "TCS", "buy", 10, 990).state;
    assert.equal(covered.positions[0].status, "closed");
    assert.equal(covered.fills[0].product, "intraday");
    assert.ok(covered.trades[0].grossPnl! > 0);
    assert.ok(trade(s, "TCS", "sell", 5, 1000).error);
  });

  it("an older intraday long can be sold with its own product", () => {
    at("2026-10-05T10:00:00Z");
    const s = legacy(fresh(), { symbol: "TCS", side: "long", qty: 10, avgPrice: 1000, product: "intraday" });
    const sold = trade(s, "TCS", "sell", 10, 1000).state;
    assert.equal(sold.fills[0].product, "intraday");
    assert.equal(sold.positions[0].status, "closed");
  });

  it("a position saved before lots existed can still be sold", () => {
    at("2026-10-05T10:00:00Z");
    const s = fresh();
    s.account.cash = 900_000;
    s.positions = [{ id: "pos_old", symbol: "TCS", side: "long", qty: 100, avgPrice: 1000, openedAt: Date.parse("2026-09-01T10:00:00Z"), status: "open" }];
    const sold = trade(s, "TCS", "sell", 100, 1100).state;
    assert.equal(sold.trades[0].slices!.length, 1);
    near(sold.trades[0].grossPnl!, 10000);
    assert.equal(sold.positions[0].status, "closed");
  });
});

describe("capital gains from the ledger", () => {
  it("a delivery trade held under a year is short-term at 20% on the gain after deductible charges", () => {
    at("2026-08-01T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000).state;
    at("2026-10-05T10:00:00Z");
    s = trade(s, "TCS", "sell", 100, 1100).state;
    const y = calculateEquityTax(s.trades, "FY2026-27", null);
    assert.equal(y.rows.length, 1);
    assert.equal(y.rows[0].classification, "STCG");
    assert.equal(y.rows[0].heldText, "2 months");
    near(y.rows[0].gain, 10000 - ((354.74 - 100) + (389.06 - 110)), 0.01); // STT is not deductible
    near(y.estimate.taxBeforeSurchargeCess, y.rows[0].gain * 0.2, 0.01);
    near(y.estimate.perItem[y.rows[0].id], y.estimate.total, 0.01);
    assert.equal(y.confidence.level, "estimated"); // no tax profile yet
  });

  it("a delivery trade held more than 12 months is long-term and sits under the exemption", () => {
    at("2025-01-10T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000).state;
    at("2026-06-01T10:00:00Z");
    s = trade(s, "TCS", "sell", 100, 1400).state;
    const y = calculateEquityTax(s.trades, "FY2026-27", null);
    assert.equal(y.rows[0].classification, "LTCG");
    assert.equal(y.estimate.buckets.ltcg112A.taxable, 0);
    assert.ok(y.estimate.exemptionApplied > 0 && y.estimate.exemptionRoom > 0);
    assert.equal(y.estimate.total, 0);
  });

  it("exactly twelve months is still short-term", () => {
    at("2025-01-10T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 10, 1000).state;
    at("2026-01-10T10:00:00Z");
    s = trade(s, "TCS", "sell", 10, 1100).state;
    assert.equal(calculateEquityTax(s.trades, "FY2025-26", null).rows[0].classification, "STCG");
  });

  it("one sale across two lots splits into a long and a short slice", () => {
    at("2025-01-10T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 3500).state;
    at("2026-05-10T10:00:00Z");
    s = trade(s, "TCS", "buy", 50, 3800).state;
    at("2026-10-05T10:00:00Z");
    s = trade(s, "TCS", "sell", 120, 4000).state; // 100 from the old lot, 20 from the new
    const rows = calculateEquityTax(s.trades, "FY2026-27", null).rows;
    assert.deepEqual(rows.map((r) => [r.qty, r.classification]), [[100, "LTCG"], [20, "STCG"]]);
  });

  it("a loss produces no tax and says advanced loss adjustment needs more information", () => {
    at("2026-08-01T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000).state;
    at("2026-10-05T10:00:00Z");
    s = trade(s, "TCS", "sell", 100, 900).state;
    const y = calculateEquityTax(s.trades, "FY2026-27", null);
    assert.equal(y.estimate.total, 0);
    assert.ok(y.estimate.unabsorbedLoss.short < 0);
    assert.ok(y.estimate.notes.some((n) => n.includes("Advanced tax-loss adjustment requires additional tax information")));
  });

  it("splits trades by the financial year they were closed in", () => {
    at("2026-02-01T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000).state;
    at("2026-03-20T10:00:00Z");
    s = trade(s, "TCS", "sell", 50, 1100).state;
    at("2026-05-10T10:00:00Z");
    s = trade(s, "TCS", "sell", 50, 1100).state;
    assert.deepEqual(equityTaxYears(s.trades, Date.parse("2026-10-05T10:00:00Z")), ["FY2026-27", "FY2025-26"]);
    assert.equal(calculateEquityTax(s.trades, "FY2025-26", null).rows.length, 1);
    assert.equal(calculateEquityTax(s.trades, "FY2026-27", null).rows.length, 1);
    assert.equal(calculateEquityTax(s.trades, "FY2024-25", null).estimate.supported, false);
  });

  it("an older intraday result is listed as business income, not taxed as capital gains", () => {
    at("2026-10-05T10:00:00Z");
    let s = legacy(fresh(), { symbol: "TCS", side: "long", qty: 10, avgPrice: 1000, product: "intraday" });
    s = trade(s, "TCS", "sell", 10, 1010).state;
    const y = calculateEquityTax(s.trades, "FY2026-27", null);
    assert.equal(y.rows.length, 0);
    assert.equal(y.excluded.length, 1);
    assert.ok(y.excluded.every((e) => e.kind === "business_income"));
    assert.equal(y.estimate.total, 0);
  });

  it("a complete tax profile raises the confidence to high", () => {
    at("2026-08-01T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000).state;
    at("2026-10-05T10:00:00Z");
    s = trade(s, "TCS", "sell", 100, 1100).state;
    const y = calculateEquityTax(s.trades, "FY2026-27", { slabRatePct: 30, incomeBand: "up_to_50l", regime: "new" });
    assert.equal(y.confidence.level, "high");
    assert.equal(y.estimate.includesSurchargeCess, true);
    near(y.estimate.cess, y.estimate.taxBeforeSurchargeCess * 0.04, 0.01);
  });

  it("open lots show a gain and the date they turn long-term, with no tax implied", () => {
    at("2026-06-01T10:00:00Z");
    const s = trade(fresh(), "TCS", "buy", 100, 1000).state;
    const { lots, total } = unrealizedLots(s.positions, new Map([["TCS", quote("TCS", 1100)]]), Date.parse("2026-10-05T10:00:00Z"));
    assert.equal(lots.length, 1);
    assert.equal(lots[0].term, "short");
    assert.equal(lots[0].longTermOn, "2027-06-02");
    near(total, 10000 - (354.74 - 100), 0.01);
  });

  it("realised results get an after-tax return and open ones do not", () => {
    const realised = calculateAfterTaxReturn({ invested: 100000, gross: 10000, charges: 744, tax: 1893.24, realized: true });
    assert.ok(realised.afterTaxReturnPct != null);
    const open = calculateAfterTaxReturn({ invested: 100000, gross: 10000, charges: 354.74, tax: 1893.24, realized: false });
    assert.equal(open.afterTaxReturnPct, null);
  });
});

describe("the day anchor", () => {
  it("waits for prices before it starts a new day, so a position at cost is not mistaken for the day's opening value", () => {
    at("2026-10-05T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 10, 1000).state;
    s = { ...s, account: { ...s.account, dayAnchor: "2026-10-04", dayPnlStartEquity: 999_000 } };
    assert.equal(rolloverDay(s, new Map()), s); // no price yet: unchanged
    const next = rolloverDay(s, new Map([["TCS", quote("TCS", 1100)]]));
    assert.equal(next.account.dayAnchor, "2026-10-05");
    near(next.account.dayPnlStartEquity, equity(s, new Map([["TCS", quote("TCS", 1100)]])));
  });
});

describe("exports", () => {
  it("the ledger and the trade history both carry gross, charges and net", () => {
    at("2026-10-05T10:00:00Z");
    const s = trade(trade(fresh(), "TCS", "buy", 10, 1000).state, "TCS", "sell", 10, 1000).state;
    assert.ok(fillsToCsv(s.fills).split("\n")[0].includes("Total charges"));
    assert.ok(toCsv(s.trades).split("\n")[0].includes("Gross P&L,Charges,Net P&L"));
  });
});
