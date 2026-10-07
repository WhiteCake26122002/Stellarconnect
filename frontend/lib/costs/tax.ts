/**
 * Capital-gains tax estimate for one financial year.
 *
 * Input is a list of realised gains, each already classified into a tax bucket and measured after
 * the deductible charges. Output is an ESTIMATE with its own confidence and a plain statement of
 * what it left out. Rates, thresholds and surcharge bands all come from the versioned rules in
 * rules.ts; nothing here is a rate.
 *
 * Buckets:
 *   stcg111A  equity shares and equity-oriented funds held up to the threshold (20%)
 *   ltcg112A  the same held longer: 12.5% on the net gain above the annual exemption (Rs 1.25 lakh)
 *   stcgSlab  short-term gains on other assets: taxed at the investor's slab rate
 *   ltcg112   long-term gains on other assets: 12.5%, no exemption
 *
 * Loss set-off is applied only inside a class (equity with equity, other with other) and only the
 * way the law allows: a short-term loss can absorb short- and long-term gains, a long-term loss only
 * long-term gains. Carry-forward, set-off against other income and across classes are not applied,
 * and the estimate says so whenever it matters.
 */
import { TAX_RULES, fyLabel, roundPaise, rulesFor, unsupportedReason, type Day, type RuleSet, type SurchargeBand } from "./rules";
import type { HoldingTerm } from "./lots";

export type GainBucket = "stcg111A" | "ltcg112A" | "stcgSlab" | "ltcg112";

export const BUCKET_LABEL: Record<GainBucket, string> = {
  stcg111A: "Short-term (equity)",
  ltcg112A: "Long-term (equity)",
  stcgSlab: "Short-term (slab rate)",
  ltcg112: "Long-term (other assets)",
};

export type TaxItem = {
  id: string;
  label: string;
  symbol?: string;
  bucket: GainBucket;
  /** The capital gain for tax: price move less deductible charges. Negative for a loss. */
  gain: number;
  term: HoldingTerm;
  heldDays: number;
  heldText: string;
  openedOn: Day;
  closedOn: Day;
};

export type TaxProfile = {
  /** Marginal slab rate in percent, for gains taxed at slab. Null when the user has not said. */
  slabRatePct: number | null;
  /** Key of tax_rules.json surcharge.bands. Null when the user has not said. */
  incomeBand: string | null;
  regime: "new" | "old";
};

export const EMPTY_TAX_PROFILE: TaxProfile = { slabRatePct: null, incomeBand: null, regime: "new" };

export function incomeBands(): { id: string; label: string }[] {
  return Object.entries(TAX_RULES.surcharge.bands).map(([id, b]) => ({ id, label: b.label }));
}

export type BucketResult = {
  bucket: GainBucket;
  label: string;
  ratePct: number | null;
  /** Sum of the gains in the bucket (losses excluded). */
  gains: number;
  /** Sum of the losses in the bucket, as a negative number. */
  losses: number;
  /** Gains plus losses before any set-off between buckets. */
  net: number;
  /** Loss from the paired short-term bucket absorbed here (long-term buckets only), positive. */
  setOffAbsorbed: number;
  /** Net after set-off. May be negative: an unabsorbed loss. */
  netAfterSetOff: number;
  exemption: number;
  taxable: number;
  /** Tax before surcharge and cess; null when it depends on a slab rate that is not known. */
  tax: number | null;
};

export type TaxEstimate = {
  supported: boolean;
  reason: string | null;
  fy: string;
  fyLabel: string;
  rules: { sourceFy: string; assumed: boolean; note: string | null; legalBasis: string } | null;
  buckets: Record<GainBucket, BucketResult>;
  /** Net short- and long-term gains after set-off, floored at zero. */
  stcg: number;
  ltcg: number;
  /** Everything realised in the year, net, before set-off. */
  realizedNet: number;
  exemptionLimit: number;
  exemptionApplied: number;
  /** Section 112A gain still under the annual exemption: exemptionLimit - exemptionApplied. */
  exemptionRoom: number;
  taxBeforeSurchargeCess: number;
  surcharge: number;
  cess: number;
  /** taxBeforeSurchargeCess plus surcharge and cess when the income band is known, else equal to it. */
  total: number;
  includesSurchargeCess: boolean;
  surchargePct: number | null;
  cessPct: number;
  /** Taxable gain at slab rate that could not be priced because no slab rate was given. */
  slabGainNotEstimated: number;
  unabsorbedLoss: { short: number; long: number };
  /** Each item's share of the tax (including its share of surcharge and cess). */
  perItem: Record<string, number>;
  headline: string;
  notes: string[];
};

