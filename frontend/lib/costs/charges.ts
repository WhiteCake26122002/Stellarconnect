/**
 * Transaction-charge engine for simulated Indian equity, futures and options orders.
 *
 * Every number comes from the dated schedules in the central configuration (rules.ts) and the
 * selected broker profile. Nothing is a flat percentage of the trade value except where a schedule
 * says so: STT, stamp duty and exchange charges depend on segment, side and date; GST is charged
 * on brokerage, exchange charges, SEBI fees and depository charges only, never on the trade value.
 */
import {
  CHARGES,
  type BrokerProfile,
  type BrokerageRule,
  type ChargeSide,
  type Day,
  type ExchangeSegment,
  type Segment,
  dayOf,
  entryOn,
  ratePctText,
  rateOn,
  roundPaise,
  roundRupee,
} from "./rules";

export type { Segment, ChargeSide } from "./rules";
export type ExchangeName = "NSE" | "BSE";

export type ChargeKey = "brokerage" | "stt" | "exchange" | "sebi" | "stampDuty" | "gst" | "other";

export type ChargeLine = {
  key: ChargeKey;
  label: string;
  amount: number;
  /** The rate as a number of percent of the base (null for a flat fee). */
  ratePct: number | null;
  /** The rate as shown beside the amount: '0.1%', '₹20 per order', '0.03% (max ₹20)'. */
  rateText: string;
  /** Whether the amount reduces a capital gain. STT does not; every other charge does. */
  deductible: boolean;
};

export type ChargeBreakdown = {
  /** False when no Indian schedule is modelled for the instrument; every amount is then zero. */
  modelled: boolean;
  segment: Segment | null;
  exchange: ExchangeName | null;
  side: ChargeSide;
  quantity: number;
  price: number;
  /** Trade value: quantity x price (premium for options). */
  turnover: number;
  brokerage: number;
  stt: number;
  exchangeCharges: number;
  sebi: number;
  stampDuty: number;
  gst: number;
  other: number;
  total: number;
  /** The part of `total` that can reduce a capital gain: everything except STT. */
  deductible: number;
  /** The base GST was charged on. */
  gstBase: number;
  lines: ChargeLine[];
  profileId: string;
  profileLabel: string;
  notes: string[];
  /** Extra detail for the exchange line (transaction charge and IPFT parts). */
  exchangeParts: Record<string, number> | null;
};

export const ZERO_DEDUCTION = 0;

// --- profiles ---------------------------------------------------------------------------------

export function brokerProfile(id?: string | null): { id: string; profile: BrokerProfile } {
  const profiles = CHARGES.brokerProfiles.profiles;
  const key = id && profiles[id] ? id : CHARGES.brokerProfiles.default;
  return { id: key, profile: profiles[key] };
}

export function brokerProfileList(): { id: string; label: string; description: string }[] {
  return Object.entries(CHARGES.brokerProfiles.profiles).map(([id, p]) => ({ id, label: p.label, description: p.description }));
}

/** Layers the user's own brokerage numbers over the built-in 'custom' profile. */
export function withCustomBrokerage(edit: Partial<Pick<BrokerProfile, Segment | "dpChargePerScripSell">>): BrokerProfile {
  const base = CHARGES.brokerProfiles.profiles.custom;
  return { ...base, ...edit };
}

// --- the individual calculations --------------------------------------------------------------

function money(x: number): string {
  return `₹${Number(x.toFixed(2)).toLocaleString("en-US")}`;
}

export function brokerageRuleText(rule: BrokerageRule): string {
  if (rule.pct != null) {
    const parts = [ratePctText(rule.pct)];
    const bounds: string[] = [];
    if (rule.cap != null) bounds.push(`max ${money(rule.cap)}`);
    if (rule.min != null) bounds.push(`min ${money(rule.min)}`);
    return bounds.length ? `${parts[0]} (${bounds.join(", ")})` : parts[0];
  }
  if (rule.flat != null) return rule.flat === 0 ? "Free" : `${money(rule.flat)} per order`;
  return "Free";
}

