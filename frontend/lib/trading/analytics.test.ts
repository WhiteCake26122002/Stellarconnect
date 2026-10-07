// Portfolio analytics: every figure on the dashboard comes from these functions, so they are tested against the engine.
// Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
  calculateAverageLoss,
  calculateAverageWin,
  calculateConcentration,
  calculateDailyPnl,
  calculateHoldings,
  calculateJournalStats,
  calculatePortfolioAllocation,
  calculateSectorExposure,
  calculateSummary,
  calculateTopHoldings,
  calculateTradeStats,
  calculateWinRate,
  normalizeEntry,
  rangeStart,
  rebaseBenchmark,
  recordEquity,
  sliceHistory,
  type EquityPoint,
} from "./analytics";
import { freshAccount, placeOrder, type EngineState } from "./engine";
import type { Candle, Quote, Side, Trade } from "./types";

const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const quote = (symbol: string, price: number, change = 0): Quote => ({ symbol, last: price, bid: price, ask: price, open: price, high: price, low: price, change, changePct: change / price, volume: 0, ts: 0 });
const fresh = (cash = 1_000_000): EngineState => ({ account: freshAccount(cash), orders: [], positions: [], trades: [], fees: { slippagePct: 0, profileId: "default-simulator" }, fills: [] });
const trade = (s: EngineState, symbol: string, side: Side, qty: number, price: number) => placeOrder(s, { symbol, side, qty }, quote(symbol, price)).state;
const quotesOf = (pairs: [string, number, number?][]) => new Map(pairs.map(([s, p, c]) => [s, quote(s, p, c ?? 0)]));
const at = (iso: string) => mock.method(Date, "now", () => Date.parse(iso));

afterEach(() => mock.restoreAll());

const tr = (id: string, pnl: number): Trade => ({ id, openedAt: 0, closedAt: 1, symbol: "TCS", side: "long", qty: 1, entry: 1, exit: 1, pnl, returnPct: 0, durationMs: 1, fees: 0 });

