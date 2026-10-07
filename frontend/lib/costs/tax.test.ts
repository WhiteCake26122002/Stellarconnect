// Holding periods, lots, the tax estimate and the gross-to-net ladder. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { allocatePaise, calculateRealizedGain, classifyHoldingPeriod, matchFifo } from "./lots";
import { calculateAfterTaxReturn, calculateNetPnL, costImpact } from "./pnl";
import { assessConfidence, calculateEstimatedTax, calculateLTCG, calculateSTCG, setOffWithinClass, type TaxItem, type TaxProfile } from "./tax";
import { rulesFor } from "./rules";

const near = (a: number, b: number, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(path.join(here, "..", "regulatory", "tax_vectors.json"), "utf8")) as {
  cases: { id: string; why: string; fy: string; items: { id: string; bucket: TaxItem["bucket"]; gain: number }[]; profile: TaxProfile | null; expect: Record<string, number | boolean> }[];
};

const item = (id: string, bucket: TaxItem["bucket"], gain: number): TaxItem => ({
  id, label: id, bucket, gain, term: bucket.startsWith("stcg") ? "short" : "long", heldDays: 1, heldText: "1 day", openedOn: "2026-05-01", closedOn: "2026-05-02",
});

describe("shared tax vectors (the Python engine runs the same file)", () => {
  for (const c of vectors.cases) {
    it(`${c.id}: ${c.why}`, () => {
      const est = calculateEstimatedTax({ fy: c.fy, items: c.items.map((i) => item(i.id, i.bucket, i.gain)), profile: c.profile });
      const got: Record<string, number | boolean> = {
        supported: est.supported,
        taxBeforeSurchargeCess: est.taxBeforeSurchargeCess,
        surcharge: est.surcharge,
        cess: est.cess,
        total: est.total,
        includesSurchargeCess: est.includesSurchargeCess,
        exemptionApplied: est.exemptionApplied,
        exemptionRoom: est.exemptionRoom,
        stcg: est.stcg,
        ltcg: est.ltcg,
        slabGainNotEstimated: est.slabGainNotEstimated,
        unabsorbedLossLong: est.unabsorbedLoss.long,
        rulesAssumed: Boolean(est.rules?.assumed),
      };
      for (const [k, want] of Object.entries(c.expect)) {
        if (typeof want === "boolean") assert.equal(got[k], want, `${c.id}.${k}`);
        else near(got[k] as number, want, 0.01);
      }
    });
  }
});

describe("holding period", () => {
  it("is long-term only when held MORE than 12 months", () => {
    assert.equal(classifyHoldingPeriod("2025-01-10", "2026-01-09", 12).term, "short");
    assert.equal(classifyHoldingPeriod("2025-01-10", "2026-01-10", 12).term, "short"); // exactly 12 months is still short
    assert.equal(classifyHoldingPeriod("2025-01-10", "2026-01-11", 12).term, "long");
  });

  it("reports when a short-term lot turns long-term", () => {
    const p = classifyHoldingPeriod("2025-01-10", "2025-07-10", 12);
    assert.equal(p.longTermFrom, "2026-01-11");
    assert.equal(p.months, 6);
    assert.equal(p.text, "6 months");
  });

  it("handles a month-end purchase and a leap-year boundary", () => {
    assert.equal(classifyHoldingPeriod("2024-02-29", "2025-02-28", 12).term, "short");
    assert.equal(classifyHoldingPeriod("2024-02-29", "2025-03-01", 12).term, "long");
  });

  it("uses a 24-month threshold when told to", () => {
    assert.equal(classifyHoldingPeriod("2024-06-01", "2026-05-31", 24).term, "short");
    assert.equal(classifyHoldingPeriod("2024-06-01", "2026-06-02", 24).term, "long");
  });

  it("describes short and long holds in plain words", () => {
    assert.equal(classifyHoldingPeriod("2026-05-01", "2026-05-13", 12).text, "12 days");
    assert.equal(classifyHoldingPeriod("2024-05-01", "2026-07-02", 12).text, "2 years 2 months");
  });
});

describe("lots", () => {
  it("matches the oldest lot first", () => {
    const lots = [{ id: "a", qty: 100 }, { id: "b", qty: 50 }];
    const { slices, shortfall } = matchFifo(lots, 120);
    assert.deepEqual(slices.map((s) => [s.lot.id, s.qty]), [["a", 100], ["b", 20]]);
    assert.equal(shortfall, 0);
    assert.equal(matchFifo(lots, 200).shortfall, 50);
  });

  it("splits a total across parts in whole paise that add up exactly", () => {
    const parts = allocatePaise(100, [1, 1, 1]);
    near(parts.reduce((a, b) => a + b, 0), 100, 1e-9);
    assert.deepEqual(allocatePaise(0.1, [0, 0]), [0, 0]);
  });

  it("realised gain: STT reduces the net result but is not deducted from the taxable gain", () => {
    const g = calculateRealizedGain({ qty: 100, side: "long", openPrice: 1000, closePrice: 1100, openCharges: 354.74, closeCharges: 400, openStt: 100, closeStt: 110 });
    assert.equal(g.gross, 10000);
    assert.equal(g.charges, 754.74);
    assert.equal(g.net, 9245.26);
    assert.equal(g.taxable, 9455.26); // 10000 - (754.74 - 210)
    assert.equal(g.sttNotDeductible, 210);
  });

  it("a short position gains when the price falls", () => {
    const g = calculateRealizedGain({ qty: 10, side: "short", openPrice: 100, closePrice: 90, openCharges: 0, closeCharges: 0, openStt: 0, closeStt: 0 });
    assert.equal(g.gross, 100);
  });
});

