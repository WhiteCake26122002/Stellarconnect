/**
 * Typed access to the central charge and tax configuration (lib/regulatory/*.json, a mirror of
 * backend/regulatory/*.json). This is the only module that reads those files; everything else
 * asks it for a dated rate or a financial year's rules. No rate is written anywhere else in the
 * frontend.
 */
import chargesJson from "../regulatory/charges.json" with { type: "json" };
import taxJson from "../regulatory/tax_rules.json" with { type: "json" };

export type RateEntry = { from: string; pct: number; parts?: Record<string, number>; note?: string };
export type Schedule = RateEntry[];

export type Segment = "equityDelivery" | "equityIntraday" | "futures" | "options";
export type ExchangeSegment = "equity" | "futures" | "options";
export type ChargeSide = "buy" | "sell";

export type BrokerageRule = { pct?: number; flat?: number; cap?: number; min?: number };
export type BrokerProfile = {
  label: string;
  description: string;
  equityDelivery: BrokerageRule;
  equityIntraday: BrokerageRule;
  futures: BrokerageRule;
  options: BrokerageRule;
  dpChargePerScripSell: number;
};

type SegmentConfig = {
  label: string;
  exchangeSegment: ExchangeSegment;
  stt: { buy: Schedule; sell: Schedule };
  note?: string;
};

export type ChargesConfig = {
  schemaVersion: number;
  reviewedOn: string;
  disclaimer: string;
  sources: { id: string; title: string; url: string }[];
  rounding: { default: "paise"; stt: "rupee" | "paise"; note: string };
  gst: { ratePct: Schedule; appliesTo: string[]; note: string };
  sebi: { ratePct: Schedule; note: string };
  exchangeCharges: Record<"NSE" | "BSE", Record<ExchangeSegment, Schedule>> & { note: string };
  stampDuty: Record<Segment, { buy: Schedule; sell: Schedule }> & { note: string };
  equityDelivery: SegmentConfig;
  equityIntraday: SegmentConfig;
  futures: SegmentConfig;
  options: SegmentConfig;
  mutualFunds: {
    stampDuty: { ratePct: Schedule; appliesTo: string[]; treatment: string; note: string };
    sttOnRedemption: { equityOriented: Schedule; other: Schedule; note: string };
    distributorTransactionCharge: { status: string; since: string; amount: number; note: string };
    expenseRatio: { treatment: string; note: string };
    exitLoad: { treatment: string; note: string };
  };
  instrumentMap: Record<string, string | string[]> & { unmodelled: string[]; unmodelledExchanges: string[] };
  brokerProfiles: { default: string; profiles: Record<string, BrokerProfile> };
};

export type SurchargeBand = {
  label: string;
  normalPct?: number;
  normalPctNewRegime?: number;
  normalPctOldRegime?: number;
  cappedGainsPct: number;
};

export type FyRules = {
  label: string;
  assessmentYear: string;
  legalBasis: string;
  cessPct: number;
  equity: { stcgRatePct: number; ltcgRatePct: number; ltcgExemption: number; holdingMonths: number; sections: { stcg: string; ltcg: string } };
  other: { holdingMonths: { listed: number; unlisted: number }; ltcgRatePct: number; ltcgExemption: number; stcgTaxedAtSlab: boolean; sections: { ltcg: string } };
  specifiedFund: { definition: string; deemedShortTermFrom: string; section: string };
  grandfathering: { cutoff: string; appliesTo: string; section: string };
};

export type TaxRulesConfig = {
  schemaVersion: number;
  reviewedOn: string;
  disclaimer: string;
  sources: { id: string; title: string; url: string }[];
  supportedFrom: string;
  unsupportedYears: Record<string, string>;
  surcharge: { note: string; bands: Record<string, SurchargeBand>; cappedGainsNote: string };
  financialYears: Record<string, FyRules>;
  securityClassification: {
    note: string;
    otherEtfKeywords: string[];
    businessIncomeProducts: string[];
    businessIncomeAssetClasses: string[];
  };
};