const BUCKETS: GainBucket[] = ["stcg111A", "ltcg112A", "stcgSlab", "ltcg112"];

function emptyBucket(bucket: GainBucket, ratePct: number | null): BucketResult {
  return { bucket, label: BUCKET_LABEL[bucket], ratePct, gains: 0, losses: 0, net: 0, setOffAbsorbed: 0, netAfterSetOff: 0, exemption: 0, taxable: 0, tax: 0 };
}

/** A short-term loss absorbs short- and then long-term gains; a long-term loss absorbs long-term gains only. */
export function setOffWithinClass(shortNet: number, longNet: number): { shortAfter: number; longAfter: number; absorbedByLong: number } {
  if (shortNet < 0 && longNet > 0) {
    const absorbed = Math.min(-shortNet, longNet);
    return { shortAfter: shortNet + absorbed, longAfter: longNet - absorbed, absorbedByLong: absorbed };
  }
  return { shortAfter: shortNet, longAfter: longNet, absorbedByLong: 0 };
}

/** Net short-term position (equity and slab) after set-off, with the tax each part carries. */
export function calculateSTCG(
  shortEquityNet: number,
  shortSlabNet: number,
  rules: RuleSet,
  profile: TaxProfile,
): { equity: { taxable: number; ratePct: number; tax: number }; slab: { taxable: number; ratePct: number | null; tax: number | null } } {
  const eqTaxable = Math.max(0, shortEquityNet);
  const slabTaxable = Math.max(0, shortSlabNet);
  const slabKnown = profile.slabRatePct != null;
  return {
    equity: { taxable: eqTaxable, ratePct: rules.equity.stcgRatePct, tax: roundPaise((eqTaxable * rules.equity.stcgRatePct) / 100) },
    slab: {
      taxable: slabTaxable,
      ratePct: profile.slabRatePct,
      tax: slabTaxable === 0 ? 0 : slabKnown ? roundPaise((slabTaxable * (profile.slabRatePct as number)) / 100) : null,
    },
  };
}

/** Net long-term position after set-off. The Section 112A exemption applies once, to the equity total for the year. */
export function calculateLTCG(
  longEquityNet: number,
  longOtherNet: number,
  rules: RuleSet,
): {
  equity: { net: number; exemption: number; taxable: number; ratePct: number; tax: number };
  other: { net: number; taxable: number; ratePct: number; tax: number };
} {
  const eqNet = Math.max(0, longEquityNet);
  const exemption = Math.min(rules.equity.ltcgExemption, eqNet);
  const eqTaxable = eqNet - exemption;
  const otherTaxable = Math.max(0, longOtherNet) - Math.min(rules.other.ltcgExemption, Math.max(0, longOtherNet));
  return {
    equity: { net: eqNet, exemption, taxable: eqTaxable, ratePct: rules.equity.ltcgRatePct, tax: roundPaise((eqTaxable * rules.equity.ltcgRatePct) / 100) },
    other: { net: Math.max(0, longOtherNet), taxable: otherTaxable, ratePct: rules.other.ltcgRatePct, tax: roundPaise((otherTaxable * rules.other.ltcgRatePct) / 100) },
  };
}

function surchargeFor(band: SurchargeBand, regime: "new" | "old"): { normalPct: number; cappedPct: number } {
  const normal = band.normalPct ?? (regime === "new" ? band.normalPctNewRegime : band.normalPctOldRegime) ?? 0;
  return { normalPct: normal, cappedPct: band.cappedGainsPct };
}

export function emptyEstimate(fy: string, reason: string): TaxEstimate {
  const zero = (b: GainBucket) => emptyBucket(b, null);
  return {
    supported: false,
    reason,
    fy,
    fyLabel: fyLabel(fy),
    rules: null,
    buckets: { stcg111A: zero("stcg111A"), ltcg112A: zero("ltcg112A"), stcgSlab: zero("stcgSlab"), ltcg112: zero("ltcg112") },
    stcg: 0,
    ltcg: 0,
    realizedNet: 0,
    exemptionLimit: 0,
    exemptionApplied: 0,
    exemptionRoom: 0,
    taxBeforeSurchargeCess: 0,
    surcharge: 0,
    cess: 0,
    total: 0,
    includesSurchargeCess: false,
    surchargePct: null,
    cessPct: 0,
    slabGainNotEstimated: 0,
    unabsorbedLoss: { short: 0, long: 0 },
    perItem: {},
    headline: "Not estimated",
    notes: [reason],
  };
}

/**
 * The tax estimate for one financial year. `items` are the realised gains of that year only.
 */
