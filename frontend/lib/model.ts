import type { Workspace } from "./api";

export type Bridge = {
  enterprise_value: number | null;
  plus_cash_and_investments: number | null;
  plus_non_operating_investments?: number | null;
  less_total_debt: number | null;
  less_lease_liabilities: number | null;
  less_minority_interest: number | null;
  less_preferred_stock: number | null;
  equity_value: number | null;
  diluted_shares_outstanding: number | null;
  equity_value_per_share: number | null;
  current_share_price: number | null;
  upside_downside: number | null;
  cash_status?: string;
  debt_status?: string;
  minority_interest_status?: string;
  shares_status?: string;
  bridge_complete?: boolean;
  block_reason?: string | null;
};

export type Wacc = {
  cost_of_equity: number;
  after_tax_cost_of_debt: number;
  equity_weight: number;
  debt_weight: number;
  wacc: number;
};

export function bridgeOf(model: Workspace): Bridge {
  return (model.valuation?.equity_bridge || {}) as Bridge;
}

export function waccOf(model: Workspace): Wacc {
  return model.wacc as Wacc;
}

export function num(row: Record<string, number | string>, key: string): number {
  return Number(row[key] || 0);
}

/**
 * Per-year revenue-growth overrides that move every explicit year by `shift` from `from`
 * (default: the current path). The last year keeps its current override, so it stays on
 * terminal g exactly as the sensitivity grids pin it.
 */
export function growthShiftOverrides(model: Workspace, shift: number, from?: number[]): (number | null)[] {
  const years = model.forecast.years;
  const current = model.drivers.year_overrides.revenue_growth;
  return years.map((y, i) =>
    i === years.length - 1 ? (current[i] ?? null) : (from?.[i] ?? num(y, "revenue_growth")) + shift,
  );
}

/**
 * WACC is not an input. The equity risk premium that makes it land on `target`, holding beta,
 * weights and every other input fixed: WACC moves by equity_weight × beta per unit of ERP.
 */
export function erpForWacc(model: Workspace, target: number, from?: { wacc: number; erp: number }): number | null {
  const slope = waccOf(model).equity_weight * model.drivers.beta;
  if (!(slope > 1e-9)) return null;
  const base = from ?? { wacc: waccOf(model).wacc, erp: model.drivers.equity_risk_premium };
  const erp = base.erp + (target - base.wacc) / slope;
  return erp >= 0 ? erp : null;
}

export function histEbitda(row: Record<string, number | string>): number {
  const revenue = num(row, "revenue");
  const cogs = num(row, "cogs");
  const opex = num(row, "rnd") + num(row, "sm") + num(row, "ga") + num(row, "other_opex");
  return revenue - cogs - opex;
}

export function marketCapMillions(model: Workspace): number | null {
  const company = model.company || {};
  const shares = Number(company.diluted_shares_outstanding);
  const price = Number(company.current_share_price);
  if (!shares || !price) return null;
  return shares * price;
}

export function latestCapexPct(model: Workspace): number {
  const y = model.forecast.years[0];
  if (!y) return 0;
  const rev = num(y, "revenue");
  return rev ? num(y, "capex") / rev : 0;
}

export function latestNwcPct(model: Workspace): number {
  const y = model.forecast.years[0];
  if (!y) return 0;
  const rev = num(y, "revenue");
  return rev ? num(y, "nwc") / rev : 0;
}

export function revenueCagr(model: Workspace): number | null {
  const s = model.summary || {};
  const v = Number(s.revenue_cagr_5y ?? s.revenue_cagr_3y);
  return Number.isFinite(v) ? v : null;
}

export function lastYoY(values: number[]): number | null {
  if (values.length < 2) return null;
  const prev = values[values.length - 2];
  const last = values[values.length - 1];
  if (!prev) return null;
  return (last - prev) / prev;
}

export function seriesCagr(values: number[]): number | null {
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (first <= 0 || last <= 0) return null;
  return Math.pow(last / first, 1 / (values.length - 1)) - 1;
}

export function avgHistEbitdaMargin(model: Workspace): number | null {
  const ms = model.historicals.income_statements
    .map((row) => {
      const rev = num(row, "revenue");
      return rev ? histEbitda(row) / rev : NaN;
    })
    .filter((n) => Number.isFinite(n));
  if (!ms.length) return null;
  return ms.reduce((a, b) => a + b, 0) / ms.length;
}

export function fundamentalsSource(model: Workspace): "screener" | "yahoo" | "manual" {
  const notes = model.ingest_notes || [];
  if (notes.some((note) => /screener\.in/i.test(note))) return "screener";
  if (model.source === "ticker") return "yahoo";
  return "manual";
}

export function needsStatementRefresh(model: Workspace): boolean {
  return (model.ingest_notes || []).some((note) =>
    note.includes("COGS/operating-expense line items are not independently available"),
  );
}

export function histFcff(row: Record<string, number | string>): number {
  return num(row, "net_income") + num(row, "da") - num(row, "change_in_nwc") - Math.abs(num(row, "capex"));
}

export function intrinsicBlocked(model: Workspace): boolean {
  if (model.valuation_error) return true;
  if (model.integrity?.intrinsic_value_reliable === false) return true;
  if (model.integrity?.status === "BLOCKED") return true;
  const bridge = bridgeOf(model);
  if (bridge.bridge_complete === false) return true;
  return false;
}

export function residualNegative(model: Workspace): boolean {
  if (intrinsicBlocked(model)) return false;
  const kind = (model.equity_presentation as { kind?: string } | undefined)?.kind;
  if (kind === "negative") return true;
  const eq = bridgeOf(model).equity_value;
  return typeof eq === "number" && eq < 0;
}

export function qualityBars(model: Workspace): { data: number; forecast: number; assume: number } {
  const cats = model.integrity?.categories || [];
  const byId = Object.fromEntries(cats.map((c) => [c.id, c.score]));
  if (cats.length) {
    return {
      data: byId.data ?? model.integrity?.historical_coverage ?? 0,
      forecast: byId.forecast ?? 0,
      assume: byId.wacc ?? 0,
    };
  }
  const issues = model.integrity?.issues || [];
  const warnings = model.ingest_warnings?.length || 0;
  const histN = model.historicals.income_statements.length;
  const hit = (re: RegExp) => issues.filter((i) => re.test(i.message)).length;
  const data = Math.max(0, 100 - (histN < 3 ? 25 : 0) - warnings * 10 - hit(/cash|balance sheet|revenue|duplicate|extraction/i) * 8);
  const forecast = Math.max(0, 100 - hit(/EBITDA|FCF|revenue jump|margin forecast/i) * 12);
  const assume = Math.max(0, 100 - hit(/WACC|terminal|Equity Value is negative|Minority|preferred/i) * 15);
  return { data: Math.min(100, data), forecast: Math.min(100, forecast), assume: Math.min(100, assume) };
}
