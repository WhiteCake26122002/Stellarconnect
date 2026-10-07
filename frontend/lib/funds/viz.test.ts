// Known-answer tests for the numbers behind the fund visuals. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FundHolding } from "@/lib/api";
import { buildSeriesSet, DAY, YEAR } from "./analytics";
import { allocationTree, concentration, directShare, drawdownSeries, healthScore, rangeUsable, rebase, trailing, weeklySet } from "./viz";
import type { FundHistory } from "@/lib/api";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

function holding(code: number, value: number, category: string, name = `Fund ${code} - Direct Plan - Growth`, house = `House ${code}`, plan: FundHolding["plan"] = "Direct"): FundHolding {
  return { scheme_code: code, scheme_name: name, scheme_category: category, fund_house: house, plan, units: 1, avg_nav: value, current_nav: value, nav_date: "2026-01-01", invested: value, value, gain: 0, gain_pct: 0, return_1y: null, purchase_date: "2025-01-01", days_held: 100, weight_pct: null, data_available: true };
}

const EQ = "Equity Scheme - Flexi Cap Fund";
const LC = "Equity Scheme - Large Cap Fund";
const DEBT = "Debt Scheme - Corporate Bond Fund";

describe("allocation tree", () => {
  const tree = allocationTree([holding(1, 600, EQ), holding(2, 200, LC), holding(3, 200, DEBT)]);
  it("groups asset class, then category, then fund, with weights of the whole", () => {
    assert.deepEqual(tree.map((n) => n.label), ["Equity", "Debt"]);
    near(tree[0].pct, 80);
    near(tree[1].pct, 20);
    assert.deepEqual(tree[0].children.map((c) => c.label), ["Flexi Cap", "Large Cap"]);
    near(tree[0].children[0].pct, 60);
    assert.equal(tree[0].children[0].children[0].code, 1);
  });
  it("children add up to their parent", () => {
    for (const n of tree) near(n.children.reduce((a, c) => a + c.value, 0), n.value);
  });
  it("ignores a fund with no live NAV and is empty with none", () => {
    assert.equal(allocationTree([{ ...holding(1, 100, EQ), data_available: false }]).length, 0);
  });
});

describe("concentration", () => {
  it("cumulates the largest funds and reports effective count", () => {
    const c = concentration([holding(1, 50, EQ), holding(2, 30, EQ), holding(3, 10, EQ), holding(4, 5, EQ), holding(5, 5, EQ)])!;
    near(c.top1, 50);
    near(c.top3, 90);
    near(c.top5, 100);
    near(c.hhi, 0.25 + 0.09 + 0.01 + 0.0025 + 0.0025);
    near(c.effective, 1 / 0.355);
    assert.equal(c.largest?.code, 1);
  });
  it("four equal funds are four effective funds", () => {
    near(concentration([1, 2, 3, 4].map((i) => holding(i, 25, EQ)))!.effective, 4);
  });
});

describe("health score", () => {
  const well = [holding(1, 20, EQ), holding(2, 20, LC), holding(3, 20, DEBT), holding(4, 20, "Hybrid Scheme - Aggressive Hybrid Fund"), holding(5, 20, "Equity Scheme - Mid Cap Fund")];
  it("scores a spread portfolio high and a single fund low on concentration", () => {
    const a = healthScore({ holdings: well, relativePp: null, suitability: null });
    const b = healthScore({ holdings: [holding(1, 100, EQ)], relativePp: null, suitability: null });
    const conc = (h: typeof a) => h.parts.find((p) => p.id === "concentration")!.score!;
    assert.equal(conc(a), 90); // largest fund 20% scores 100; the largest three hold 60%, which scores 75; 0.6*100 + 0.4*75
    assert.equal(conc(b), 0);
  });
  it("averages only the parts it can measure, and says which are missing", () => {
    const h = healthScore({ holdings: well, relativePp: null, suitability: null });
    assert.equal(h.used, 3); // diversification, concentration, plan cost
    assert.equal(h.parts.find((p) => p.id === "risk")!.score, null);
    assert.ok(h.parts.find((p) => p.id === "risk")!.missing);
    assert.equal(h.parts.find((p) => p.id === "performance")!.detail, "Insufficient history");
  });
  it("never invents a score when nothing can be measured", () => {
    const h = healthScore({ holdings: [], relativePp: null, suitability: null });
    assert.equal(h.score, null);
    assert.equal(h.band, null);
  });
  it("risk alignment is full inside the band and falls 2.5 a point outside it", () => {
    const risk = (equityPct: number) => healthScore({ holdings: well, relativePp: null, suitability: { equityPct, low: 50, high: 70 } }).parts.find((p) => p.id === "risk")!.score;
    assert.equal(risk(60), 100);
    assert.equal(risk(80), 75);
    assert.equal(risk(30), 50);
  });
  it("performance is 50 when level with the benchmark and moves 5 a point", () => {
    const perf = (pp: number) => healthScore({ holdings: well, relativePp: pp, suitability: null }).parts.find((p) => p.id === "performance")!.score;
    assert.equal(perf(0), 50);
    assert.equal(perf(4), 70);
    assert.equal(perf(-4), 30);
    assert.equal(perf(30), 100);
  });
  it("plan cost counts only Direct and Regular, not unknown plans", () => {
    const cost = (hs: FundHolding[]) => healthScore({ holdings: hs, relativePp: null, suitability: null }).parts.find((p) => p.id === "cost")!.score;
    assert.equal(cost([holding(1, 50, EQ), holding(2, 50, EQ, "x", "h", "Regular")]), 50);
    assert.equal(cost([holding(1, 50, EQ), holding(2, 50, EQ, "x", "h", "Unknown")]), 100);
    near(directShare([holding(1, 75, EQ), holding(2, 25, EQ, "x", "h", "Regular")])!.regular, 25);
  });
  it("bands the average", () => {
    assert.equal(healthScore({ holdings: well, relativePp: 10, suitability: { equityPct: 60, low: 50, high: 70 } }).band, "Strong");
  });
});