export const CHARGES = chargesJson as unknown as ChargesConfig;
export const TAX_RULES = taxJson as unknown as TaxRulesConfig;

// --- dates ------------------------------------------------------------------------------------

/** A calendar day as 'YYYY-MM-DD'. Timestamps use the local calendar, as the user sees dates. */
export type Day = string;

export function dayOf(value: Day | number | Date): Day {
  if (typeof value === "string") return value.slice(0, 10);
  const d = typeof value === "number" ? new Date(value) : value;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function dayToUtc(day: Day): number {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function utcToDay(ms: number): Day {
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysBetween(from: Day, to: Day): number {
  return Math.round((dayToUtc(to) - dayToUtc(from)) / 86_400_000);
}

/** The same calendar day `months` later, clamped to the month's last day (31 Aug + 6 months = 28/29 Feb). */
export function addMonths(day: Day, months: number): Day {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return utcToDay(Date.UTC(ny, nm, Math.min(d, last)));
}

// --- dated rates ------------------------------------------------------------------------------

/** The entry in force on `day`; a date before the first entry gets the first (earliest known) entry. */
export function entryOn(schedule: Schedule, day: Day | number | Date): RateEntry {
  const target = dayOf(day);
  const ordered = [...schedule].sort((a, b) => (a.from < b.from ? -1 : 1));
  let chosen = ordered[0];
  for (const entry of ordered) if (entry.from <= target) chosen = entry;
  return chosen;
}

export function rateOn(schedule: Schedule, day: Day | number | Date): number {
  return entryOn(schedule, day).pct;
}

// --- financial years --------------------------------------------------------------------------

/** 'FY2026-27' for any date from 1 Apr 2026 to 31 Mar 2027. */
export function financialYearOf(value: Day | number | Date): string {
  const day = dayOf(value);
  const [y, m] = day.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `FY${start}-${String(start + 1).slice(-2)}`;
}

export const fyStartYear = (fy: string) => Number(fy.slice(2, 6));
export const fyLabel = (fy: string) => `FY ${fy.slice(2)}`;

export function fyBounds(fy: string): { start: Day; end: Day } {
  const y = fyStartYear(fy);
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}

export type RuleSet = FyRules & { fy: string; sourceFy: string; assumed: boolean; note: string | null };

/**
 * Rules for a financial year. An exact entry wins; a later year with no entry carries the latest
 * configured year forward and says so (`assumed`); a year before the supported range, or one listed
 * as unsupported, returns null.
 */
export function rulesFor(fy: string, opts: { carryForward?: boolean } = {}): RuleSet | null {
  const carry = opts.carryForward ?? true;
  if (fy in TAX_RULES.unsupportedYears) return null;
  const years = TAX_RULES.financialYears;
  if (years[fy]) return { ...years[fy], fy, sourceFy: fy, assumed: false, note: null };
  const latest = Object.keys(years).sort((a, b) => fyStartYear(a) - fyStartYear(b)).at(-1)!;
  if (fyStartYear(fy) > fyStartYear(latest) && carry) {
    return {
      ...years[latest],
      fy,
      sourceFy: latest,
      assumed: true,
      note: `${fyLabel(fy)} rules are not configured yet, so ${fyLabel(latest)} rates are carried forward as an assumption.`,
    };
  }
  return null;
}

export function unsupportedReason(fy: string): string | null {
  if (fy in TAX_RULES.unsupportedYears) return TAX_RULES.unsupportedYears[fy];
  if (fyStartYear(fy) < fyStartYear(TAX_RULES.supportedFrom)) return `Rules before ${fyLabel(TAX_RULES.supportedFrom)} are not configured.`;
  return null;
}

// --- rounding and formatting of rates ---------------------------------------------------------

export const roundPaise = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
export const roundRupee = (x: number) => Math.round(x + Number.EPSILON);

/** '0.2%', '0.00307%', '18%': enough decimals to show the rate, no trailing zeros. */
export function ratePctText(pct: number): string {
  return `${Number(pct.toFixed(7)).toString()}%`;
}
