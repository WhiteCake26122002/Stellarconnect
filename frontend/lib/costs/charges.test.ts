// The charge engine, against hand-worked contract-note arithmetic. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  brokerageRuleText,
  calculateBrokerage,
  calculateExchangeCharges,
  calculateGST,
  calculateSEBICharges,
  calculateSTT,
  calculateStampDuty,
  calculateTransactionCharges,
  netTransactionValue,
  sumBreakdowns,
  type ChargeInput,
} from "./charges";
import { chargeTarget, taxTreatment } from "./classify";
import { CHARGES, addMonths, financialYearOf, fyBounds, rateOn, rulesFor } from "./rules";

const near = (a: number, b: number, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

const base: ChargeInput = { segment: "equityDelivery", exchange: "NSE", side: "buy", quantity: 100, price: 1000, date: "2026-10-05", profileId: "default-simulator" };
const charge = (over: Partial<ChargeInput>) => calculateTransactionCharges({ ...base, ...over });

describe("equity delivery", () => {
  it("buy: every component of a Rs 1,00,000 order", () => {
    const b = charge({});
    assert.equal(b.turnover, 100000);
    assert.equal(b.brokerage, 200); // 0.20% in the default profile
    assert.equal(b.stt, 100); // 0.1% on the buy side
    assert.equal(b.exchangeCharges, 3.07); // NSE 0.00307%
    assert.equal(b.sebi, 0.1); // Rs 10 per crore
    assert.equal(b.stampDuty, 15); // 0.015% on buy
    assert.equal(b.other, 0); // no depository charge on a buy
    assert.equal(b.gstBase, 203.17); // brokerage + exchange + SEBI, not STT, not stamp duty, not the trade value
    assert.equal(b.gst, 36.57);
    assert.equal(b.total, 354.74);
    assert.equal(netTransactionValue(b), 100354.74); // the debit
    assert.equal(b.deductible, 254.74); // everything but STT
  });

  it("sell: STT again, no stamp duty, a depository charge, GST on that too", () => {
    const b = charge({ side: "sell" });
    assert.equal(b.stt, 100);
    assert.equal(b.stampDuty, 0);
    assert.equal(b.other, 13);
    assert.equal(b.gstBase, 216.17);
    assert.equal(b.gst, 38.91);
    assert.equal(b.total, 355.08);
    assert.equal(netTransactionValue(b), 99644.92); // the credit
  });

  it("GST is never the trade value times the rate", () => {
    const b = charge({});
    assert.notEqual(b.gst, 100000 * 0.18);
    near(b.gst, b.gstBase * 0.18);
  });

  it("the depository charge applies once per scrip per day", () => {
    const again = charge({ side: "sell", dpAlreadyCharged: true });
    assert.equal(again.other, 0);
    assert.equal(again.gstBase, 203.17);
    assert.equal(again.total, 355.08 - 13 - 2.34); // minus the DP charge and the GST on it
  });
});

describe("equity intraday", () => {
  it("buy: capped brokerage, no STT, 0.003% stamp duty", () => {
    const b = charge({ segment: "equityIntraday" });
    assert.equal(b.brokerage, 20); // 0.03% is Rs 30, capped at Rs 20
    assert.equal(b.stt, 0);
    assert.equal(b.stampDuty, 3);
    assert.equal(b.gst, 4.17);
    assert.equal(b.total, 30.34);
  });

  it("sell: STT 0.025%, no stamp duty", () => {
    const b = charge({ segment: "equityIntraday", side: "sell" });
    assert.equal(b.stt, 25);
    assert.equal(b.stampDuty, 0);
    assert.equal(b.other, 0); // the depository charge is for delivery sells only
    assert.equal(b.total, 52.34);
  });

  it("is a different schedule from delivery for the same trade", () => {
    assert.ok(charge({ segment: "equityIntraday" }).total < charge({}).total / 5);
  });
});

describe("futures and options", () => {
  it("futures sell after 1 Apr 2026: STT 0.05% on the contract value", () => {
    const b = charge({ segment: "futures", side: "sell", quantity: 25, price: 24000 });
    assert.equal(b.turnover, 600000);
    assert.equal(b.brokerage, 20);
    assert.equal(b.stt, 300);
    assert.equal(b.exchangeCharges, 10.98);
    assert.equal(b.sebi, 0.6);
    assert.equal(b.stampDuty, 0);
    assert.equal(b.gst, 5.68);
    assert.equal(b.total, 337.26);
  });

  it("the same futures sell on 15 Mar 2026 is charged the old 0.02% STT", () => {
    const b = charge({ segment: "futures", side: "sell", quantity: 25, price: 24000, date: "2026-03-15" });
    assert.equal(b.stt, 120);
    assert.equal(b.total, 157.26);
  });

  it("STT has no buy-side charge on futures", () => {
    assert.equal(charge({ segment: "futures", side: "buy", quantity: 25, price: 24000 }).stt, 0);
  });

  it("options sell: STT 0.15% of premium, rounded to the rupee", () => {
    const b = charge({ segment: "options", side: "sell", quantity: 25, price: 186.4 });
    assert.equal(b.turnover, 4660);
    assert.equal(b.stt, 7); // 6.99 -> 7
    assert.equal(b.exchangeCharges, 1.66);
    assert.equal(b.sebi, 0); // 0.00466 rounds to nothing
    assert.equal(b.total, 32.56);
  });

  it("options buy: stamp duty 0.003% of premium, no STT", () => {
    const b = charge({ segment: "options", side: "buy", quantity: 25, price: 186.4 });
    assert.equal(b.stt, 0);
    assert.equal(b.stampDuty, 0.14);
    assert.equal(b.total, 25.7);
  });
});

describe("exchanges and profiles", () => {
  it("BSE uses its own rate and the flat-fee profile charges no delivery brokerage", () => {
    const b = charge({ exchange: "BSE", quantity: 12, price: 5000, profileId: "discount-flat" });
    assert.equal(b.turnover, 60000);
    assert.equal(b.brokerage, 0);
    assert.equal(b.exchangeCharges, 2.25); // 0.00375%
    assert.equal(b.stampDuty, 9);
    assert.equal(b.stt, 60);
    assert.equal(b.gst, 0.42);
    assert.equal(b.total, 71.73);
  });

  it("NSE and BSE differ on the same equity trade", () => {
    assert.notEqual(calculateExchangeCharges("NSE", "equityDelivery", 100000, "2026-10-05").amount, calculateExchangeCharges("BSE", "equityDelivery", 100000, "2026-10-05").amount);
  });

  it("brokerage rules: percentage, cap, minimum, flat, free", () => {
    assert.equal(calculateBrokerage(100000, { pct: 0.2 }), 200);
    assert.equal(calculateBrokerage(100000, { pct: 0.03, cap: 20 }), 20);
    assert.equal(calculateBrokerage(1000, { pct: 0.5, min: 20 }), 20);
    assert.equal(calculateBrokerage(100000, { pct: 0.5, min: 20 }), 500);
    assert.equal(calculateBrokerage(5000, { flat: 20 }), 20);
    assert.equal(calculateBrokerage(5000, { flat: 0 }), 0);
    assert.equal(calculateBrokerage(0, { flat: 20 }), 0);
  });

  it("a profile change changes brokerage and nothing statutory", () => {
    const a = charge({ profileId: "default-simulator" });
    const f = charge({ profileId: "discount-flat" });
    assert.equal(f.brokerage, 0);
    assert.equal(a.stt, f.stt);
    assert.equal(a.stampDuty, f.stampDuty);
    assert.equal(a.exchangeCharges, f.exchangeCharges);
  });

  it("describes a rule the way a contract note would", () => {
    assert.equal(brokerageRuleText({ pct: 0.2 }), "0.2%");
    assert.equal(brokerageRuleText({ pct: 0.03, cap: 20 }), "0.03% (max ₹20)");
    assert.equal(brokerageRuleText({ flat: 20 }), "₹20 per order");
    assert.equal(brokerageRuleText({ flat: 0 }), "Free");
  });
});

describe("single components", () => {
  it("STT is rounded to the nearest rupee", () => {
    assert.equal(calculateSTT("equityDelivery", "buy", 4000, "2026-10-05").amount, 4);
    assert.equal(calculateSTT("equityDelivery", "buy", 1234, "2026-10-05").amount, 1);
    assert.equal(calculateSTT("equityDelivery", "buy", 1600, "2026-10-05").amount, 2);
  });

  it("stamp duty depends on segment and side", () => {
    assert.equal(calculateStampDuty("equityDelivery", "buy", 100000, "2026-10-05").amount, 15);
    assert.equal(calculateStampDuty("equityIntraday", "buy", 100000, "2026-10-05").amount, 3);
    assert.equal(calculateStampDuty("futures", "buy", 100000, "2026-10-05").amount, 2);
    assert.equal(calculateStampDuty("options", "buy", 100000, "2026-10-05").amount, 3);
    assert.equal(calculateStampDuty("equityDelivery", "sell", 100000, "2026-10-05").amount, 0);
  });

  it("SEBI fee is Rs 10 per crore and GST is 18% of the taxable charges", () => {
    assert.equal(calculateSEBICharges(10_000_000, "2026-10-05").amount, 10);
    assert.equal(calculateGST(1000, "2026-10-05").amount, 180);
    assert.equal(calculateGST(0, "2026-10-05").amount, 0);
  });

  it("a rate follows the trade date, not today's date", () => {
    assert.equal(rateOn(CHARGES.futures.stt.sell, "2026-03-31"), 0.02);
    assert.equal(rateOn(CHARGES.futures.stt.sell, "2026-04-01"), 0.05);
    assert.equal(rateOn(CHARGES.options.stt.sell, "2026-03-31"), 0.1);
    assert.equal(rateOn(CHARGES.options.stt.sell, "2026-04-01"), 0.15);
  });

  it("the NSE revision of 1 Mar 2026 moves the parts but not the total", () => {
    const before = calculateExchangeCharges("NSE", "equityDelivery", 100000, "2026-02-27");
    const after = calculateExchangeCharges("NSE", "equityDelivery", 100000, "2026-03-02");
    assert.equal(before.amount, after.amount);
    assert.notEqual(before.parts?.transaction, after.parts?.transaction);
  });

  it("a ledger can be summed line by line", () => {
    const total = sumBreakdowns([charge({}), charge({ side: "sell" })]);
    assert.equal(total.total, 709.82);
    assert.equal(total.stt, 200);
    assert.equal(total.deductible, 509.82);
  });
});

describe("which schedule an instrument gets", () => {
  const nse = (symbol: string, assetClass: string, exchange = "NSE") => ({ symbol, assetClass, exchange }) as never;

  it("shares and ETFs follow the product; F&O follow their own segment", () => {
    const t1 = chargeTarget(nse("TCS", "stock"), "delivery");
    const t2 = chargeTarget(nse("TCS", "stock"), "intraday");
    assert.ok(t1.modelled && t1.segment === "equityDelivery");
    assert.ok(t2.modelled && t2.segment === "equityIntraday");
    const fut = chargeTarget(nse("NIFTYFUT", "future", "NFO"), "delivery");
    assert.ok(fut.modelled && fut.segment === "futures" && fut.exchange === "NSE");
    const opt = chargeTarget(nse("NIFTY24800CE", "option", "NFO"), "intraday");
    assert.ok(opt.modelled && opt.segment === "options");
  });

  it("an index is charged as a future and says so; BSE stays BSE", () => {
    const idx = chargeTarget(nse("SENSEX", "index", "BSE"), "delivery");
    assert.ok(idx.modelled && idx.segment === "futures" && idx.exchange === "BSE" && idx.note);
  });

  it("commodities, currencies, crypto and foreign indices have no modelled schedule", () => {
    for (const [sym, cls, ex] of [["GOLD", "commodity", "MCX"], ["USDINR", "forex", "FX"], ["BTCUSD", "crypto", "CRYPTO"], ["SPX", "index", "GLOBAL"]] as const) {
      const t = chargeTarget(nse(sym, cls, ex), "delivery");
      assert.equal(t.modelled, false, sym);
    }
  });

  it("tax treatment: shares are capital gains, intraday and F&O are business income", () => {
    const share = { symbol: "TCS", name: "Tata Consultancy Services", assetClass: "stock", exchange: "NSE" } as never;
    assert.equal(taxTreatment(share, "delivery").kind, "capital_gains");
    assert.equal(taxTreatment(share, "intraday").kind, "business_income");
    assert.equal(taxTreatment({ symbol: "NIFTYFUT", name: "NIFTY 50 Fut", assetClass: "future", exchange: "NFO" } as never, "delivery").kind, "business_income");
    const nifty = taxTreatment({ symbol: "NIFTYBEES", name: "Nippon India ETF Nifty BeES", assetClass: "etf", exchange: "NSE" } as never, "delivery");
    assert.ok(nifty.kind === "capital_gains" && nifty.taxClass === "equity");
    const gold = taxTreatment({ symbol: "GOLDBEES", name: "Nippon India ETF Gold BeES", assetClass: "etf", exchange: "NSE" } as never, "delivery");
    assert.ok(gold.kind === "capital_gains" && gold.taxClass === "other");
  });
});

describe("financial years and the configuration", () => {
  it("assigns the financial year of a date", () => {
    assert.equal(financialYearOf("2026-03-31"), "FY2025-26");
    assert.equal(financialYearOf("2026-04-01"), "FY2026-27");
    assert.equal(financialYearOf("2027-01-15"), "FY2026-27");
    assert.deepEqual(fyBounds("FY2026-27"), { start: "2026-04-01", end: "2027-03-31" });
  });

  it("adds months clamped to the month end", () => {
    assert.equal(addMonths("2025-08-31", 6), "2026-02-28");
    assert.equal(addMonths("2025-01-10", 12), "2026-01-10");
  });

  it("carries the latest year forward and says so; refuses a year with changed rates", () => {
    const next = rulesFor("FY2027-28");
    assert.ok(next && next.assumed && next.note);
    assert.equal(next!.equity.ltcgRatePct, rulesFor("FY2026-27")!.equity.ltcgRatePct);
    assert.equal(rulesFor("FY2027-28", { carryForward: false }), null);
    assert.equal(rulesFor("FY2024-25"), null);
  });

  it("the frontend mirror of the rules is identical to the backend files", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const backend = path.resolve(here, "..", "..", "..", "backend", "regulatory");
    if (!existsSync(backend)) return; // a build that ships only the frontend
    for (const f of ["charges.json", "tax_rules.json", "tax_vectors.json"]) {
      assert.equal(readFileSync(path.join(here, "..", "regulatory", f), "utf8"), readFileSync(path.join(backend, f), "utf8"), `${f} drifted: run npm run sync:regulatory`);
    }
  });
});