/** Brokerage on a turnover under a profile's rule for the segment. pct wins over flat; cap and min bound a pct result. */
export function calculateBrokerage(turnover: number, rule: BrokerageRule): number {
  if (!(turnover > 0)) return 0;
  let amount: number;
  if (rule.pct != null) {
    amount = (turnover * rule.pct) / 100;
    if (rule.cap != null) amount = Math.min(amount, rule.cap);
    if (rule.min != null) amount = Math.max(amount, rule.min);
  } else {
    amount = rule.flat ?? 0;
  }
  return roundPaise(amount);
}

export function calculateSTT(segment: Segment, side: ChargeSide, turnover: number, date: Day | number | Date): { amount: number; ratePct: number } {
  const ratePct = rateOn(CHARGES[segment].stt[side], date);
  if (!(turnover > 0) || ratePct === 0) return { amount: 0, ratePct };
  const raw = (turnover * ratePct) / 100;
  return { amount: CHARGES.rounding.stt === "rupee" ? roundRupee(raw) : roundPaise(raw), ratePct };
}

export function exchangeSegmentOf(segment: Segment): ExchangeSegment {
  return CHARGES[segment].exchangeSegment;
}

export function calculateExchangeCharges(
  exchange: ExchangeName,
  segment: Segment,
  turnover: number,
  date: Day | number | Date,
): { amount: number; ratePct: number; parts: Record<string, number> | null } {
  const entry = entryOn(CHARGES.exchangeCharges[exchange][exchangeSegmentOf(segment)], date);
  const amount = turnover > 0 ? roundPaise((turnover * entry.pct) / 100) : 0;
  return { amount, ratePct: entry.pct, parts: entry.parts ?? null };
}

export function calculateSEBICharges(turnover: number, date: Day | number | Date): { amount: number; ratePct: number } {
  const ratePct = rateOn(CHARGES.sebi.ratePct, date);
  return { amount: turnover > 0 ? roundPaise((turnover * ratePct) / 100) : 0, ratePct };
}

/** Stamp duty depends on the segment and the side: delivery 0.015% on buy, intraday 0.003%, futures 0.002%, options 0.003%; none on sell. */
export function calculateStampDuty(segment: Segment, side: ChargeSide, turnover: number, date: Day | number | Date): { amount: number; ratePct: number } {
  const ratePct = rateOn(CHARGES.stampDuty[segment][side], date);
  return { amount: turnover > 0 && ratePct > 0 ? roundPaise((turnover * ratePct) / 100) : 0, ratePct };
}

/** GST on the taxable charge components passed in (never on the trade value). */
export function calculateGST(taxableCharges: number, date: Day | number | Date): { amount: number; ratePct: number } {
  const ratePct = rateOn(CHARGES.gst.ratePct, date);
  return { amount: taxableCharges > 0 ? roundPaise((taxableCharges * ratePct) / 100) : 0, ratePct };
}

// --- the whole fill ---------------------------------------------------------------------------

export type ChargeInput = {
  segment: Segment;
  exchange: ExchangeName;
  side: ChargeSide;
  quantity: number;
  price: number;
  date: Day | number | Date;
  profileId?: string | null;
  /** A user-edited profile; used when the selected id is 'custom'. */
  customProfile?: BrokerProfile | null;
  /** The depository charge applies once per scrip per sell day: true if one was already charged today. */
  dpAlreadyCharged?: boolean;
};

export function emptyBreakdown(side: ChargeSide, quantity: number, price: number, note: string): ChargeBreakdown {
  return {
    modelled: false,
    segment: null,
    exchange: null,
    side,
    quantity,
    price,
    turnover: roundPaise(quantity * price),
    brokerage: 0,
    stt: 0,
    exchangeCharges: 0,
    sebi: 0,
    stampDuty: 0,
    gst: 0,
    other: 0,
    total: 0,
    deductible: 0,
    gstBase: 0,
    lines: [],
    profileId: "",
    profileLabel: "",
    notes: [note],
    exchangeParts: null,
  };
}

