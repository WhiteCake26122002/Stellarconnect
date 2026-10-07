// The buy/sell flow: the checks a ticket makes and the order of its steps.
// Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { freshAccount, placeOrder, type EngineState } from "./engine";
import { checkTicket, flowReducer, IDLE_FLOW, maxBuyQty, parseQty, type FlowState, type Receipt } from "./orderFlow";
import type { Quote, Side } from "./types";

const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const quote = (symbol: string, price: number, extra: Partial<Quote> = {}): Quote => ({ symbol, last: price, bid: price, ask: price, open: price, high: price, low: price, change: 0, changePct: 0, volume: 0, ts: Date.parse("2026-10-05T10:00:00Z"), live: true, ...extra });
const fresh = (cash = 1_000_000): EngineState => ({ account: freshAccount(cash), orders: [], positions: [], trades: [], fees: { slippagePct: 0, profileId: "default-simulator" }, fills: [] });
const trade = (s: EngineState, symbol: string, side: Side, qty: number, price: number) => placeOrder(s, { symbol, side, qty }, quote(symbol, price)).state;
const NOW = Date.parse("2026-10-05T10:01:00Z");
const at = () => mock.method(Date, "now", () => NOW);
afterEach(() => mock.restoreAll());

describe("checking a buy", () => {
  it("shows value, charges, total, and the cash left, and agrees with what the engine then does", () => {
    at();
    const engine = fresh();
    const c = checkTicket({ engine, symbol: "TCS", side: "buy", qty: 100, quote: quote("TCS", 1000), now: NOW });
    assert.equal(c.ok, true);
    near(c.value, 100000);
    near(c.charges, 354.74);
    near(c.total, 100354.74);
    near(c.cashAfter, 1_000_000 - 100354.74);
    const after = trade(engine, "TCS", "buy", 100, 1000);
    near(after.account.cash, c.cashAfter);
    near(after.fills[0].charges.total, c.charges);
  });

  it("says Insufficient cash and the shortfall instead of silently refusing", () => {
    at();
    const c = checkTicket({ engine: fresh(10_000), symbol: "TCS", side: "buy", qty: 12, quote: quote("TCS", 1000), now: NOW });
    assert.equal(c.ok, false);
    assert.equal(c.issues[0].message, "Insufficient cash");
    assert.ok(c.shortfall > 2000 && c.shortfall < 2200, String(c.shortfall));
    near(c.shortfall, c.total - 10_000);
  });

  it("cash that covers the shares but not the charges is still a shortfall", () => {
    at();
    const c = checkTicket({ engine: fresh(100_200), symbol: "TCS", side: "buy", qty: 100, quote: quote("TCS", 1000), now: NOW });
    assert.equal(c.ok, false);
    near(c.shortfall, 154.74);
  });

  it("zero, negative, fractional and empty quantities are refused with a reason", () => {
    at();
    for (const qty of [0, -1, 2.5, Number.NaN]) {
      const c = checkTicket({ engine: fresh(), symbol: "TCS", side: "buy", qty, quote: quote("TCS", 1000), now: NOW });
      assert.equal(c.ok, false, String(qty));
      assert.equal(c.issues[0].code, "bad_quantity");
      assert.equal(c.value, 0);
    }
    assert.ok(Number.isNaN(parseQty("")));
    assert.equal(parseQty("1,250"), 1250);
  });

  it("no price blocks the order and says so", () => {
    at();
    for (const q of [null, quote("TCS", 0)]) {
      const c = checkTicket({ engine: fresh(), symbol: "TCS", side: "buy", qty: 1, quote: q, now: NOW });
      assert.equal(c.ok, false);
      assert.equal(c.price, null);
      assert.ok(c.issues.some((i) => i.code === "no_price"));
    }
  });

  it("an old reading from a live feed warns without blocking; a simulated one says it is simulated", () => {
    at();
    const stale = checkTicket({ engine: fresh(), symbol: "TCS", side: "buy", qty: 1, quote: quote("TCS", 1000, { ts: NOW - 10 * 60_000 }), now: NOW });
    assert.equal(stale.ok, true);
    assert.ok(stale.issues.some((i) => i.code === "stale_price" && !i.blocking));
    const sim = checkTicket({ engine: fresh(), symbol: "TCS", side: "buy", qty: 1, quote: quote("TCS", 1000, { live: false }), now: NOW });
    assert.equal(sim.ok, true);
    assert.ok(sim.issues.some((i) => i.code === "simulated_price"));
    assert.equal(checkTicket({ engine: fresh(), symbol: "TCS", side: "buy", qty: 1, quote: quote("TCS", 1000), now: NOW }).issues.length, 0);
  });
});

describe("the largest buy", () => {
  it("is the most shares the cash covers once charges are included, and one more would be refused", () => {
    at();
    const engine = fresh(100_400);
    const q = quote("TCS", 1000);
    const max = maxBuyQty(engine, "TCS", q);
    assert.equal(max, 100);
    assert.equal(checkTicket({ engine, symbol: "TCS", side: "buy", qty: max, quote: q, now: NOW }).ok, true);
    assert.equal(checkTicket({ engine, symbol: "TCS", side: "buy", qty: max + 1, quote: q, now: NOW }).ok, false);
    assert.equal(maxBuyQty(fresh(500), "TCS", q), 0);
    assert.equal(maxBuyQty(engine, "TCS", null), 0);
  });
});

