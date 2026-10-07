/**
 * Tax lots: first-in-first-out matching, holding-period classification and the gain on a closed
 * slice of a lot. Pure arithmetic over dated lots; no rates live here.
 */
import { addMonths, daysBetween, roundPaise, type Day } from "./rules";

export type HoldingTerm = "short" | "long";

export type HoldingPeriod = {
  term: HoldingTerm;
  days: number;
  /** Whole calendar months held. */
  months: number;
  thresholdMonths: number;
  /** The last day a gain is still short-term; the next day it becomes long-term. */
  shortTermUntil: Day;
  longTermFrom: Day;
  /** '6 months', '12 days', '1 year 2 months'. */
  text: string;
};

function wholeMonths(from: Day, to: Day): number {
  let m = 0;
  while (addMonths(from, m + 1) <= to) m++;
  return m;
}

export function heldText(days: number, months: number): string {
  if (months >= 12) {
    const y = Math.floor(months / 12);
    const rest = months % 12;
    return `${y} year${y === 1 ? "" : "s"}${rest ? ` ${rest} month${rest === 1 ? "" : "s"}` : ""}`;
  }
  if (months >= 1) return `${months} month${months === 1 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * A holding is long-term when it is held for MORE than the threshold: bought 10 Jan 2025 with a
 * 12-month threshold, a sale on 10 Jan 2026 is still short-term and one on 11 Jan 2026 is long-term.
 */
export function classifyHoldingPeriod(acquired: Day, sold: Day, thresholdMonths: number): HoldingPeriod {
  const shortTermUntil = addMonths(acquired, thresholdMonths);
  const days = Math.max(0, daysBetween(acquired, sold));
  const months = wholeMonths(acquired, sold);
  return {
    term: sold > shortTermUntil ? "long" : "short",
    days,
    months,
    thresholdMonths,
    shortTermUntil,
    longTermFrom: nextDay(shortTermUntil),
    text: heldText(days, months),
  };
}

function nextDay(day: Day): Day {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// --- FIFO -------------------------------------------------------------------------------------

export type FifoSlice<T> = { lot: T; qty: number };

/**
 * Takes `qty` from the front of `lots` (oldest first). Returns the slices taken and any quantity
 * the lots could not cover. Does not change the lots.
 */
export function matchFifo<T extends { qty: number }>(lots: readonly T[], qty: number): { slices: FifoSlice<T>[]; shortfall: number } {
  const slices: FifoSlice<T>[] = [];
  let left = qty;
  for (const lot of lots) {
    if (left <= 1e-9) break;
    if (lot.qty <= 1e-9) continue;
    const take = Math.min(lot.qty, left);
    slices.push({ lot, qty: take });
    left -= take;
  }
  return { slices, shortfall: left > 1e-9 ? left : 0 };
}

// --- gain on a closed slice -------------------------------------------------------------------

export type ClosedSlice = {
  qty: number;
  side: "long" | "short";
  openPrice: number;
  closePrice: number;
  /** Charges paid on the opening leg, allocated to this slice. */
  openCharges: number;
  /** Charges paid on the closing leg, allocated to this slice. */
  closeCharges: number;
  /** The STT inside each of those (never deductible from a capital gain). */
  openStt: number;
  closeStt: number;
};

export type RealizedGain = {
  /** Price move only, before any charge. */
  gross: number;
  /** All charges on both legs. */
  charges: number;
  /** What the account actually gained: gross less every charge. */
  net: number;
  /** The capital gain for tax: gross less the deductible charges (everything except STT). */
  taxable: number;
  /** STT paid, which the tax computation cannot deduct. */
  sttNotDeductible: number;
};

export function calculateRealizedGain(s: ClosedSlice): RealizedGain {
  const dir = s.side === "long" ? 1 : -1;
  const gross = roundPaise((s.closePrice - s.openPrice) * s.qty * dir);
  const charges = roundPaise(s.openCharges + s.closeCharges);
  const stt = roundPaise(s.openStt + s.closeStt);
  return {
    gross,
    charges,
    net: roundPaise(gross - charges),
    taxable: roundPaise(gross - (charges - stt)),
    sttNotDeductible: stt,
  };
}

/**
 * Splits `total` (rupees) across `weights` in whole paise so the parts add up to the total exactly.
 * The largest remainders get the leftover paise.
 */
export function allocatePaise(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return weights.map(() => 0);
  const cents = Math.round(total * 100);
  const raw = weights.map((w) => (cents * w) / sum);
  const floors = raw.map(Math.floor);
  let left = cents - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors.map((c) => c / 100);
}