describe("estimated tax: the pieces", () => {
  const rules = rulesFor("FY2026-27")!;
  const none: TaxProfile = { slabRatePct: null, incomeBand: null, regime: "new" };

  it("set-off follows the law: short-term loss absorbs long-term gain, never the reverse", () => {
    assert.deepEqual(setOffWithinClass(-30000, 100000), { shortAfter: 0, longAfter: 70000, absorbedByLong: 30000 });
    assert.deepEqual(setOffWithinClass(-30000, 10000), { shortAfter: -20000, longAfter: 0, absorbedByLong: 10000 });
    assert.deepEqual(setOffWithinClass(50000, -20000), { shortAfter: 50000, longAfter: -20000, absorbedByLong: 0 });
  });

  it("STCG and LTCG helpers read the rate from the year's rules", () => {
    assert.equal(calculateSTCG(1000, 0, rules, none).equity.ratePct, rules.equity.stcgRatePct);
    assert.equal(calculateLTCG(200000, 0, rules).equity.exemption, rules.equity.ltcgExemption);
  });

  it("splits the tax across items by gain and gives a loss none", () => {
    const est = calculateEstimatedTax({
      fy: "FY2026-27",
      items: [item("a", "stcg111A", 30000), item("b", "stcg111A", 10000), item("c", "stcg111A", -5000)],
      profile: null,
    });
    // net 35,000 -> tax 7,000 spread over the two gains 3:1
    near(est.perItem.a + est.perItem.b, 7000, 0.02);
    near(est.perItem.a, 5250, 0.02);
    assert.equal(est.perItem.c, 0);
  });

  it("two financial years never share an exemption", () => {
    const y1 = calculateEstimatedTax({ fy: "FY2025-26", items: [item("a", "ltcg112A", 125000)], profile: null });
    const y2 = calculateEstimatedTax({ fy: "FY2026-27", items: [item("b", "ltcg112A", 125000)], profile: null });
    assert.equal(y1.taxBeforeSurchargeCess, 0);
    assert.equal(y2.taxBeforeSurchargeCess, 0);
    const together = calculateEstimatedTax({ fy: "FY2026-27", items: [item("a", "ltcg112A", 125000), item("b", "ltcg112A", 125000)], profile: null });
    near(together.taxBeforeSurchargeCess, 15625);
  });

  it("states what it left out", () => {
    const est = calculateEstimatedTax({ fy: "FY2026-27", items: [item("a", "stcg111A", -1000)], profile: null });
    assert.ok(est.notes.some((n) => n.includes("Advanced tax-loss adjustment requires additional tax information")));
    assert.ok(est.notes.some((n) => n.includes("Surcharge and cess are not included")));
    assert.equal(est.headline, "Estimated tax before surcharge and cess");
  });
});

describe("confidence", () => {
  it("is incomplete when part of the history has no usable date or class", () => {
    const c = assessConfidence({ coveragePct: 92, missing: ["2 lots have no purchase date"], assumptions: [] });
    assert.equal(c.level, "incomplete");
    assert.equal(c.coveragePct, 92);
    assert.ok(c.basis.includes("92%"));
  });
  it("is estimated when an assumption was needed and high only when nothing was", () => {
    assert.equal(assessConfidence({ coveragePct: 100, missing: [], assumptions: ["income not set"] }).level, "estimated");
    assert.equal(assessConfidence({ coveragePct: 100, missing: [], assumptions: [] }).level, "high");
  });
});

describe("gross to net to after-tax", () => {
  it("net P&L subtracts charges once", () => {
    assert.deepEqual(calculateNetPnL({ gross: 25000, charges: 1250 }), { gross: 25000, charges: 1250, net: 23750 });
  });

  it("a realised result gets an after-tax return", () => {
    const r = calculateAfterTaxReturn({ invested: 100000, gross: 14200, charges: 350, tax: 2400, realized: true });
    near(r.grossReturnPct!, 14.2);
    near(r.netReturnPct!, 13.85);
    near(r.afterTaxReturnPct!, 11.45);
    assert.equal(r.label, "After-tax return");
  });

  it("an open position gets no after-tax return, only a different label", () => {
    const r = calculateAfterTaxReturn({ invested: 100000, gross: 14200, charges: 350, tax: 2400, realized: false });
    assert.equal(r.afterTaxReturnPct, null);
    assert.equal(r.tax, null);
    assert.equal(r.label, "Estimated after-tax value on redemption");
  });

  it("the cost ladder", () => {
    const c = costImpact({ gross: 50000, charges: 2300, tax: 8000 });
    assert.equal(c.netBeforeTax, 47700);
    assert.equal(c.netAfterTax, 39700);
    assert.equal(costImpact({ gross: 50000, charges: 2300, tax: null }).netAfterTax, null);
  });
});
