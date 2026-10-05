const LOCALE = "en-IN";

export function money(value: number | null | undefined, divisor: number, symbol: string, scaleLabel: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  const scaled = value / (divisor || 1);
  return `${symbol}${scaled.toLocaleString(LOCALE, { maximumFractionDigits: 2 })} ${scaleLabel.replace(symbol, "").trim()}`.replace(/\s+/g, " ");
}

export function scaled(value: number | null | undefined, divisor: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return (value / (divisor || 1)).toLocaleString(LOCALE, { maximumFractionDigits: 2 });
}

export function perShare(value: number | null | undefined, symbol: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${symbol}${value.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

export function currencySymbol(code: string): string {
  const map: Record<string, string> = { USD: "$", INR: "₹", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥" };
  return map[(code || "USD").toUpperCase()] || `${code} `;
}

export function signedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  const n = value * 100;
  const body = `${Math.abs(n).toFixed(1)}%`;
  if (n > 0) return `+${body}`;
  if (n < 0) return `−${body}`;
  return body;
}

/** A shift in percentage points, e.g. "+1.5 pts". */
export function signedPts(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  const n = value * 100;
  const body = `${Math.abs(n).toFixed(1)} pts`;
  if (n > 1e-9) return `+${body}`;
  if (n < -1e-9) return `−${body}`;
  return "0.0 pts";
}

export function compactMoney(
  value: number | null | undefined,
  symbol: string,
  opts?: { divisor?: number; isIndia?: boolean },
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const v = value / (opts?.divisor || 1);
  if (opts?.isIndia) {
    return `${symbol}${v.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;
  }
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${symbol}${(v / 1_000_000).toFixed(2)}T`;
  if (abs >= 1000) return `${symbol}${(v / 1000).toFixed(2)}B`;
  return `${symbol}${v.toFixed(1)}M`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = `${parts[0]?.[0] || ""}${parts[1]?.[0] || parts[0]?.[1] || ""}`;
  return letters.toUpperCase() || "U";
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "Not saved yet";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 8) return "Just saved";
  if (s < 60) return `Saved ${s}s ago`;
  if (s < 3600) return `Saved ${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `Saved ${Math.floor(s / 3600)}h ago`;
  return `Saved ${new Date(iso).toLocaleDateString(LOCALE, { year: "numeric", month: "short", day: "numeric" })}`;
}

export function lineLabel(key: string): string {
  const map: Record<string, string> = {
    revenue: "Revenue",
    cogs: "Cost of goods",
    rnd: "R&D",
    sm: "Sales & marketing",
    ga: "G&A",
    other_opex: "Other opex",
    da: "D&A",
    interest_expense: "Interest expense",
    taxes: "Taxes",
    cash: "Cash",
    marketable_securities: "Marketable securities",
    accounts_receivable: "Accounts receivable",
    inventory: "Inventory",
    non_operating_investments: "Non-operating investments",
    other_current_assets: "Other current assets",
    ppe: "PP&E",
    goodwill: "Goodwill",
    intangibles: "Intangibles",
    other_assets: "Other assets",
    accounts_payable: "Accounts payable",
    accrued_liabilities: "Accrued liabilities",
    short_term_debt: "Short-term debt",
    long_term_debt: "Long-term debt",
    lease_liabilities: "Lease liabilities",
    other_liabilities: "Other liabilities",
    shareholders_equity: "Shareholders' equity",
    net_income: "Net income",
    stock_based_comp: "Stock-based comp",
    other_noncash: "Other non-cash",
    change_in_nwc: "Change in NWC",
    capex: "Capex",
    acquisitions: "Acquisitions",
    other_investing: "Other investing",
    debt_issuance_repayment: "Debt issuance / (repay)",
    equity_issuance_repurchase: "Equity issue / (buyback)",
    dividends: "Dividends",
  };
  return map[key] || key;
}

export function fyShort(period: string | number): string {
  const raw = String(period);
  const digits = raw.match(/(\d{2,4})$/);
  if (!digits) return raw;
  return `FY${digits[1].slice(-2)}`;
}

export function fyLong(period: string | number): string {
  const raw = String(period);
  const digits = raw.match(/(\d{2,4})$/);
  if (!digits) return raw;
  const y = digits[1];
  return y.length === 2 ? `FY20${y}` : `FY${y}`;
}