export function calculateEstimatedTax(input: { fy: string; items: TaxItem[]; profile?: TaxProfile | null }): TaxEstimate {
  const { fy } = input;
  const profile = input.profile ?? EMPTY_TAX_PROFILE;
  const rules = rulesFor(fy);
  if (!rules) return emptyEstimate(fy, unsupportedReason(fy) ?? `No tax rules are configured for ${fyLabel(fy)}.`);

  const b = {} as Record<GainBucket, BucketResult>;
  for (const k of BUCKETS) b[k] = emptyBucket(k, null);
  for (const it of input.items) {
    const r = b[it.bucket];
    if (it.gain >= 0) r.gains += it.gain;
    else r.losses += it.gain;
  }
  for (const k of BUCKETS) {
    b[k].gains = roundPaise(b[k].gains);
    b[k].losses = roundPaise(b[k].losses);
    b[k].net = roundPaise(b[k].gains + b[k].losses);
  }

  const eq = setOffWithinClass(b.stcg111A.net, b.ltcg112A.net);
  const ot = setOffWithinClass(b.stcgSlab.net, b.ltcg112.net);
  b.stcg111A.netAfterSetOff = roundPaise(eq.shortAfter);
  b.ltcg112A.netAfterSetOff = roundPaise(eq.longAfter);
  b.ltcg112A.setOffAbsorbed = roundPaise(eq.absorbedByLong);
  b.stcgSlab.netAfterSetOff = roundPaise(ot.shortAfter);
  b.ltcg112.netAfterSetOff = roundPaise(ot.longAfter);
  b.ltcg112.setOffAbsorbed = roundPaise(ot.absorbedByLong);

  const st = calculateSTCG(b.stcg111A.netAfterSetOff, b.stcgSlab.netAfterSetOff, rules, profile);
  const lt = calculateLTCG(b.ltcg112A.netAfterSetOff, b.ltcg112.netAfterSetOff, rules);

  b.stcg111A.ratePct = st.equity.ratePct;
  b.stcg111A.taxable = st.equity.taxable;
  b.stcg111A.tax = st.equity.tax;
  b.stcgSlab.ratePct = st.slab.ratePct;
  b.stcgSlab.taxable = st.slab.taxable;
  b.stcgSlab.tax = st.slab.tax;
  b.ltcg112A.ratePct = lt.equity.ratePct;
  b.ltcg112A.exemption = lt.equity.exemption;
  b.ltcg112A.taxable = lt.equity.taxable;
  b.ltcg112A.tax = lt.equity.tax;
  b.ltcg112.ratePct = lt.other.ratePct;
  b.ltcg112.taxable = lt.other.taxable;
  b.ltcg112.tax = lt.other.tax;

  const taxBefore = roundPaise((b.stcg111A.tax ?? 0) + (b.ltcg112A.tax ?? 0) + (b.stcgSlab.tax ?? 0) + (b.ltcg112.tax ?? 0));
  const slabGainNotEstimated = b.stcgSlab.tax == null ? b.stcgSlab.taxable : 0;

  // Surcharge and cess only when the income band is known; otherwise the figure is stated as "before" them.
  const band = profile.incomeBand ? TAX_RULES.surcharge.bands[profile.incomeBand] : undefined;
  let surcharge = 0;
  let cess = 0;
  let surchargePct: number | null = null;
  if (band) {
    const { normalPct, cappedPct } = surchargeFor(band, profile.regime);
    surcharge = roundPaise(
      (((b.stcg111A.tax ?? 0) + (b.ltcg112A.tax ?? 0) + (b.ltcg112.tax ?? 0)) * cappedPct) / 100 + ((b.stcgSlab.tax ?? 0) * normalPct) / 100,
    );
    cess = roundPaise(((taxBefore + surcharge) * rules.cessPct) / 100);
    surchargePct = cappedPct;
  }
  const total = roundPaise(taxBefore + surcharge + cess);

  // Each item's share: its bucket's tax (with that bucket's surcharge and cess) spread over the bucket's positive gains.
  const perItem: Record<string, number> = {};
  for (const k of BUCKETS) {
    const positive = input.items.filter((i) => i.bucket === k && i.gain > 0);
    const sum = positive.reduce((s, i) => s + i.gain, 0);
    const bucketTax = b[k].tax ?? 0;
    const bucketSurcharge = band
      ? (bucketTax * (k === "stcgSlab" ? surchargeFor(band, profile.regime).normalPct : surchargeFor(band, profile.regime).cappedPct)) / 100
      : 0;
    const bucketTotal = band ? (bucketTax + bucketSurcharge) * (1 + rules.cessPct / 100) : bucketTax;
    for (const i of input.items.filter((x) => x.bucket === k)) perItem[i.id] = 0;
    if (sum > 0) for (const i of positive) perItem[i.id] = roundPaise((bucketTotal * i.gain) / sum);
  }

  const unabsorbed = {
    short: roundPaise(Math.min(0, b.stcg111A.netAfterSetOff) + Math.min(0, b.stcgSlab.netAfterSetOff)),
    long: roundPaise(Math.min(0, b.ltcg112A.netAfterSetOff) + Math.min(0, b.ltcg112.netAfterSetOff)),
  };

  const notes: string[] = [];
  if (rules.assumed && rules.note) notes.push(rules.note);
  if (band) notes.push(`Surcharge (${surchargePct}% on equity and other flat-rate gains, the most the law allows on them) and ${rules.cessPct}% cess are included.`);
  else notes.push("Surcharge and cess are not included: they depend on your total income, which has not been set.");
  if (slabGainNotEstimated > 0) notes.push("Some gains are taxed at your slab rate; set a slab rate to price them.");
  if (input.items.some((i) => i.gain < 0) || unabsorbed.short < 0 || unabsorbed.long < 0) {
    notes.push("Advanced tax-loss adjustment requires additional tax information.");
  }
  notes.push("Other income, the basic-exemption adjustment, carried-forward losses and set-off across asset classes are not applied.");

  return {
    supported: true,
    reason: null,
    fy,
    fyLabel: fyLabel(fy),
    rules: { sourceFy: rules.sourceFy, assumed: rules.assumed, note: rules.note, legalBasis: rules.legalBasis },
    buckets: b,
    stcg: roundPaise(Math.max(0, b.stcg111A.netAfterSetOff) + Math.max(0, b.stcgSlab.netAfterSetOff)),
    ltcg: roundPaise(Math.max(0, b.ltcg112A.netAfterSetOff) + Math.max(0, b.ltcg112.netAfterSetOff)),
    realizedNet: roundPaise(BUCKETS.reduce((s, k) => s + b[k].net, 0)),
    exemptionLimit: rules.equity.ltcgExemption,
    exemptionApplied: lt.equity.exemption,
    exemptionRoom: roundPaise(Math.max(0, rules.equity.ltcgExemption - lt.equity.exemption)),
    taxBeforeSurchargeCess: taxBefore,
    surcharge,
    cess,
    total,
    includesSurchargeCess: Boolean(band),
    surchargePct,
    cessPct: rules.cessPct,
    slabGainNotEstimated,
    unabsorbedLoss: unabsorbed,
    perItem,
    headline: band ? `Estimated tax including surcharge and ${rules.cessPct}% cess` : "Estimated tax before surcharge and cess",
    notes,
  };
}