export function calculateTransactionCharges(input: ChargeInput): ChargeBreakdown {
  const { segment, exchange, side, quantity, price, date } = input;
  const turnover = roundPaise(quantity * price);
  const resolved = brokerProfile(input.profileId);
  const profile = resolved.id === "custom" && input.customProfile ? input.customProfile : resolved.profile;
  const rule = profile[segment];

  const brokerage = calculateBrokerage(turnover, rule);
  const stt = calculateSTT(segment, side, turnover, date);
  const exch = calculateExchangeCharges(exchange, segment, turnover, date);
  const sebi = calculateSEBICharges(turnover, date);
  const stamp = calculateStampDuty(segment, side, turnover, date);

  const depository =
    segment === "equityDelivery" && side === "sell" && turnover > 0 && !input.dpAlreadyCharged ? roundPaise(profile.dpChargePerScripSell) : 0;

  const gstBase = roundPaise(brokerage + exch.amount + sebi.amount + depository);
  const gst = calculateGST(gstBase, date);

  const total = roundPaise(brokerage + stt.amount + exch.amount + sebi.amount + stamp.amount + gst.amount + depository);
  const deductible = roundPaise(total - stt.amount);

  const lines: ChargeLine[] = [
    { key: "brokerage", label: "Brokerage", amount: brokerage, ratePct: rule.pct ?? null, rateText: brokerageRuleText(rule), deductible: true },
    { key: "stt", label: "STT/CTT", amount: stt.amount, ratePct: stt.ratePct, rateText: ratePctText(stt.ratePct), deductible: false },
    { key: "exchange", label: "Exchange transaction charges", amount: exch.amount, ratePct: exch.ratePct, rateText: ratePctText(exch.ratePct), deductible: true },
    { key: "sebi", label: "SEBI charges", amount: sebi.amount, ratePct: sebi.ratePct, rateText: ratePctText(sebi.ratePct), deductible: true },
    { key: "stampDuty", label: "Stamp duty", amount: stamp.amount, ratePct: stamp.ratePct, rateText: ratePctText(stamp.ratePct), deductible: true },
    { key: "gst", label: "GST", amount: gst.amount, ratePct: gst.ratePct, rateText: ratePctText(gst.ratePct), deductible: true },
  ];
  if (segment === "equityDelivery" && side === "sell") {
    lines.push({
      key: "other",
      label: "Depository (DP) charge",
      amount: depository,
      ratePct: null,
      rateText: input.dpAlreadyCharged ? "Already charged today" : `${money(profile.dpChargePerScripSell)} per scrip`,
      deductible: true,
    });
  }

  const notes: string[] = [CHARGES.disclaimer];
  if (stt.ratePct === 0) notes.push(`No STT on the ${side} side of ${CHARGES[segment].label.toLowerCase()}.`);
  if (stamp.ratePct === 0) notes.push(`No stamp duty on the ${side} side.`);

  return {
    modelled: true,
    segment,
    exchange,
    side,
    quantity,
    price,
    turnover,
    brokerage,
    stt: stt.amount,
    exchangeCharges: exch.amount,
    sebi: sebi.amount,
    stampDuty: stamp.amount,
    gst: gst.amount,
    other: depository,
    total,
    deductible,
    gstBase,
    lines,
    profileId: resolved.id,
    profileLabel: profile.label,
    notes,
    exchangeParts: exch.parts,
  };
}

/** What the user pays (buy) or receives (sell) after charges. */
export function netTransactionValue(b: Pick<ChargeBreakdown, "side" | "turnover" | "total">): number {
  return roundPaise(b.side === "buy" ? b.turnover + b.total : b.turnover - b.total);
}

/** Sums breakdowns line by line, for a ledger total or a position's lifetime charges. */
export function sumBreakdowns(items: ChargeBreakdown[]): Record<ChargeKey | "total" | "deductible", number> {
  const out = { brokerage: 0, stt: 0, exchange: 0, sebi: 0, stampDuty: 0, gst: 0, other: 0, total: 0, deductible: 0 };
  for (const b of items) {
    out.brokerage += b.brokerage;
    out.stt += b.stt;
    out.exchange += b.exchangeCharges;
    out.sebi += b.sebi;
    out.stampDuty += b.stampDuty;
    out.gst += b.gst;
    out.other += b.other;
    out.total += b.total;
    out.deductible += b.deductible;
  }
  for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] = roundPaise(out[k]);
  return out;
}

export { dayOf };
