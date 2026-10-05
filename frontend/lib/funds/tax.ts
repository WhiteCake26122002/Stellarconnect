/**
 * Indicative capital-gains treatment for Indian mutual fund units, from the AMFI category label.
 * Rules are those in force for transfers on or after 23 Jul 2024 (Finance (No. 2) Act 2024). The
 * real treatment turns on the scheme's actual equity / debt share, which the API does not expose,
 * so every result says how sure the label lets us be. Not tax advice.
 */

import { DAY } from "./analytics";

export type TaxClass = "equity" | "debt" | "other" | "unknown";

export type TaxRule = {
  cls: TaxClass;
  label: string;
  /** Months held beyond which gains are long-term; null when every gain is taxed at slab. */
  ltMonths: number | null;
  shortTerm: string;
  longTerm: string;
  /** Flat rates where the law sets one; null means "your income-tax slab". */
  stRate: number | null;
  ltRate: number | null;
  /** "category" when the AMFI label settles it, "depends" when the scheme's mix could change it. */
  certainty: "category" | "depends";
  note: string;
};

export const LTCG_EXEMPTION = 125_000;
const SPECIFIED_CUTOFF = "2023-04-01";

const EQUITY: TaxRule = {
  cls: "equity",
  label: "Equity-oriented",
  ltMonths: 12,
  shortTerm: "20% if sold within 12 months",
  longTerm: `12.5% on gains above ₹1.25 lakh a year after 12 months`,
  stRate: 0.2,
  ltRate: 0.125,
  certainty: "category",
  note: "At least 65% in Indian equity, so equity rates apply.",
};

const DEBT: TaxRule = {
  cls: "debt",
  label: "Debt (specified fund)",
  ltMonths: null,
  shortTerm: "Taxed at your income-tax slab",
  longTerm: "No long-term rate for units bought on or after 1 Apr 2023",
  stRate: null,
  ltRate: null,
  certainty: "category",
  note: "More than 65% in debt and money-market instruments. Units bought before 1 Apr 2023 and held over 24 months get 12.5% instead.",
};

const OTHER: TaxRule = {
  cls: "other",
  label: "Neither equity nor debt",
  ltMonths: 24,
  shortTerm: "Your slab rate if sold within 24 months",
  longTerm: "12.5% after 24 months, no indexation",
  stRate: null,
  ltRate: 0.125,
  certainty: "depends",
  note: "Funds between the equity and debt thresholds (gold, international, many multi-asset and fund-of-funds).",
};

const UNKNOWN: TaxRule = {
  cls: "unknown",
  label: "Depends on the scheme",
  ltMonths: null,
  shortTerm: "Depends on the scheme's equity share",
  longTerm: "Check the scheme information document",
  stRate: null,
  ltRate: null,
  certainty: "depends",
  note: "The AMFI category does not say enough to tell which rules apply.",
};

const DEBT_WORDS = ["debt scheme", "liquid", "overnight", "money market", "gilt", "duration", "credit risk", "corporate bond", "banking and psu", "floater", "dynamic bond", "conservative hybrid"];
const DEBT_INDEX_WORDS = ["gilt", "bond", "sdl", "debt", "g-sec", "gsec", "psu", "liquid", "crisil ibx", "money market"];
const EQUITY_WORDS = ["equity scheme", "elss", "arbitrage", "equity savings", "aggressive hybrid"];
const OTHER_WORDS = ["gold", "silver", "overseas", "fof", "fund of funds", "multi asset"];

export function taxRule(category: string | null | undefined, schemeName = ""): TaxRule {
  const c = (category || "").toLowerCase();
  const n = schemeName.toLowerCase();
  if (!c || c === "unknown") return UNKNOWN;
  if (c.includes("index") || c.includes("etf")) {
    if (n.includes("gold") || n.includes("silver")) return OTHER;
    if (DEBT_INDEX_WORDS.some((w) => n.includes(w))) return DEBT;
    return EQUITY;
  }
  if (c.includes("balanced advantage") || c.includes("dynamic asset allocation")) {
    return { ...EQUITY, certainty: "depends", note: "Most balanced-advantage funds hedge with arbitrage to stay above 65% gross equity, but the scheme decides." };
  }
  if (OTHER_WORDS.some((w) => c.includes(w) || n.includes(w))) return OTHER;
  if (EQUITY_WORDS.some((w) => c.includes(w))) return EQUITY;
  if (DEBT_WORDS.some((w) => c.includes(w))) return DEBT;
  if (c.includes("solution oriented") || c.includes("retirement") || c.includes("children")) return UNKNOWN;
  return UNKNOWN;
}

function addMonths(t: number, months: number): number {
  const d = new Date(t);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d.getTime();
}

export type HoldingTax = {
  rule: TaxRule;
  term: "short" | "long" | "slab";
  heldDays: number;
  /** When the holding turns long-term, if it has not yet. */
  longTermOn: number | null;
  daysToLong: number | null;
  /** Rough tax on today's gain at the flat rate; null at slab or on a loss. */
  estTax: number | null;
  estBasis: string;
};

export function holdingTax(opts: { category: string; name: string; purchaseDate: string; gain: number | null; now?: number }): HoldingTax {
  const rule = taxRule(opts.category, opts.name);
  const now = opts.now ?? Date.now();
  const bought = new Date(`${opts.purchaseDate}T00:00:00`).getTime();
  const heldDays = Math.max(0, Math.floor((now - bought) / DAY));
  let effective = rule;
  if (rule.cls === "debt" && opts.purchaseDate < SPECIFIED_CUTOFF) {
    effective = { ...rule, ltMonths: 24, ltRate: 0.125, longTerm: "12.5% after 24 months (bought before 1 Apr 2023)" };
  }
  if (effective.ltMonths == null) {
    return { rule: effective, term: "slab", heldDays, longTermOn: null, daysToLong: null, estTax: null, estBasis: "Taxed at your slab rate, so no flat estimate." };
  }
  const longOn = addMonths(bought, effective.ltMonths);
  const isLong = now > longOn;
  const gain = opts.gain ?? 0;
  let estTax: number | null = null;
  let estBasis = "No tax on a loss. Short-term losses can offset any capital gain; long-term losses only long-term gains.";
  if (gain > 0) {
    if (isLong && effective.ltRate != null) {
      const taxable = effective.cls === "equity" ? Math.max(0, gain - LTCG_EXEMPTION) : gain;
      estTax = taxable * effective.ltRate;
      estBasis =
        effective.cls === "equity"
          ? `12.5% on the part above ₹1.25 lakh, assuming no other equity gains this financial year. Plus surcharge and 4% cess.`
          : "12.5% on the whole gain. Plus surcharge and 4% cess.";
    } else if (!isLong && effective.stRate != null) {
      estTax = gain * effective.stRate;
      estBasis = "20% on the whole gain. Plus surcharge and 4% cess.";
    } else {
      estBasis = "Taxed at your slab rate, so no flat estimate.";
    }
  }
  return {
    rule: effective,
    term: isLong ? "long" : "short",
    heldDays,
    longTermOn: isLong ? null : longOn,
    daysToLong: isLong ? null : Math.ceil((longOn - now) / DAY),
    estTax,
    estBasis,
  };
}
