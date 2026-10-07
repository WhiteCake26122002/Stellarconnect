/**
 * Plain-words explanations of the charges and taxes, written from the configuration so the text a
 * user reads can never disagree with the rate the engine used.
 */
import { CHARGES, TAX_RULES, fyLabel, ratePctText, rateOn, rulesFor, financialYearOf, type Day } from "./rules";

export const IMPORTANT =
  "Charges, taxes and returns shown in this simulator are estimates for educational purposes. Actual brokerage, exchange charges, statutory levies and tax liability may vary based on broker, exchange, transaction type, investor status, applicable tax rules and other circumstances.";
export const NOT_ADVICE = "Tax calculations are not tax advice. Consult a qualified tax professional for your individual tax position.";
export const HISTORY_BASIS =
  "Based on available transaction history and current applicable tax rules. Actual tax liability depends on your complete tax position and applicable regulations.";

export type Explainer = { title: string; body: string[] };

const MF = (TAX_RULES as unknown as { mutualFunds: { holdingMonths: { other: number } } }).mutualFunds;

const lakh = (x: number) => (x >= 100000 ? `₹${Number((x / 100000).toFixed(2))} lakh` : `₹${x.toLocaleString("en-IN")}`);

export function chargeExplainers(date: Day | number | Date = Date.now()): Explainer[] {
  const stt = (seg: "equityDelivery" | "equityIntraday" | "futures" | "options", side: "buy" | "sell") => ratePctText(rateOn(CHARGES[seg].stt[side], date));
  const stamp = (seg: "equityDelivery" | "equityIntraday" | "futures" | "options") => ratePctText(rateOn(CHARGES.stampDuty[seg].buy, date));
  const nse = (seg: "equity" | "futures" | "options") => ratePctText(rateOn(CHARGES.exchangeCharges.NSE[seg], date));
  return [
    {
      title: "Brokerage",
      body: [
        "Set by the broker profile you pick in Settings. Delivery, intraday, futures and options each have their own rule: a percentage of the trade, a flat fee per order, or a percentage with a cap or a minimum.",
        "Some brokers charge nothing on delivery; the Default Simulator profile does not assume that.",
      ],
    },
    {
      title: "STT/CTT",
      body: [
        `Equity delivery: ${stt("equityDelivery", "buy")} on the buy and ${stt("equityDelivery", "sell")} on the sell. Equity intraday: ${stt("equityIntraday", "sell")} on the sell only.`,
        `Futures: ${stt("futures", "sell")} on the sell. Options: ${stt("options", "sell")} of the premium on the sell. STT is rounded to the nearest rupee and cannot be deducted from a capital gain.`,
      ],
    },
    {
      title: "Exchange transaction charges and SEBI charges",
      body: [
        `NSE equity ${nse("equity")}, futures ${nse("futures")}, options ${nse("options")} (of premium), including the investor-protection contribution. BSE has its own rates.`,
        `SEBI turnover fee: ${ratePctText(rateOn(CHARGES.sebi.ratePct, date))} of turnover, which is Rs 10 per crore.`,
      ],
    },
    {
      title: "Stamp duty",
      body: [
        `Charged on the buy side only, and not at one rate: ${stamp("equityDelivery")} on equity delivery, ${stamp("equityIntraday")} on intraday, ${stamp("futures")} on futures and ${stamp("options")} on options.`,
      ],
    },
    {
      title: "GST",
      body: [
        `${ratePctText(rateOn(CHARGES.gst.ratePct, date))} on brokerage, exchange charges, SEBI fees and depository charges only. It is never charged on the trade value, on STT or on stamp duty.`,
      ],
    },
    {
      title: "Net values",
      body: [
        "A buy debits the trade value plus every charge. A sell credits the trade value less every charge. Charges flow into cash, average cost, realised P&L and returns; each is counted once.",
      ],
    },
  ];
}

export function taxExplainers(fy: string = financialYearOf(Date.now())): Explainer[] {
  const rules = rulesFor(fy);
  if (!rules) return [{ title: fyLabel(fy), body: ["Rules for this year are not configured, so no tax is estimated."] }];
  const eq = rules.equity;
  const cutoff = new Date(`${rules.specifiedFund.deemedShortTermFrom}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return [
    {
      title: `Equity and equity-oriented funds, ${fyLabel(fy)}`,
      body: [
        `Short-term (held up to ${eq.holdingMonths} months): ${eq.stcgRatePct}%. Long-term (held longer): ${eq.ltcgRatePct}% on the year's net gain above ${lakh(eq.ltcgExemption)}. The exemption applies once a financial year, not to each sale.`,
        `Each purchase is its own lot, sold oldest first, so one sale can be part long-term and part short-term. Basis: ${rules.legalBasis}.`,
        rules.assumed && rules.note ? rules.note : "Rates are read from the rules for this financial year, which are versioned so a change in law is a change in configuration.",
      ],
    },
    {
      title: "Surcharge and cess",
      body: [
        `${rules.cessPct}% cess applies on the tax and surcharge. Surcharge depends on your total income, which only you know, so it is included only after you set an income band; on equity gains it never exceeds the cap the law sets. Until then the figure is stated as before surcharge and cess.`,
      ],
    },
    {
      title: "Intraday trades and F&O",
      body: [TAX_RULES.securityClassification.note, "They are shown as business income and are not taxed as capital gains in the estimate."],
    },
    {
      title: "Mutual funds",
      body: [
        `The class comes first: equity-oriented, specified or other. Equity-oriented funds follow the equity rules above. Specified funds (mostly debt and money-market instruments) bought on or after ${cutoff} are short-term at your slab rate whatever the holding period. Other funds are short-term at your slab rate within ${MF.holdingMonths.other} months and flat-rate after, with no exemption.`,
        "Stamp duty is taken out of the amount invested, so it reduces the units allotted. STT is deducted on redemption of equity-oriented units. The expense ratio is already in the NAV and is never deducted again. Distributor transaction charges were discontinued by SEBI on 8 Aug 2025.",
      ],
    },
    {
      title: "Losses",
      body: [
        "Within a class, a short-term loss offsets short- and long-term gains and a long-term loss offsets long-term gains only. Carried-forward losses, other income and set-off across classes need your full tax position, so they are not applied: Advanced tax-loss adjustment requires additional tax information.",
      ],
    },
  ];
}

export function sources(): { id: string; title: string; url: string }[] {
  return [...CHARGES.sources, ...TAX_RULES.sources];
}
