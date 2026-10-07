/**
 * Capital gains for the paper-trading account: closed trades become tax items by financial year,
 * open positions become unrealised lots. Intraday and F&O results are listed as excluded (business
 * income, not capital gains) with the reason, never silently dropped or silently taxed.
 */
import type { Position, Quote, Trade, TradeSlice } from "../trading/types";
import { findSymbol } from "../trading/universe";
import { taxTreatment, type TaxTreatment } from "./classify";
import { classifyHoldingPeriod, type HoldingTerm } from "./lots";
import { TAX_RULES, dayOf, financialYearOf, fyStartYear, roundPaise, rulesFor, type Day } from "./rules";
import {
  assessConfidence,
  calculateEstimatedTax,
  profileAssumptions,
  type Confidence,
  type GainBucket,
  type TaxEstimate,
  type TaxItem,
  type TaxProfile,
} from "./tax";

export type ExcludedGain = {
  id: string;
  symbol: string;
  gain: number;
  kind: "business_income" | "not_modelled" | "replay";
  reason: string;
};

/** One closed slice of a lot, shown in the lot table. */
export type TaxLotRow = {
  id: string;
  symbol: string;
  name: string;
  openedOn: Day;
  closedOn: Day;
  qty: number;
  buyPrice: number;
  sellPrice: number;
  heldDays: number;
  heldText: string;
  term: HoldingTerm;
  bucket: GainBucket;
  classification: "STCG" | "LTCG";
  taxClassLabel: string;
  gross: number;
  charges: number;
  /** The capital gain for tax. */
  gain: number;
  tax: number;
};

export type EquityTaxYear = {
  fy: string;
  items: TaxItem[];
  rows: TaxLotRow[];
  excluded: ExcludedGain[];
  estimate: TaxEstimate;
  confidence: Confidence;
  /** Price move on the capital-gains trades of the year, before charges. */
  gross: number;
  /** Charges on those trades. */
  charges: number;
  /** Net result of those trades before tax. */
  netBeforeTax: number;
};

/** The slices of a trade; one saved before slices existed is described as a single slice. */
function slicesOf(t: Trade): TradeSlice[] {
  if (t.slices && t.slices.length) return t.slices;
  const dir = t.side === "long" ? 1 : -1;
  const gross = roundPaise((t.exit - t.entry) * t.qty * dir);
  return [
    {
      qty: t.qty,
      openedAt: t.openedAt,
      openPrice: t.entry,
      closePrice: t.exit,
      openCharges: 0,
      closeCharges: t.fees,
      openStt: 0,
      closeStt: 0,
      gross,
      net: roundPaise(gross - t.fees),
      taxable: roundPaise(gross - t.fees),
    },
  ];
}

function bucketFor(taxClass: "equity" | "other", term: HoldingTerm): GainBucket {
  if (taxClass === "equity") return term === "short" ? "stcg111A" : "ltcg112A";
  return term === "short" ? "stcgSlab" : "ltcg112";
}

function monthsThreshold(fy: string, taxClass: "equity" | "other"): number {
  const rules = rulesFor(fy) ?? rulesFor(Object.keys(TAX_RULES.financialYears).sort((a, b) => fyStartYear(b) - fyStartYear(a))[0])!;
  return taxClass === "equity" ? rules.equity.holdingMonths : rules.other.holdingMonths.listed;
}

/** Splits closed trades by the financial year they were closed in. */
export function groupTradesByYear(trades: Trade[]): Map<string, Trade[]> {
  const out = new Map<string, Trade[]>();
  for (const t of trades) {
    const fy = financialYearOf(t.closedAt);
    out.set(fy, [...(out.get(fy) ?? []), t]);
  }
  return out;
}

/** Financial years that have closed trades, plus the current one, newest first. */
export function equityTaxYears(trades: Trade[], now = Date.now()): string[] {
  const set = new Set<string>([financialYearOf(now), ...trades.map((t) => financialYearOf(t.closedAt))]);
  return [...set].sort((a, b) => fyStartYear(b) - fyStartYear(a));
}

/**
 * The capital-gains view of one financial year's closed trades, with a tax estimate under `profile`.
 */
