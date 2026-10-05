/**
 * Read what we can off a scheme's AMFI category label and name. Everything here is a label-based
 * estimate: the API does not expose the scheme's SEBI riskometer, holdings, or plan metadata.
 */

export type RiskLevel = 1 | 2 | 3 | 4 | 5 | 6;

export const RISK_LABELS: Record<RiskLevel, string> = {
  1: "Low",
  2: "Low to Moderate",
  3: "Moderate",
  4: "Moderately High",
  5: "High",
  6: "Very High",
};

export const RISK_SHORT: Record<RiskLevel, string> = {
  1: "Low",
  2: "Low–Mod",
  3: "Moderate",
  4: "Mod–High",
  5: "High",
  6: "Very high",
};

const DEBT_INDEX_HINTS = ["gilt", "bond", "sdl", "debt", "g-sec", "gsec", "psu", "liquid", "crisil ibx", "money market"];

// Ordered: the first keyword found wins, so narrower labels sit above broader ones.
const RISK_RULES: [string, RiskLevel][] = [
  ["overnight", 1],
  ["arbitrage", 1],
  ["liquid", 2],
  ["money market", 2],
  ["ultra short", 2],
  ["low duration", 3],
  ["short duration", 3],
  ["floater", 3],
  ["banking and psu", 3],
  ["corporate bond", 3],
  ["gilt", 3],
  ["medium duration", 3],
  ["medium to long", 3],
  ["long duration", 3],
  ["dynamic bond", 3],
  ["credit risk", 4],
  ["conservative hybrid", 4],
  ["equity savings", 4],
  ["balanced advantage", 5],
  ["dynamic asset allocation", 5],
  ["multi asset", 5],
  ["gold", 5],
  ["aggressive hybrid", 6],
  ["overseas", 6],
  ["equity", 6],
  ["elss", 6],
];

/** Category-typical risk, or null when the label says too little (solution-oriented, "Other", unknown). */
export function categoryRisk(category: string | null | undefined, schemeName = ""): RiskLevel | null {
  const c = (category || "").toLowerCase();
  if (!c || c === "unknown") return null;
  if (c.includes("index") || c.includes("etf")) {
    const n = schemeName.toLowerCase();
    if (n.includes("gold") || n.includes("silver")) return 5;
    return DEBT_INDEX_HINTS.some((hint) => n.includes(hint)) ? 3 : 6;
  }
  for (const [keyword, level] of RISK_RULES) if (c.includes(keyword)) return level;
  return null;
}

// Must stay in step with ASSET_CLASS_KEYWORDS / MARKET_CAP_KEYWORDS in backend/mutual_funds/analysis.py
// so the X-ray matches the splits the analysis endpoint returns.
const ASSET_CLASS_KEYWORDS: [string, string][] = [
  ["equity", "Equity"],
  ["debt", "Debt"],
  ["hybrid", "Hybrid"],
  ["index", "Index/ETF"],
  ["etf", "Index/ETF"],
];

const MARKET_CAP_KEYWORDS: [string, string][] = [
  ["large & mid cap", "Large & Mid Cap"],
  ["large cap", "Large Cap"],
  ["mid cap", "Mid Cap"],
  ["small cap", "Small Cap"],
  ["multi cap", "Multi Cap"],
  ["flexi cap", "Flexi Cap"],
  ["elss", "ELSS (Tax Saver)"],
  ["focused", "Focused"],
  ["contra", "Value/Contra"],
  ["value", "Value/Contra"],
  ["dividend yield", "Dividend Yield"],
];

export function assetClass(category: string | null | undefined): string {
  const c = (category || "").toLowerCase();
  for (const [keyword, label] of ASSET_CLASS_KEYWORDS) if (c.includes(keyword)) return label;
  return "Other";
}

export type AssetKind = "equity" | "debt" | "hybrid" | "index" | "other";

const KIND_BY_CLASS: Record<string, AssetKind> = { Equity: "equity", Debt: "debt", Hybrid: "hybrid", "Index/ETF": "index" };

/** Icon / colour family for a category. Same buckets as assetClass so filters and icons agree. */
export function assetKind(category: string | null | undefined): AssetKind {
  return KIND_BY_CLASS[assetClass(category)] ?? "other";
}

export function marketCapBucket(category: string | null | undefined): string {
  const c = (category || "").toLowerCase();
  for (const [keyword, label] of MARKET_CAP_KEYWORDS) if (c.includes(keyword)) return label;
  return "Other Equity";
}

/** "Equity Scheme - Flexi Cap Fund" → "Flexi Cap". Falls back to the raw label. */
export function categoryShort(category: string | null | undefined): string {
  const raw = (category || "").trim();
  if (!raw || raw === "Unknown") return "Unknown category";
  const tail = raw.includes(" - ") ? raw.split(" - ").slice(1).join(" - ") : raw;
  return tail.replace(/\s+(fund|funds|scheme)$/i, "").trim() || raw;
}

export type PlanType = { plan: "Direct" | "Regular"; option: "Growth" | "IDCW" | null };

export function planType(schemeName: string): PlanType {
  const n = schemeName.toLowerCase();
  const option = /idcw|dividend|payout|reinvest/.test(n) ? "IDCW" : /growth/.test(n) ? "Growth" : null;
  return { plan: n.includes("direct") ? "Direct" : "Regular", option };
}

export function samePlan(a: string, b: string): boolean {
  const pa = planType(a);
  const pb = planType(b);
  return pa.plan === pb.plan && (pa.option == null || pb.option == null || pa.option === pb.option);
}
