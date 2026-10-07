/**
 * How a fund's performance is presented. No arithmetic on returns happens in the browser: the API
 * measures every return, window and benchmark comparison (backend/mutual_funds/metrics.py) and this
 * file only chooses the wording, so every screen says the same thing about the same number.
 */
import type { FundAnalysis, FundVerdict } from "@/lib/api";

export type FundRow = FundAnalysis["funds"][number];

export type ReturnView = {
  /** Percent. XIRR when the server judged it valid, otherwise the plain return since purchase. */
  value: number | null;
  label: string;
  short: string;
  annualized: boolean;
  /** One line saying what the number is. */
  note: string;
};

/** Annualized XIRR if the server allows it (a year or more of money invested), else the plain return. */
export function returnView(row: FundRow | null | undefined, blocked: readonly string[] = []): ReturnView {
  if (!row) return { value: null, label: "Return since purchase", short: "Since purchase", annualized: false, note: "" };
  const x = row.xirr;
  if (x.annualized && x.value != null && !blocked.includes("xirr")) {
    return { value: x.value, label: "XIRR (annualized)", short: "XIRR", annualized: true, note: x.note };
  }
  return { value: row.fund_return_pct, label: "Return since purchase", short: "Since purchase", annualized: false, note: x.note };
}

export type BenchView = {
  label: string | null;
  value: number | null;
  proxy: boolean;
  available: boolean;
  /** Why there is no number, or what stands in for the official index. */
  note: string;
};

export function benchView(row: FundRow | null | undefined): BenchView {
  if (!row) return { label: null, value: null, proxy: false, available: false, note: "" };
  const b = row.benchmark;
  if (b.status === "available" && b.return_pct != null) {
    return { label: b.label, value: b.return_pct, proxy: b.proxy, available: true, note: b.note };
  }
  return { label: b.label, value: null, proxy: b.proxy, available: false, note: b.reason ?? "No like-for-like benchmark for these dates." };
}

export const VERDICT_LABEL: Record<FundVerdict, string> = {
  outperformed: "Outperformed",
  underperformed: "Underperformed",
  in_line: "In line",
  tracking: "Index fund: tracking",
  too_early: "Too early to call",
  unavailable: "No benchmark",
};

export function verdictTone(v: FundVerdict): "bull" | "bear" | "" {
  return v === "outperformed" ? "bull" : v === "underperformed" ? "bear" : "";
}

/** Percentage points, signed: "+1.4 pts". */
export function pts(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  const body = `${Math.abs(value).toFixed(digits)} pts`;
  return value > 0 ? `+${body}` : value < 0 ? `−${body}` : body;
}

/** Days as words: "10 days", "5 months", "2.3 years". */
export function spanText(days: number): string {
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}