describe("holdings and the summary", () => {
  it("portfolio value is cash plus market value, and total P&L is value minus the starting balance", () => {
    at("2026-10-05T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000);
    s = trade(s, "RELIANCE", "buy", 50, 1400);
    const q = quotesOf([["TCS", 1100], ["RELIANCE", 1300]]);
    const h = calculateHoldings(s, q);
    const sum = calculateSummary(s, h);
    near(sum.holdingsValue, 100 * 1100 + 50 * 1300);
    near(sum.value, s.account.cash + sum.holdingsValue);
    near(sum.totalPnl, sum.value - 1_000_000);
  });

  it("total P&L equals realised plus unrealised, both after charges: the books reconcile", () => {
    at("2026-10-05T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000);
    s = trade(s, "TCS", "sell", 40, 1050);
    s = trade(s, "INFY", "buy", 30, 1500);
    const q = quotesOf([["TCS", 1080], ["INFY", 1450]]);
    const sum = calculateSummary(s, calculateHoldings(s, q));
    near(sum.realized + sum.unrealized, sum.totalPnl, 0.02);
    assert.ok(sum.charges > 0);
  });

  it("a holding with no price yet is valued at cost and flagged, never at zero", () => {
    at("2026-10-05T10:00:00Z");
    const s = trade(fresh(), "TCS", "buy", 10, 1000);
    const h = calculateHoldings(s, new Map());
    assert.equal(h[0].hasQuote, false);
    near(h[0].value, 10000);
    assert.equal(calculateSummary(s, h).unpriced, 1);
  });

  it("day P&L uses yesterday's close for older shares and the buy price for shares bought today", () => {
    at("2026-10-01T10:00:00");
    let s = trade(fresh(), "TCS", "buy", 100, 1000);
    at("2026-10-05T10:00:00");
    s = trade(s, "TCS", "buy", 50, 1100);
    // last 1120; the market moved +20 since yesterday's close
    const h = calculateHoldings(s, quotesOf([["TCS", 1120, 20]]), Date.parse("2026-10-05T11:00:00"))[0];
    near(h.dayPnl, 100 * 20 + 50 * (1120 - 1100));
    assert.equal(h.qty, 150);
    near(h.avgPrice, (100 * 1000 + 50 * 1100) / 150);
  });
});

describe("allocation and sectors", () => {
  it("allocation weights add up to one and cash is its own slice", () => {
    at("2026-10-05T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000);
    s = trade(s, "INFY", "buy", 100, 1500);
    const h = calculateHoldings(s, quotesOf([["TCS", 1000], ["INFY", 1500]]));
    const slices = calculatePortfolioAllocation(h, s.account.cash);
    near(slices.reduce((a, x) => a + x.weight, 0), 1, 1e-9);
    assert.equal(slices.find((x) => x.id === "cash")?.symbol, undefined);
    assert.equal(slices[0].symbol, "INFY");
  });

  it("more than eight holdings collapse the smallest into one Others slice that has no symbol to open", () => {
    const h = Array.from({ length: 10 }, (_, i) => ({
      symbol: `S${i}`, name: `Stock ${i}`, sector: "X", qty: 1, avgPrice: 1, last: 1, hasQuote: true, value: 100 - i, invested: 1, pnl: 0, returnPct: 0, dayPnl: 0, weight: 0, side: "long" as const,
    }));
    const slices = calculatePortfolioAllocation(h, 50);
    const others = slices.find((x) => x.id === "others")!;
    assert.ok(others && others.label === "Others (3)" && others.symbol === undefined);
    assert.equal(slices.length, 9);
    near(slices.reduce((a, x) => a + x.weight, 0), 1, 1e-9);
  });

  it("sector exposure groups holdings, includes cash, and adds up to one", () => {
    at("2026-10-05T10:00:00Z");
    let s = trade(fresh(), "NIFTYBEES", "buy", 1000, 268);
    s = trade(s, "NIFTY", "buy", 25, 23000);
    const h = calculateHoldings(s, quotesOf([["NIFTYBEES", 268], ["NIFTY", 23000]]));
    const rows = calculateSectorExposure(h, s.account.cash);
    assert.deepEqual(rows.map((r) => r.label).sort(), ["Cash", "ETFs", "Index"]);
    near(rows.reduce((a, r) => a + r.weight, 0), 1, 1e-9);
  });

  it("concentration reports the biggest holding, the biggest sector and the cash share", () => {
    at("2026-10-05T10:00:00Z");
    let s = trade(fresh(), "TCS", "buy", 100, 1000);
    s = trade(s, "INFY", "buy", 100, 3000);
    const h = calculateHoldings(s, quotesOf([["TCS", 1000], ["INFY", 3000]]));
    const c = calculateConcentration(h, s.account.cash);
    assert.equal(c.topHolding?.name, "Infosys");
    near(c.topHolding!.weight, 300000 / 1_000_000, 0.001);
    near(c.cashPct, s.account.cash / 1_000_000, 0.001);
    assert.equal(c.holdingsCount, 2);
    assert.equal(calculateTopHoldings(h, 1).length, 1);
  });

  it("an empty portfolio has no slices, no concentration and no division by zero", () => {
    const s = fresh(0);
    s.account.cash = 0;
    assert.deepEqual(calculatePortfolioAllocation([], 0), []);
    assert.deepEqual(calculateSectorExposure([], 0), []);
    assert.equal(calculateConcentration([], 0).topHolding, null);
    assert.equal(calculateSummary(s, []).totalReturn, 0);
  });
});

describe("trading statistics", () => {
  const trades = [tr("a", 3000), tr("b", 1000), tr("c", -500), tr("d", -1500), tr("e", 0)];

  it("counts wins, losses and flat trades, and the win rate is wins over all closed trades", () => {
    const s = calculateTradeStats(trades);
    assert.deepEqual([s.total, s.wins, s.losses, s.flat], [5, 2, 2, 1]);
    near(s.winRate!, 0.4, 1e-9);
    near(calculateWinRate(trades)!, 0.4, 1e-9);
  });

  it("averages, best and worst", () => {
    const s = calculateTradeStats(trades);
    near(s.avgWin!, 2000);
    near(s.avgLoss!, -1000);
    near(calculateAverageWin(trades)!, 2000);
    near(calculateAverageLoss(trades)!, -1000);
    assert.equal(s.best?.id, "a");
    assert.equal(s.worst?.id, "d");
    near(s.grossProfit + s.grossLoss, 2000);
  });

  it("with no trades every figure is null rather than zero", () => {
    const s = calculateTradeStats([]);
    assert.equal(s.winRate, null);
    assert.equal(s.avgWin, null);
    assert.equal(s.avgLoss, null);
    assert.equal(s.best, null);
  });

  it("there is no best trade when every trade lost, and no worst when every trade won", () => {
    assert.equal(calculateTradeStats([tr("x", -5)]).best, null);
    assert.equal(calculateTradeStats([tr("x", 5)]).worst, null);
  });
});

describe("the journal", () => {
  it("an old single-string note becomes the lesson, and nothing is invented", () => {
    const e = normalizeEntry("kept it too long");
    assert.equal(e.learned, "kept it too long");
    assert.equal(e.why, "");
    assert.equal(e.verdict, undefined);
  });

  it("success rate only counts trades with a thesis whose author judged them, never profit", () => {
    const trades = [tr("a", 100), tr("b", -100), tr("c", 100), tr("d", 100)];
    const journals = {
      a: { why: "results", expected: "", actual: "", learned: "", verdict: "yes" },
      b: { why: "breakout", expected: "", actual: "", learned: "", verdict: "no" },
      c: { why: "dividend", expected: "", actual: "", learned: "" }, // a thesis nobody has judged yet
      d: "an old note without a thesis",
    };
    const j = calculateJournalStats(trades, journals);
    assert.deepEqual([j.totalTrades, j.withThesis, j.judged, j.played], [4, 3, 2, 1]);
    near(j.successRate!, 0.5, 1e-9);
  });

  it("no judged trade means no success rate", () => {
    assert.equal(calculateJournalStats([tr("a", 1)], {}).successRate, null);
  });
});

describe("value over time", () => {
  const pt = (iso: string, v: number, base = 1_000_000, sim?: boolean): EquityPoint => ({ t: Date.parse(iso), v, base, sim });

  it("readings close together on one day replace each other; a later one is appended", () => {
    let h: EquityPoint[] = [];
    h = recordEquity(h, pt("2026-10-05T10:00:00", 100));
    h = recordEquity(h, pt("2026-10-05T10:02:00", 101));
    assert.equal(h.length, 1);
    assert.equal(h[0].v, 101);
    h = recordEquity(h, pt("2026-10-05T10:30:00", 102));
    assert.equal(h.length, 2);
  });

  it("a reading older than the last is ignored, and a non-number is never stored", () => {
    let h = recordEquity([], pt("2026-10-05T10:00:00", 100));
    h = recordEquity(h, pt("2026-10-05T09:00:00", 5));
    h = recordEquity(h, { t: Date.now(), v: Number.NaN, base: 1 });
    assert.equal(h.length, 1);
  });

  it("readings older than two weeks keep one per day", () => {
    let h: EquityPoint[] = [];
    for (const hr of [10, 11, 12, 13]) h = recordEquity(h, pt(`2026-09-01T${hr}:00:00`, 100 + hr));
    h = recordEquity(h, pt("2026-10-05T10:00:00", 200));
    assert.equal(h.filter((p) => new Date(p.t).getDate() === 1).length, 1);
    assert.equal(h.find((p) => new Date(p.t).getDate() === 1)?.v, 113);
  });

  it("a range holds only readings inside it, and reports when the history is shorter than the range", () => {
    const now = Date.parse("2026-10-05T15:00:00");
    const h = [pt("2026-10-03T10:00:00", 100), pt("2026-10-04T10:00:00", 104), pt("2026-10-05T10:00:00", 110), pt("2026-10-05T14:00:00", 112)];
    const day = sliceHistory(h, "1D", now);
    assert.equal(day.points.length, 2);
    near(day.change, 2);
    const month = sliceHistory(h, "1M", now);
    assert.equal(month.points.length, 4);
    assert.equal(month.partial, true);
    near(month.changePct!, 12 / 100, 1e-9);
    assert.equal(sliceHistory(h, "ALL", now).partial, false);
    assert.equal(sliceHistory([], "1W", now).points.length, 0);
    assert.equal(rangeStart("ALL"), 0);
  });

  it("flags a window that contains simulated prices", () => {
    const now = Date.parse("2026-10-05T15:00:00");
    const v = sliceHistory([pt("2026-10-05T10:00:00", 100, 100, true), pt("2026-10-05T11:00:00", 101)], "1D", now);
    assert.equal(v.anySimulated, true);
  });

  it("daily P&L is each day's last reading against that day's opening value, and only for days with readings", () => {
    const h = [
      pt("2026-10-01T10:00:00", 1_001_000, 1_000_000),
      pt("2026-10-01T15:00:00", 1_002_500, 1_000_000),
      pt("2026-10-05T11:00:00", 998_000, 1_002_500),
    ];
    const d = calculateDailyPnl(h);
    assert.equal(d.length, 2);
    near(d[0].pnl, 2500);
    near(d[1].pnl, -4500);
  });

  it("the benchmark is rebased to the portfolio's first value and skips readings before the index data", () => {
    const day = (iso: string, c: number): Candle => ({ t: Date.parse(iso), o: c, h: c, l: c, c, v: 0 });
    const candles = [day("2026-10-01T00:00:00", 100), day("2026-10-02T00:00:00", 110), day("2026-10-05T00:00:00", 121)];
    const points = [pt("2026-10-01T10:00:00", 1000), pt("2026-10-02T10:00:00", 1050), pt("2026-10-05T10:00:00", 1100)];
    const b = rebaseBenchmark(points, candles);
    assert.equal(b.length, 3);
    near(b[0].v, 1000);
    near(b[1].v, 1100);
    near(b[2].v, 1210);
    // a reading before the index data begins cannot be rebased
    assert.deepEqual(rebaseBenchmark([pt("2026-09-01T10:00:00", 1000), pt("2026-09-02T10:00:00", 1000)], candles), []);
    assert.deepEqual(rebaseBenchmark(points, []), []);
  });
});