describe("rebase, trailing and drawdown", () => {
  const T0 = Date.UTC(2020, 0, 1);
  const weeks = (levels: number[]) => levels.map((v, i) => ({ t: T0 + i * 7 * DAY, v }));
  it("rebases to 100 at the chosen start and keeps ratios", () => {
    const r = rebase(weeks([50, 55, 60, 75]), T0 + 7 * DAY);
    near(r[0].v, 100);
    near(r[2].v, 75 / 55 * 100);
  });
  it("refuses a rebase on fewer than two points", () => {
    assert.deepEqual(rebase(weeks([50, 55]), T0 + 14 * DAY), []);
  });
  it("trailing return needs the whole window", () => {
    const levels = Array.from({ length: 60 }, (_, i) => 100 * 1.002 ** i); // about 14 months weekly
    const rows = levels.map((v, i) => ({ t: T0 + i * 7 * DAY, subject: v, bench: {} as Record<string, number | null> }));
    const set = buildSeriesSet(rows, "p")!;
    const one = trailing(set.subject, 1, set)!;
    assert.equal(one.annualized, false);
    near(one.value, levels[59] / levels[59 - 52] - 1, 1e-3);
    assert.equal(trailing(set.subject, 3, set), null);
  });
  it("drawdown is zero at highs and the percentage below the peak otherwise", () => {
    const dd = drawdownSeries(weeks([100, 120, 90, 110, 130]));
    assert.deepEqual(dd.map((d) => Math.round(d.dd * 1000) / 1000), [0, 0, -0.25, -0.083, 0]);
  });
  it("a range is offered only when history reaches back far enough", () => {
    const last = T0 + 2 * YEAR;
    assert.equal(rangeUsable(T0, last, 365, 50), true);
    assert.equal(rangeUsable(T0, last, 1826, 50), false);
    assert.equal(rangeUsable(T0, last, null, 50), true);
  });
});

describe("weekly set from a fund's NAV history", () => {
  const day = (offset: number) => new Date(Date.UTC(2025, 0, 6 + offset)).toISOString().slice(0, 10); // 6 Jan 2025 is a Monday
  const hist = (points: { d: number; nav: number; bench: number | null }[], benchmark = true): FundHistory => ({
    scheme_code: 1, scheme_name: "x", category: "Equity", inception_date: day(0), as_of: day(points[points.length - 1].d),
    points: points.map((p) => ({ date: day(p.d), nav: p.nav, bench: p.bench })),
    benchmark: benchmark ? { key: "NIFTY 500", label: "NIFTY 500", proxy: false, note: "", basis: "" } : null,
    benchmark_reason: null,
  });
  it("keeps the last mark of each week", () => {
    const set = weeklySet(hist([{ d: 0, nav: 100, bench: 1000 }, { d: 2, nav: 101, bench: 1010 }, { d: 4, nav: 102, bench: 1020 }, { d: 7, nav: 103, bench: 1030 }, { d: 11, nav: 105, bench: 1050 }, { d: 14, nav: 106, bench: 1060 }]))!;
    // week 1 ends on 102, week 2 (13 and 17 Jan) on 105, week 3 on 106
    assert.deepEqual(set.subject.map((p) => Math.round(p.v * 100) / 100), [100, Math.round(105 / 102 * 10000) / 100, Math.round(106 / 102 * 10000) / 100]);
    assert.equal(set.benchmarks[0].label, "NIFTY 500");
  });
  it("treats 31 December and 1 January of the same week as one week", () => {
    const at = (iso: string, nav: number) => ({ date: iso, nav, bench: null });
    const h: FundHistory = { scheme_code: 1, scheme_name: "x", category: "Equity", inception_date: "2024-12-23", as_of: "2025-01-13", benchmark: null, benchmark_reason: null,
      points: [at("2024-12-23", 100), at("2024-12-31", 101), at("2025-01-01", 102), at("2025-01-06", 103), at("2025-01-13", 104)] };
    const set = weeklySet(h)!;
    assert.equal(set.subject.length, 4); // weeks of 23 Dec, 30 Dec (31 Dec and 1 Jan together), 6 Jan, 13 Jan
    near(set.subject[1].v, (102 / 100) * 100);
  });
  it("leaves a missing benchmark week empty instead of filling it", () => {
    const set = weeklySet(hist([{ d: 0, nav: 100, bench: 1000 }, { d: 7, nav: 101, bench: null }, { d: 14, nav: 102, bench: 1020 }, { d: 21, nav: 103, bench: 1030 }]))!;
    const pts = set.benchmarks[0].points;
    assert.equal(pts.length, 4);
    near(pts[1].v, pts[0].v); // the interval with no close contributes no move
  });
  it("has no benchmark series when the fund has none", () => {
    const set = weeklySet(hist([{ d: 0, nav: 100, bench: null }, { d: 7, nav: 101, bench: null }, { d: 14, nav: 102, bench: null }], false))!;
    assert.equal(set.benchmarks.length, 0);
  });
  it("needs a few marks", () => {
    assert.equal(weeklySet(hist([{ d: 0, nav: 100, bench: null }, { d: 7, nav: 101, bench: null }])), null);
    assert.equal(weeklySet(null), null);
  });
});
