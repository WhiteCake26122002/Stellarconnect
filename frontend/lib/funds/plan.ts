/**
 * Scenario arithmetic for the Plan tab. A projection is a function of assumptions, so the
 * assumptions are explicit, editable and labelled; none of them is a prediction and none is read off
 * a single recent return.
 */
import type { FundHolding } from "@/lib/api";
import { lumpsumProjection, sipProjection } from "./analytics";
import { assetKind, categoryRisk } from "./category";

export type ScenarioId = "conservative" | "base" | "optimistic";
export const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: "conservative", label: "Conservative", hint: "A lean stretch for markets" },
  { id: "base", label: "Base", hint: "A moderate long-run outcome" },
  { id: "optimistic", label: "Optimistic", hint: "A favourable stretch" },
];

export type AssetBucket = "equity" | "hybrid" | "debt";

/**
 * Planning assumptions by asset class, annual percent, [conservative, base, optimistic]. These are
 * round-number planning conventions, shown to the user and editable, not figures read from data.
 * The Plan tab sets them beside the index's measured 5Y and 10Y compounding for context.
 */
export const CLASS_ASSUMPTIONS: Record<AssetBucket, [number, number, number]> = {
  equity: [8, 11, 14],
  hybrid: [6.5, 9, 11.5],
  debt: [5, 6.5, 7.5],
};

export const DEFAULT_INFLATION = 6;

export type Mix = Record<AssetBucket, number>;

function bucketOf(h: FundHolding): AssetBucket {
  const kind = assetKind(h.scheme_category);
  if (kind === "equity") return "equity";
  if (kind === "debt") return "debt";
  if (kind === "index") return (categoryRisk(h.scheme_category, h.scheme_name) ?? 6) >= 6 ? "equity" : "debt";
  return "hybrid";
}

/** Value-weighted asset mix of the funds that have a live NAV (fractions summing to 1), or null if there are none. */
export function portfolioMix(holdings: readonly FundHolding[]): Mix | null {
  const live = holdings.filter((h) => h.data_available && h.value > 0);
  const total = live.reduce((a, h) => a + h.value, 0);
  if (total <= 0) return null;
  const mix: Mix = { equity: 0, hybrid: 0, debt: 0 };
  for (const h of live) mix[bucketOf(h)] += h.value / total;
  return mix;
}

/** The mix-weighted assumption for each scenario, rounded to 0.1. */
export function blendedRates(mix: Mix | null): [number, number, number] {
  const m = mix ?? { equity: 1, hybrid: 0, debt: 0 };
  return [0, 1, 2].map((i) => {
    const v = (Object.keys(m) as AssetBucket[]).reduce((a, k) => a + m[k] * CLASS_ASSUMPTIONS[k][i], 0);
    return Math.round(v * 10) / 10;
  }) as [number, number, number];
}

export type ScenarioResult = {
  rate: number;
  invested: number;
  /** Nominal rupees at the end. */
  value: number;
  /** The same corpus in today's purchasing power. */
  real: number;
  path: { year: number; invested: number; value: number; real: number }[];
};

/** Deflate a future amount by compounded inflation. */
export function inflationAdjusted(nominal: number, inflationPct: number, years: number): number {
  return years <= 0 ? nominal : nominal / (1 + inflationPct / 100) ** years;
}

export function project(
  mode: "sip" | "lumpsum",
  amount: number,
  years: number,
  ratePct: number,
  inflationPct: number,
): ScenarioResult {
  const base = mode === "sip" ? sipProjection(amount, ratePct / 100, years) : lumpsumProjection(amount, ratePct / 100, years);
  return {
    rate: ratePct,
    invested: base.invested,
    value: base.value,
    real: inflationAdjusted(base.value, inflationPct, years),
    path: base.path.map((p) => ({ year: p.year, invested: p.invested, value: p.value, real: inflationAdjusted(p.value, inflationPct, p.year) })),
  };
}