describe("checking a sell", () => {
  it("shows what is owned, what is being sold and what remains", () => {
    at();
    const engine = trade(fresh(), "TCS", "buy", 100, 1000);
    const c = checkTicket({ engine, symbol: "TCS", side: "sell", qty: 10, quote: quote("TCS", 1100), now: NOW });
    assert.equal(c.ok, true);
    assert.equal(c.held, 100);
    assert.equal(c.remaining, 90);
    near(c.value, 11000);
    assert.ok(c.total < c.value);
    near(c.cashAfter, engine.account.cash + c.total);
  });

  it("selling more than owned is blocked with the maximum named", () => {
    at();
    const engine = trade(fresh(), "TCS", "buy", 10, 1000);
    const c = checkTicket({ engine, symbol: "TCS", side: "sell", qty: 11, quote: quote("TCS", 1000), now: NOW });
    assert.equal(c.ok, false);
    assert.equal(c.issues[0].code, "over_owned");
    assert.ok(c.issues[0].message.includes("at most 10"));
    assert.equal(checkTicket({ engine, symbol: "TCS", side: "sell", qty: 10, quote: quote("TCS", 1000), now: NOW }).ok, true);
  });

  it("owning nothing explains that only held stocks can be sold", () => {
    at();
    const c = checkTicket({ engine: fresh(), symbol: "TCS", side: "sell", qty: 1, quote: quote("TCS", 1000), now: NOW });
    assert.equal(c.ok, false);
    assert.equal(c.issues[0].code, "not_owned");
    assert.ok(c.issues[0].message.includes("only sell"));
  });

  it("whatever the ticket allows, the engine allows, and whatever it blocks, the engine refuses", () => {
    at();
    const engine = trade(fresh(), "TCS", "buy", 10, 1000);
    for (const qty of [1, 10, 11, 0]) {
      const c = checkTicket({ engine, symbol: "TCS", side: "sell", qty, quote: quote("TCS", 1000), now: NOW });
      const r = placeOrder(engine, { symbol: "TCS", side: "sell", qty }, quote("TCS", 1000));
      assert.equal(!r.error, c.ok, `sell ${qty}`);
    }
    for (const cash of [10_000, 1_000_000]) {
      const e = fresh(cash);
      const c = checkTicket({ engine: e, symbol: "TCS", side: "buy", qty: 50, quote: quote("TCS", 1000), now: NOW });
      assert.equal(!placeOrder(e, { symbol: "TCS", side: "buy", qty: 50 }, quote("TCS", 1000)).error, c.ok, `cash ${cash}`);
    }
  });
});

describe("the steps", () => {
  const receipt: Receipt = { side: "buy", symbol: "TCS", name: "TCS", qty: 1, price: 1, value: 1, charges: 0, total: 1, realized: null, cashAfter: 0, time: 0 };
  const run = (...actions: Parameters<typeof flowReducer>[1][]) => actions.reduce<FlowState>((s, a) => flowReducer(s, a), IDLE_FLOW);

  it("goes idle → quantity → review → executing → success", () => {
    assert.equal(run({ type: "open", symbol: "TCS", side: "buy", qty: 10 }).step, "quantity");
    assert.equal(run({ type: "open", symbol: "TCS", side: "buy", qty: 10 }).qtyText, "10");
    assert.equal(run({ type: "open", symbol: "TCS", side: "buy" }, { type: "review", ok: true }).step, "review");
    assert.equal(run({ type: "open", symbol: "TCS", side: "buy" }, { type: "review", ok: true }, { type: "confirm" }).step, "executing");
    const done = run({ type: "open", symbol: "TCS", side: "buy" }, { type: "review", ok: true }, { type: "confirm" }, { type: "filled", receipt });
    assert.equal(done.step, "success");
    assert.equal(done.receipt, receipt);
  });

  it("review is refused when the checks failed", () => {
    assert.equal(run({ type: "open", symbol: "TCS", side: "buy" }, { type: "review", ok: false }).step, "quantity");
  });

  it("a double confirm, or a fill that arrives out of order, cannot skip a step", () => {
    const executing = run({ type: "open", symbol: "TCS", side: "buy" }, { type: "review", ok: true }, { type: "confirm" });
    assert.equal(flowReducer(executing, { type: "confirm" }).step, "executing");
    assert.equal(flowReducer(executing, { type: "review", ok: true }).step, "executing");
    assert.equal(flowReducer(IDLE_FLOW, { type: "filled", receipt }).step, "idle");
    assert.equal(flowReducer(run({ type: "open", symbol: "TCS", side: "buy" }), { type: "confirm" }).step, "quantity");
  });

  it("side and quantity change only while the ticket is being filled in", () => {
    const q = run({ type: "open", symbol: "TCS", side: "buy" }, { type: "side", side: "sell" }, { type: "qty", text: "25" });
    assert.deepEqual([q.side, q.qtyText], ["sell", "25"]);
    const r = flowReducer(q, { type: "review", ok: true });
    assert.equal(flowReducer(r, { type: "side", side: "buy" }).side, "sell");
    assert.equal(flowReducer(r, { type: "qty", text: "1" }).qtyText, "25");
  });

  it("an execution failure shows the reason and Back returns to the quantity", () => {
    const failed = run({ type: "open", symbol: "TCS", side: "buy" }, { type: "review", ok: true }, { type: "confirm" }, { type: "failed", message: "Price moved" });
    assert.equal(failed.step, "error");
    assert.equal(failed.error, "Price moved");
    const back = flowReducer(failed, { type: "back" });
    assert.equal(back.step, "quantity");
    assert.equal(back.error, null);
  });

  it("close always returns to idle", () => {
    for (const s of [run({ type: "open", symbol: "TCS", side: "buy" }), run({ type: "open", symbol: "TCS", side: "buy" }, { type: "review", ok: true })]) {
      assert.deepEqual(flowReducer(s, { type: "close" }), IDLE_FLOW);
    }
  });
});
