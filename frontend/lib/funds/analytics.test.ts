// Known-answer tests for the browser-side return and risk arithmetic. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSeriesSet,
  DAY,
  lumpsumProjection,
  maxDrawdown,
  MIN_INTERVALS,
  rollingReturns,
  riskStats,
  seriesFromPerformance,
  sipProjection,
  windowReturn,
  YEAR,
} from "./analytics";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const T0 = Date.UTC(2024, 0, 1);

/** Weekly rows whose subject and benchmark simple returns are the supplied arrays. */
function weekly(subject: number[], bench: number[]) {
  const rows = [{ t: T0, subject: 100 as number | null, bench: { IDX: 100 as number | null } }];
  subject.forEach((r, i) => {
    const prev = rows[i];
    rows.push({ t: T0 + (i + 1) * 7 * DAY, subject: (prev.subject as number) * (1 + r), bench: { IDX: (prev.bench.IDX as number) * (1 + bench[i]) } });
  });
  return rows;
}

describe("maxDrawdown", () => {
  const pt = (i: number, v: number) => ({ t: T0 + i * DAY, v });
  it("finds the deepest peak-to-trough fall and when it recovered", () => {
    const d = maxDrawdown([pt(0, 100), pt(1, 120), pt(2, 90), pt(3, 110), pt(4, 130)])!;
    near(d.depth, 90 / 120 - 1);
    assert.equal(d.peak, T0 + DAY);
    assert.equal(d.trough, T0 + 2 * DAY);
    assert.equal(d.recovered, T0 + 4 * DAY);
  });
  it("reports no fall, and no recovery, for a rising series", () => {
    const d = maxDrawdown([pt(0, 100), pt(1, 101), pt(2, 105)])!;
    assert.equal(d.depth, 0);
    assert.equal(d.recovered, null);
  });
  it("says nothing when it has fewer than two points", () => {
    assert.equal(maxDrawdown([pt(0, 100)]), null);
  });
  it("marks an unrecovered fall as not recovered", () => {
    assert.equal(maxDrawdown([pt(0, 100), pt(1, 80), pt(2, 90)])!.recovered, null);
  });
});

describe("series building", () => {
  it("chain-links interval returns into a growth-of-100 index", () => {
    const set = buildSeriesSet(weekly([0.1, 0.1], [0.05, -0.05]).map((r) => ({ ...r })), "P")!;
    near(set.subject[2].v, 121);
    near(set.benchmarks[0].points[2].v, 100 * 1.05 * 0.95);
  });
  it("drops intervals flagged as cash flows from the chain", () => {
    const rows = weekly([0.1, 0.5, 0.1], [0, 0, 0]);
    const set = buildSeriesSet(rows, "P", (_a, b) => b === rows[2].t)!;
    near(set.subject[3].v, 100 * 1.1 * 1.1);
    assert.equal(set.excluded, 1);
  });
  it("needs at least two marks", () => {
    assert.equal(buildSeriesSet([{ t: T0, subject: 100, bench: {} }], "P"), null);
  });
  it("builds from the server's time-weighted index without excluding anything", () => {
    const set = seriesFromPerformance([
      { date: "2026-01-05", portfolio: 100, benchmarks: { "NIFTY 50": 100 } },
      { date: "2026-01-12", portfolio: 102, benchmarks: { "NIFTY 50": 101 } },
      { date: "2026-01-19", portfolio: 99.96, benchmarks: { "NIFTY 50": 100.5 } },
    ])!;
    assert.equal(set.excluded, 0);
    near(set.subject[2].v, 99.96, 1e-9);
    assert.equal(set.benchmarks[0].label, "NIFTY 50");
  });
});

describe("risk measures wait for a year of history", () => {
  it("withholds annualized return, volatility, Sharpe and beta on ten weeks", () => {
    const rets = Array.from({ length: 10 }, (_, i) => (i % 2 ? 0.01 : -0.004));
    const set = buildSeriesSet(weekly(rets, rets.map((r) => r * 0.8)), "P")!;
    const s = riskStats(set, (iv) => iv.subject, set.subject, 0.065, "IDX");
    assert.equal(s.annualized, null);
    assert.equal(s.volatility, null);
    assert.equal(s.sharpe, null);
    assert.equal(s.beta, null);
    assert.equal(s.downCapture, null);
    assert.ok(s.years < 1);
    assert.ok(s.drawdown, "drawdown is still reported, over the period it covers");
  });

  it("the minimum is one year of weekly marks", () => {
    assert.equal(MIN_INTERVALS, 52);
  });

  it("annualizes, and measures beta and capture, once there is a year and a bit", () => {
    const bench = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.01 : -0.01));
    const subject = bench.map((r) => 2 * r);
    const set = buildSeriesSet(weekly(subject, bench), "P")!;
    const s = riskStats(set, (iv) => iv.subject, set.subject, 0.05, "IDX");
    assert.ok(s.years > 1);
    assert.ok(s.annualized != null);
    near(s.beta as number, 2, 1e-9);
    near(s.upCapture as number, 2, 1e-9);
    near(s.downCapture as number, 2, 1e-9);
    assert.ok(s.volatility != null && s.volatility > 0);
  });

  it("cumulative return is the compounded product, not an average", () => {
    const set = buildSeriesSet(weekly([0.1, -0.1], [0, 0]), "P")!;
    near(riskStats(set, (iv) => iv.subject, set.subject, null).cumulative, 1.1 * 0.9 - 1, 1e-12);
  });
});