// --- confidence -------------------------------------------------------------------------------

export type ConfidenceLevel = "high" | "estimated" | "incomplete";

export type Confidence = {
  level: ConfidenceLevel;
  label: string;
  /** Share of the history (by cost) that has a real date and a settled classification. */
  coveragePct: number;
  reasons: string[];
  /** 'Based on 92% of available transaction history.' */
  basis: string;
};

/**
 * High: every lot has a real date and a settled classification, the year's rules are configured and
 * the investor's tax profile is complete. Estimated: it needs an assumption. Incomplete: part of the
 * history has no usable date or classification, so the figure leaves it out.
 */
export function assessConfidence(input: {
  coveragePct: number;
  missing: string[];
  assumptions: string[];
}): Confidence {
  const coverage = Math.max(0, Math.min(100, input.coveragePct));
  const incomplete = input.missing.length > 0 || coverage < 100;
  const level: ConfidenceLevel = incomplete ? "incomplete" : input.assumptions.length > 0 ? "estimated" : "high";
  const label = { high: "High confidence", estimated: "Estimated", incomplete: "Incomplete" }[level];
  return {
    level,
    label,
    coveragePct: Math.round(coverage),
    reasons: [...input.missing, ...input.assumptions],
    basis: `Based on ${Math.round(coverage)}% of the available transaction history and the tax rules currently configured.`,
  };
}

/** Assumptions that follow from the profile and the year's rule set rather than from the lots. */
export function profileAssumptions(profile: TaxProfile, fy: string, hasSlabItems: boolean): string[] {
  const rules = rulesFor(fy);
  const out: string[] = [];
  if (!profile.incomeBand) out.push("Total income is not set, so surcharge and cess are left out.");
  if (hasSlabItems && profile.slabRatePct == null) out.push("A slab rate is not set, so slab-rate gains are not priced.");
  if (rules?.assumed && rules.note) out.push(rules.note);
  return out;
}