export function calculateEquityTax(trades: Trade[], fy: string, profile: TaxProfile | null, infoOf = findSymbol): EquityTaxYear {
  const items: TaxItem[] = [];
  const rows: TaxLotRow[] = [];
  const excluded: ExcludedGain[] = [];
  let gross = 0;
  let charges = 0;

  for (const t of trades.filter((x) => financialYearOf(x.closedAt) === fy)) {
    const info = infoOf(t.symbol);
    const product = t.product ?? "delivery";
    const treatment: TaxTreatment = taxTreatment(info, product);
    const slices = slicesOf(t);
    if (t.replay) {
      excluded.push({ id: t.id, symbol: t.symbol, gain: t.pnl, kind: "replay", reason: "Replay-mode trades use practice dates, so they have no real holding period." });
      continue;
    }
    if (treatment.kind !== "capital_gains") {
      excluded.push({ id: t.id, symbol: t.symbol, gain: roundPaise(slices.reduce((s, x) => s + x.taxable, 0)), kind: treatment.kind, reason: treatment.reason });
      continue;
    }
    const closedOn = dayOf(t.closedAt);
    slices.forEach((s, i) => {
      const openedOn = dayOf(s.openedAt);
      const period = classifyHoldingPeriod(openedOn, closedOn, monthsThreshold(fy, treatment.taxClass));
      const bucket = bucketFor(treatment.taxClass, period.term);
      const id = `${t.id}:${i}`;
      const item: TaxItem = {
        id,
        label: info.name,
        symbol: t.symbol,
        bucket,
        gain: s.taxable,
        term: period.term,
        heldDays: period.days,
        heldText: period.text,
        openedOn,
        closedOn,
      };
      items.push(item);
      gross += s.gross;
      charges += s.openCharges + s.closeCharges;
      rows.push({
        id,
        symbol: t.symbol,
        name: info.name,
        openedOn,
        closedOn,
        qty: s.qty,
        buyPrice: s.openPrice,
        sellPrice: s.closePrice,
        heldDays: period.days,
        heldText: period.text,
        term: period.term,
        bucket,
        classification: period.term === "short" ? "STCG" : "LTCG",
        taxClassLabel: treatment.label,
        gross: s.gross,
        charges: roundPaise(s.openCharges + s.closeCharges),
        gain: s.taxable,
        tax: 0,
      });
    });
  }

  const estimate = calculateEstimatedTax({ fy, items, profile });
  for (const r of rows) r.tax = estimate.perItem[r.id] ?? 0;

  const hasSlab = items.some((i) => i.bucket === "stcgSlab");
  const confidence = assessConfidence({
    coveragePct: 100,
    missing: estimate.supported ? [] : [estimate.reason ?? "Rules for this year are not configured."],
    assumptions: estimate.supported ? profileAssumptions(profile ?? { slabRatePct: null, incomeBand: null, regime: "new" }, fy, hasSlab) : [],
  });

  return {
    fy,
    items,
    rows,
    excluded,
    estimate,
    confidence,
    gross: roundPaise(gross),
    charges: roundPaise(charges),
    netBeforeTax: roundPaise(gross - charges),
  };
}

// --- unrealised ------------------------------------------------------------------------------

export type UnrealizedLot = {
  id: string;
  symbol: string;
  name: string;
  openedOn: Day;
  qty: number;
  buyPrice: number;
  last: number;
  heldDays: number;
  heldText: string;
  term: HoldingTerm;
  /** When a short-term lot turns long-term; null once it has, or when not capital gains. */
  longTermOn: Day | null;
  /** Price move less the deductible opening charges. No exit charges are guessed. */
  gain: number;
};

/**
 * Open delivery lots with their gain as things stand. Nothing here is a tax event: a gain becomes
 * taxable only when the position is sold.
 */
export function unrealizedLots(positions: Position[], quotes: Map<string, Quote>, now = Date.now(), infoOf = findSymbol): { lots: UnrealizedLot[]; total: number } {
  const today = dayOf(now);
  const fy = financialYearOf(now);
  const lots: UnrealizedLot[] = [];
  for (const p of positions) {
    if (p.status === "closed" || p.side !== "long") continue;
    const info = infoOf(p.symbol);
    const treatment = taxTreatment(info, p.product ?? "delivery");
    if (treatment.kind !== "capital_gains") continue;
    const last = quotes.get(p.symbol)?.last ?? p.avgPrice;
    const list = p.lots && p.lots.length ? p.lots : [{ id: `${p.id}_l0`, qty: p.qty, price: p.avgPrice, openedAt: p.openedAt, openCharges: 0, openStt: 0 }];
    for (const l of list) {
      const openedOn = dayOf(l.openedAt);
      const period = classifyHoldingPeriod(openedOn, today, monthsThreshold(fy, treatment.taxClass));
      lots.push({
        id: l.id,
        symbol: p.symbol,
        name: info.name,
        openedOn,
        qty: l.qty,
        buyPrice: l.price,
        last,
        heldDays: period.days,
        heldText: period.text,
        term: period.term,
        longTermOn: period.term === "short" ? period.longTermFrom : null,
        gain: roundPaise((last - l.price) * l.qty - (l.openCharges - l.openStt)),
      });
    }
  }
  return { lots, total: roundPaise(lots.reduce((s, l) => s + l.gain, 0)) };
}