describe("rolling returns", () => {
  const growth = (annual: number, weeks: number) => weekly(Array(weeks).fill((1 + annual) ** (7 / 365.25) - 1), Array(weeks).fill(0));

  it("every 1Y window of a steady 10% grower compounds at 10%", () => {
    const set = buildSeriesSet(growth(0.1, 160), "P")!;
    const r = rollingReturns(set, 1, "IDX")!;
    assert.ok(r.count > 50);
    near(r.min, 0.1, 5e-3);
    near(r.max, 0.1, 5e-3);
    assert.equal(r.positiveShare, 1);
    assert.equal(r.beatShare, 1); // the benchmark is flat
  });

  it("returns nothing for a window longer than the history", () => {
    const set = buildSeriesSet(growth(0.1, 100), "P")!; // about 1.9 years
    assert.equal(rollingReturns(set, 3, "IDX"), null);
    assert.equal(rollingReturns(set, 5, "IDX"), null);
    assert.ok(rollingReturns(set, 1, "IDX"));
  });

  it("returns nothing for a single month", () => {
    const set = buildSeriesSet(growth(0.1, 5), "P")!;
    assert.equal(rollingReturns(set, 1, "IDX"), null);
  });

  it("names the worst window", () => {
    const rets = [...Array(60).fill(0.002), ...Array(10).fill(-0.03), ...Array(60).fill(0.002)];
    const set = buildSeriesSet(weekly(rets, rets.map(() => 0)), "P")!;
    const r = rollingReturns(set, 1, "IDX")!;
    assert.ok(r.min < 0 && r.positiveShare < 1);
    assert.ok(r.worstEnd > T0);
  });
});

describe("window returns", () => {
  it("measures subject and benchmark over the same two dates", () => {
    const set = buildSeriesSet(weekly([0.1, 0.1, 0.1], [0.02, 0.02, 0.02]), "P")!;
    const w = windowReturn(set, T0 + 7 * DAY, T0 + 21 * DAY, "IDX")!;
    near(w.subject, 1.1 * 1.1 - 1, 1e-9);
    near(w.bench as number, 1.02 * 1.02 - 1, 1e-9);
  });
  it("is null when the window is outside the data", () => {
    const set = buildSeriesSet(weekly([0.1, 0.1], [0, 0]), "P")!;
    assert.equal(windowReturn(set, T0 - 400 * DAY, T0 - 300 * DAY, "IDX"), null);
  });
});

describe("SIP and lumpsum projections", () => {
  const simulate = (monthly: number, annual: number, months: number) => {
    const r = (1 + annual) ** (1 / 12) - 1;
    let v = 0;
    for (let m = 0; m < months; m++) v = (v + monthly) * (1 + r);
    return v;
  };
  it("matches the closed form FV = P x ((1+r)^n - 1) / r x (1+r) with a monthly rate", () => {
    near(sipProjection(10_000, 0.12, 1).value, 127_666, 60);
    for (const [p, rate, years] of [[5_000, 0.08, 10], [25_000, 0.15, 25], [1_000, 0.005, 3]] as const) {
      near(sipProjection(p, rate, years).value, simulate(p, rate, years * 12), 1e-6 * simulate(p, rate, years * 12));
    }
  });
  it("does not treat the annual rate as a monthly one", () => {
    assert.ok(sipProjection(10_000, 0.12, 1).value < 135_000);
  });
  it("invested is the sum of contributions", () => {
    near(sipProjection(5_000, 0.1, 2).invested, 120_000);
  });
  it("lumpsum is PV x (1 + r)^years", () => {
    near(lumpsumProjection(100_000, 0.1, 5).value, 161_051, 1);
    near(lumpsumProjection(100_000, 0, 5).value, 100_000);
  });
  it("a year is 365.25 days", () => {
    assert.equal(YEAR, 365.25 * DAY);
  });
});
