// Scenario arithmetic and the wording helpers. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FundAnalysis, FundHolding } from "../api";
import { blendedRates, CLASS_ASSUMPTIONS, inflationAdjusted, portfolioMix, project } from "./plan";
import { benchView, pts, returnView, spanText, VERDICT_LABEL, verdictTone } from "./returns";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

const holding = (category: string, value: number, name = "Some Fund", live = true) =>
  ({ scheme_category: category, scheme_name: name, value, data_available: live }) as unknown as FundHolding;

describe("portfolio mix and blended assumptions", () => {
  it("weights asset classes by value and ignores funds with no live NAV", () => {
    const mix = portfolioMix([
      holding("Equity Scheme - Flexi Cap Fund", 600),
      holding("Debt Scheme - Liquid Fund", 200),
      holding("Hybrid Scheme - Balanced Hybrid Fund", 200),
      holding("Equity Scheme - Large Cap Fund", 5000, "Ghost", false),
    ])!;
    near(mix.equity, 0.6);
    near(mix.debt, 0.2);
    near(mix.hybrid, 0.2);
  });
  it("counts an equity index fund as equity and a debt index fund as debt", () => {
    const mix = portfolioMix([
      holding("Other Scheme - Index Funds", 500, "UTI Nifty 50 Index Fund"),
      holding("Other Scheme - Index Funds", 500, "Bharat Bond ETF Gilt Index"),
    ])!;
    near(mix.equity, 0.5);
    near(mix.debt, 0.5);
  });
  it("is null with nothing to value", () => {
    assert.equal(portfolioMix([]), null);
    assert.equal(portfolioMix([holding("Equity Scheme - Flexi Cap Fund", 0)]), null);
  });
  it("a pure equity book uses the equity assumptions exactly", () => {
    assert.deepEqual(blendedRates({ equity: 1, hybrid: 0, debt: 0 }), CLASS_ASSUMPTIONS.equity);
  });
  it("blends by weight, and falls back to equity with no holdings", () => {
    assert.deepEqual(blendedRates({ equity: 0.5, hybrid: 0, debt: 0.5 }), [6.5, 8.8, 10.8]);
    assert.deepEqual(blendedRates(null), CLASS_ASSUMPTIONS.equity);
  });
  it("assumptions are ordered conservative <= base <= optimistic for every class", () => {
    for (const rates of Object.values(CLASS_ASSUMPTIONS)) assert.ok(rates[0] <= rates[1] && rates[1] <= rates[2]);
  });
});

describe("scenario projection", () => {
  it("restates the corpus in today's money", () => {
    near(inflationAdjusted(12_400_000, 6, 25), 12_400_000 / 1.06 ** 25, 1e-3);
    assert.equal(inflationAdjusted(100, 6, 0), 100);
  });
  it("a higher scenario never ends below a lower one", () => {
    const [c, b, o] = [8, 11, 14].map((r) => project("sip", 10_000, 20, r, 6));
    assert.ok(c.value < b.value && b.value < o.value);
    assert.equal(c.invested, b.invested);
    assert.ok(c.real < c.value);
  });
  it("a lumpsum is amount x (1 + rate)^years and invests only once", () => {
    const r = project("lumpsum", 100_000, 5, 10, 0);
    near(r.value, 161_051, 1);
    assert.equal(r.invested, 100_000);
    near(r.real, r.value, 1e-9); // zero inflation changes nothing
  });
  it("the path ends where the headline number ends", () => {
    const r = project("sip", 5_000, 15, 11, 6);
    const last = r.path[r.path.length - 1];
    near(last.value, r.value, 1e-6);
    near(last.real, r.real, 1e-6);
    assert.equal(last.year, 15);
  });
});

const row = (over: Record<string, unknown> = {}) =>
  ({
    fund_return_pct: -1.9,
    xirr: { value: null, annualized: false, status: "short_history", days: 9, note: "Only 9 days since the first purchase." },
    benchmark: { key: "NIFTY 500", ticker: "^CRSLDX", label: "Nifty 500", proxy: false, note: "", reason: null, return_pct: -3.3, status: "available" },
    ...over,
  }) as unknown as FundAnalysis["funds"][number];

describe("return presentation", () => {
  it("shows the plain return when XIRR is not annualizable", () => {
    const v = returnView(row());
    assert.equal(v.value, -1.9);
    assert.equal(v.annualized, false);
    assert.equal(v.short, "Since purchase");
    assert.match(v.note, /9 days/);
  });
  it("shows XIRR only when the server allows it", () => {
    const ok = row({ xirr: { value: 12.5, annualized: true, status: "ok", days: 800, note: "Annualized." } });
    assert.deepEqual([returnView(ok).value, returnView(ok).label], [12.5, "XIRR (annualized)"]);
    assert.equal(returnView(ok, ["xirr"]).value, -1.9, "a withheld XIRR falls back to the plain return");
  });
  it("shows a stand-in benchmark as a proxy and an absent one with its reason", () => {
    assert.equal(benchView(row()).available, true);
    const none = benchView(row({ benchmark: { key: null, label: null, proxy: false, note: "", reason: "No free debt-index history.", return_pct: null, status: "no_mapping" } }));
    assert.equal(none.available, false);
    assert.match(none.note, /debt-index/);
    assert.equal(benchView(row({ benchmark: { ...row().benchmark, proxy: true, note: "stand-in" } })).proxy, true);
  });
  it("labels verdicts without calling anyone good or bad", () => {
    assert.equal(VERDICT_LABEL.too_early, "Too early to call");
    assert.equal(verdictTone("outperformed"), "bull");
    assert.equal(verdictTone("underperformed"), "bear");
    assert.equal(verdictTone("tracking"), "");
    assert.equal(verdictTone("too_early"), "");
  });
  it("formats percentage points and spans", () => {
    assert.equal(pts(1.4), "+1.4 pts");
    assert.equal(pts(-0.35, 2), "−0.35 pts");
    assert.equal(pts(null), "n/a");
    assert.equal(spanText(1), "1 day");
    assert.equal(spanText(10), "10 days");
    assert.equal(spanText(180), "6 months");
    assert.equal(spanText(850), "2.3 years");
  });
});
