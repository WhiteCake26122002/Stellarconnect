const API = process.env.NEXT_PUBLIC_API_URL || "";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function apiErrorMessage(data: { message?: unknown; detail?: unknown }): string {
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
  return "Request failed";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API}${path}`, { ...init, headers, credentials: "include" });
  if (init.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json") || contentType.includes("application/problem")) {
    const data = await res.json();
    if (!res.ok) {
      throw new ApiError(res.status, data.code || "error", apiErrorMessage(data));
    }
    return data as T;
  }
  if (!res.ok) {
    throw new ApiError(res.status, "error", await res.text());
  }
  return undefined as T;
}

export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  first_name?: string | null;
  last_name?: string | null;
  designation?: string | null;
};

export const api = {
  me: () => request<AuthUser>("/v1/auth/me"),
  register: (body: {
    email: string;
    password: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    designation?: string;
  }) => request("/v1/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (email: string, password: string) =>
    request("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/v1/auth/logout", { method: "POST" }),
  listModels: () => request<{ items: ModelListItem[] }>("/v1/models"),
  getModel: (id: string) => request<Workspace>(`/v1/models/${id}`),
  createModel: (body: Record<string, unknown>, idempotencyKey?: string) =>
    request<Workspace>("/v1/models", {
      method: "POST",
      body: JSON.stringify(body),
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),
  patchAssumptions: (id: string, body: Record<string, unknown>) =>
    request<Workspace>(`/v1/models/${id}/assumptions`, { method: "PATCH", body: JSON.stringify(body) }),
  patchHistoricals: (id: string, body: Record<string, unknown>) =>
    request<Workspace>(`/v1/models/${id}/historicals`, { method: "PATCH", body: JSON.stringify(body) }),
  extractGuidance: (id: string, sourceText: string, sourceLabel?: string) =>
    request<GuidanceExtractResponse>(`/v1/models/${id}/guidance`, {
      method: "POST",
      body: JSON.stringify({
        source_text: sourceText,
        ...(sourceLabel?.trim() ? { source_label: sourceLabel.trim() } : {}),
      }),
    }),
  clearGuidance: (id: string) => request<Workspace>(`/v1/models/${id}/guidance`, { method: "DELETE" }),
  refreshIngest: (id: string) => request<Workspace>(`/v1/models/${id}/ingest`, { method: "POST" }),
  searchCompanies: (q: string) =>
    request<{
      results: {
        symbol: string;
        name: string;
        exchange: string;
        listing?: string;
        currency?: string;
        nse_equivalent?: string | null;
      }[];
    }>(`/v1/companies/search?q=${encodeURIComponent(q)}`, { method: "POST" }),
  marketQuotes: (symbols: string[], signal?: AbortSignal) =>
    request<{ quotes: LiveQuote[] }>("/v1/market/quotes", {
      method: "POST",
      body: JSON.stringify({ symbols }),
      signal,
    }),
  marketWorld: (signal?: AbortSignal) =>
    request<{ quotes: LiveQuote[]; live: boolean; count: number }>("/v1/market/world", { signal }),
  marketOhlc: (symbol: string, timeframe: string, signal?: AbortSignal) =>
    request<LiveOhlc>(`/v1/market/ohlc?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`, {
      signal,
    }),
  marketHeatmap: (opts?: { index?: string; range?: string }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (opts?.index) params.set("index", opts.index);
    if (opts?.range) params.set("range", opts.range);
    const qs = params.toString();
    return request<MarketHeatmap>(`/v1/market/heatmap${qs ? `?${qs}` : ""}`, { signal });
  },
  marketFinancials: (symbol: string, signal?: AbortSignal) =>
    request<MarketFinancials>(`/v1/market/financials?symbol=${encodeURIComponent(symbol)}`, { signal }),
  marketUniverse: (opts?: { q?: string; index?: string; limit?: number }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (opts?.q) params.set("q", opts.q);
    if (opts?.index) params.set("index", opts.index);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return request<MarketUniverse>(`/v1/market/universe${qs ? `?${qs}` : ""}`, { signal });
  },
  exportUrl: (id: string) => `${API}/v1/models/${id}/exports`,
  fundSchemes: (q: string, signal?: AbortSignal, limit?: number) =>
    request<{ results: FundSchemeHit[] }>(`/v1/funds/schemes?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ""}`, { signal }),
  fundQuote: (code: number, signal?: AbortSignal) =>
    request<FundQuote>(`/v1/funds/schemes/${code}`, { signal }),
  fundPortfolio: (signal?: AbortSignal) => request<FundPortfolio>("/v1/funds", { signal }),
  fundAnalysis: (signal?: AbortSignal) => request<FundAnalysis>("/v1/funds/analysis", { signal }),
  fundInsights: (profile: FundProfile, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(profile)) if (value) params.set(key, value);
    const qs = params.toString();
    return request<FundInsights>(`/v1/funds/insights${qs ? `?${qs}` : ""}`, { signal });
  },
  fundHistory: (code: number, signal?: AbortSignal) => request<FundHistory>(`/v1/funds/schemes/${code}/history`, { signal }),
  fundContext: (signal?: AbortSignal) => request<FundContext>("/v1/funds/context", { signal }),
  fundNavOn: (code: number, date: string, signal?: AbortSignal) =>
    request<FundNavOn>(`/v1/funds/schemes/${code}/nav?date=${encodeURIComponent(date)}`, { signal }),
  /** Either `units` (as on a statement, already net of stamp duty) or `amount` (the money paid; stamp duty comes out of it). */
  addFund: (body: { scheme_code: number; units?: number; amount?: number; avg_nav?: number; purchase_date?: string }) =>
    request<FundPortfolio>("/v1/funds/holdings", { method: "POST", body: JSON.stringify(body) }),
  fundSip: (body: { scheme_code: number; amount: number; day_of_month: number; start_date: string; installments?: number; end_date?: string }) =>
    request<FundPortfolio & { sip: { instalments: number; skipped: number; first: string; last: string; amount: number } }>("/v1/funds/sip", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  redeemFund: (code: number, body: { units?: number; all?: boolean; nav?: number; date?: string }) =>
    request<FundPortfolio>(`/v1/funds/holdings/${code}/redeem`, { method: "POST", body: JSON.stringify(body) }),
  fundRedeemPreview: (code: number, body: { units?: number; all?: boolean; nav?: number; date?: string; slab_rate_pct?: number | null; income_band?: string | null; regime?: "new" | "old" }, signal?: AbortSignal) =>
    request<FundRedeemPreview>(`/v1/funds/holdings/${code}/redeem-preview`, { method: "POST", body: JSON.stringify(body), signal }),
  fundTax: (params: Record<string, string>, signal?: AbortSignal) => {
    const qs = new URLSearchParams(params).toString();
    return request<FundTaxView>(`/v1/funds/tax${qs ? `?${qs}` : ""}`, { signal });
  },
  fundSchemeTax: (code: number, signal?: AbortSignal) => request<FundSchemeTax>(`/v1/funds/schemes/${code}/tax`, { signal }),
  saveFundSettings: (code: number, body: { tax_class?: "equity" | "specified" | "other" | null; exit_load?: { days: number; pct: number }[] | null }) =>
    request<{ scheme_code: number; tax_class: string | null; exit_load: { days: number; pct: number }[] | null }>(`/v1/funds/schemes/${code}/settings`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  removeFund: (code: number) => request<FundPortfolio>(`/v1/funds/holdings/${code}`, { method: "DELETE" }),
};

export type FundSchemeHit = { code: number; name: string };

export type FundQuote = {
  scheme_code: number;
  scheme_name: string;
  fund_house: string;
  scheme_category: string;
  nav: number;
  nav_date: string;
  inception_date?: string;
  /** Point-to-point NAV change in percent; a window the history does not reach is null. */
  changes?: { d1: number | null; m1: number | null; m3: number | null; y1: number | null };
};

/** A scheme's published NAV path, with its own benchmark's closes on the same dates when one exists. */
export type FundHistory = {
  scheme_code: number;
  scheme_name: string;
  category: string;
  inception_date: string;
  as_of: string;
  points: { date: string; nav: number; bench: number | null }[];
  benchmark: { key: string; label: string; proxy: boolean; note: string; basis: string } | null;
  benchmark_reason: string | null;
};

export type FundNavOn = { scheme_code: number; requested: string; nav_date: string; nav: number };

export type FundHolding = {
  scheme_code: number;
  scheme_name: string;
  scheme_category: string;
  fund_house: string;
  plan: "Direct" | "Regular" | "Unknown";
  units: number;
  avg_nav: number;
  current_nav: number | null;
  nav_date: string | null;
  invested: number;
  value: number;
  gain: number | null;
  gain_pct: number | null;
  return_1y: number | null;
  purchase_date: string;
  days_held: number | null;
  weight_pct: number | null;
  data_available: boolean;
};

export type FundPortfolio = {
  holdings: FundHolding[];
  totals: { invested: number; value: number; gain: number; gain_pct: number | null; as_of: string | null };
  disclaimer: string;
};

export type FundSlice = { label: string; pct: number };

/** The window a figure was measured over, as the server worked it out. */
export type FundPeriod = { start: string; end: string; days: number; label: string; annualizable: boolean };

/** An annualized return, or the reason it is withheld. */
export type FundXirr = {
  value: number | null;
  annualized: boolean;
  status: "ok" | "short_history" | "insufficient" | "unsolvable";
  days: number;
  note: string;
};

export type FundVerdict = "outperformed" | "underperformed" | "in_line" | "tracking" | "too_early" | "unavailable";

export type FundBenchmark = {
  key: string | null;
  ticker: string | null;
  label: string | null;
  proxy: boolean;
  note: string;
  reason: string | null;
  return_pct: number | null;
  status: "available" | "no_mapping" | "no_data";
};

export type FundCheck = { id: string; status: "ok" | "info" | "warn" | "block"; message: string; affects: string[] };

export type FundDataQuality = {
  metric: string;
  status: "available" | "unavailable";
  source: string;
  as_of: string | null;
  period: FundPeriod | null;
  note: string;
};

export type FundAnalysis = {
  ready: boolean;
  as_of: string | null;
  period: FundPeriod | null;
  portfolio: {
    value: number;
    total_invested: number;
    realised_proceeds: number;
    gain: number;
    absolute_return_pct: number | null;
    xirr: FundXirr;
    cagr_pct: number | null;
    twr_pct: number | null;
    single_date: boolean;
    nav_entries_match: boolean;
    transactions: number;
    transactions_source: "recorded" | "aggregated";
    period: FundPeriod;
  } | null;
  benchmarks: {
    key: string;
    label: string;
    ticker: string;
    source: string;
    basis: string;
    /** The same rupees, on the same dates, in the index. */
    return_pct: number | null;
    /** The index's own move between the first purchase and the end date. */
    index_move_pct: number | null;
    xirr: FundXirr | null;
    period: FundPeriod;
    /** Portfolio return minus this index's, in percentage points, plus a verdict once 30+ days have passed. */
    relative_pp: number | null;
    verdict: FundVerdict;
    verdict_text: string;
    start_date_used?: string;
    end_date_used?: string;
  }[];
  funds: {
    scheme_code: number;
    scheme_name: string;
    scheme_category: string;
    value: number;
    invested: number;
    period: FundPeriod;
    first_purchase: string;
    days_held: number;
    weighted_age_days: number;
    purchases: number;
    fund_return_pct: number | null;
    xirr: FundXirr;
    benchmark: FundBenchmark;
    relative_pp: number | null;
    verdict: FundVerdict;
    verdict_text: string;
  }[];
  checks: FundCheck[];
  /** Metric ids the consistency checks withheld (for example "xirr", "growth"). */
  blocked?: string[];
  data_quality: FundDataQuality[];
  asset_allocation: FundSlice[];
  market_cap: FundSlice[];
  amc: FundSlice[];
  /** Rupee value path: portfolio, net money in, and the same rupees in each index. */
  growth: { date: string; portfolio: number | null; invested: number; benchmarks: Record<string, number | null> }[];
  /** Time-weighted index, 100 at the first purchase, for the portfolio and each index. */
  performance: { date: string; portfolio: number; benchmarks: Record<string, number | null> }[];
  notes: string[];
  disclaimer: string;
  lookthrough: string;
};

export type FundWindowCagr = { cagr_pct: number; start: string; end: string; days: number; total_pct: number };

export type FundContext = {
  as_of: string | null;
  indices: { key: string; label: string; five_year: FundWindowCagr | null; ten_year: FundWindowCagr | null }[];
  basis: string;
  note: string;
};

export type FundProfile = { age?: string; horizon?: string; risk?: string; objective?: string; slab?: string; band?: string; regime?: string };

// --- costs and tax --------------------------------------------------------------------------------

export type FundTaxClass = "equity" | "specified" | "other" | "unknown";

export type FundClassification = {
  tax_class: FundTaxClass;
  label: string;
  detail: string;
  certainty: "category" | "depends" | "override";
  reason: string;
  source: "category" | "override";
  rule: string;
};

export type TaxConfidence = {
  level: "high" | "estimated" | "incomplete";
  label: string;
  coverage_pct: number;
  reasons: string[];
  basis: string;
};

export type TaxBucketResult = {
  bucket: "stcg111A" | "ltcg112A" | "stcgSlab" | "ltcg112";
  label: string;
  rate_pct: number | null;
  gains: number;
  losses: number;
  net: number;
  net_after_set_off: number;
  exemption: number;
  taxable: number;
  tax: number | null;
};

export type TaxEstimate = {
  supported: boolean;
  reason: string | null;
  fy: string;
  fy_label: string;
  rules: { source_fy: string; assumed: boolean; note: string | null; legal_basis: string } | null;
  buckets: Record<TaxBucketResult["bucket"], TaxBucketResult>;
  stcg: number;
  ltcg: number;
  realized_net: number;
  exemption_limit: number;
  exemption_applied: number;
  exemption_room: number;
  tax_before_surcharge_cess: number;
  surcharge: number;
  cess: number;
  total: number;
  includes_surcharge_cess: boolean;
  slab_gain_not_estimated: number;
  unabsorbed_loss: { short: number; long: number };
  headline: string;
  notes: string[];
};

export type FundTaxItem = {
  id: string;
  scheme_code: number;
  label: string;
  bucket: TaxBucketResult["bucket"];
  gain: number;
  term: "short" | "long";
  held_text: string;
  opened_on: string;
  closed_on: string;
  units: number;
  cost: number;
  proceeds: number;
  exit_load: number;
  stt: number;
  gross: number;
  net: number;
  deemed_short_term: boolean;
  tax: number;
};

export type FundTaxLot = {
  buy_date: string;
  units: number;
  cost: number;
  value: number;
  gain: number;
  term: "short" | "long";
  deemed_short_term: boolean;
  held_text: string;
  held_days: number;
  bucket: TaxBucketResult["bucket"];
  bucket_label: string;
  long_term_from: string | null;
  exit_load: number;
  source: string;
};

export type FundExitLoadInfo = {
  status: "applied" | "none" | "unavailable";
  amount_if_redeemed: number | null;
  terms: { days: number; pct: number }[] | null;
  text: string;
  source: string | null;
};

export type FundTaxFund = {
  scheme_code: number;
  scheme_name: string;
  category: string;
  classification: FundClassification;
  invested: number;
  value: number;
  unrealized_gain: number;
  first_purchase: string | null;
  lots: FundTaxLot[];
  lot_count: number;
  short_term_units: number;
  long_term_units: number;
  short_term_gain: number;
  long_term_gain: number;
  taxable_gain: number;
  tax_if_redeemed: number | null;
  tax_basis: string;
  exit_load: FundExitLoadInfo;
  stt_if_redeemed: number;
  note: string;
};

export type FundTaxView = {
  fy: string;
  fy_label: string;
  current_fy: string;
  as_of: string;
  years: { fy: string; label: string }[];
  profile: { slab_rate_pct: number | null; income_band: string | null; regime: string };
  realized: {
    fy: string;
    fy_label: string;
    gain: number;
    stcg: number;
    ltcg: number;
    gross: number;
    charges: number;
    exit_load: number;
    stt: number;
    net_before_tax: number;
    costs: { stamp_duty: number; exit_load: number; stt: number };
    estimate: TaxEstimate;
    items: FundTaxItem[];
    by_fund: { scheme_code: number; scheme_name: string; gain: number; stcg: number; ltcg: number; tax: number; exit_load: number; stt: number }[];
    confidence: TaxConfidence;
    after_tax: { gross_return_pct: number | null; net_return_pct: number | null; after_tax_return_pct: number | null; tax: number | null; after_tax_pnl: number | null; label: string } | null;
  };
  unrealized: {
    gain: number;
    short_term_gain: number;
    long_term_gain: number;
    exit_load: number;
    stt: number;
    potential_tax: number | null;
    potential_tax_basis: string;
    confidence: TaxConfidence;
    note: string;
    estimate: TaxEstimate;
  };
  funds: FundTaxFund[];
  rules: TaxEstimate["rules"];
  headline: string;
  history_note: string;
  disclosure: string;
  cost_notes: { stamp_duty: string; stt: string; distributor_charge: string; expense_ratio: string; exit_load: string };
  classes: Record<string, { label: string; short: string; detail: string }>;
};

export type FundRedeemPreview = {
  scheme_code: number;
  scheme_name: string;
  classification: FundClassification;
  units: number;
  all_units: boolean;
  nav: number;
  date: string;
  fy: string;
  fy_label: string;
  gross: number;
  cost: number;
  exit_load: { status: "applied" | "none" | "unavailable"; amount: number | null; terms: { days: number; pct: number }[] | null; text: string; source: string | null };
  stt: { amount: number; rate_pct: number; note: string | null };
  proceeds_after_charges: number;
  lots: {
    buy_date: string;
    units: number;
    cost: number;
    proceeds: number;
    exit_load: number;
    stt: number;
    taxable_gain: number;
    term: "short" | "long";
    held_text: string;
    bucket: TaxBucketResult["bucket"];
    bucket_label: string;
    deemed_short_term: boolean;
    tax: number;
  }[];
  short_term_gain: number;
  long_term_gain: number;
  taxable_gain: number;
  estimated_tax: number | null;
  tax_basis: string;
  estimated_net_proceeds: number | null;
  exemption_room_after: number | null;
  confidence: TaxConfidence;
  notes: string[];
  history_note: string;
  disclosure: string;
  after_tax: { label: string; value: number | null; return_pct: number | null };
};

export type FundSchemeTax = {
  scheme_code: number;
  scheme_name: string;
  category: string;
  classification: FundClassification;
  rules: { short_term: string; long_term: string; threshold_months: number | null; fy: string };
  exit_load: { status: "entered" | "unavailable"; terms: { days: number; pct: number }[] | null; text: string; source: string | null; note: string };
  expense_ratio_note: string;
  disclosure: string;
  classes: Record<string, { label: string; short: string; detail: string }>;
};

export type FundInsight = {
  id: string;
  category: string;
  severity: "high" | "medium" | "info";
  title: string;
  why: string;
  review: string;
  evidence: string[];
  score: number;
};

export type FundInsights = {
  insights: FundInsight[];
  also_noted: FundInsight[];
  suitability: {
    profile: string;
    equity_pct: number;
    reference_low: number;
    reference_high: number;
    status: "above" | "within" | "below";
    high_risk_equity_pct: number;
    hybrid_pct: number;
    text: string;
  } | null;
  stats: { funds: number; categories?: number; amcs?: number; equity_pct?: number; high_risk_equity_pct?: number; hybrid_pct?: number; regular_pct?: number };
  profile: { age: string | null; horizon: string | null; risk: string | null; objective: string | null; label: string; complete: boolean };
  disclaimer: string;
};

export type LiveQuote = {
  symbol: string;
  yahoo: string;
  last: number;
  prev_close: number;
  open: number;
  high: number;
  low: number;
  change: number;
  change_pct: number;
  volume: number;
  currency: string;
  ts: number;
  live: boolean;
};

export type MarketUniverseItem = {
  symbol: string;
  name: string;
  industry: string;
  exchange: string;
  asset_class: string;
  currency: string;
  lot_size: number;
  indices: string[];
};

export type MarketUniverse = {
  source: string;
  fetched_at: number;
  stale: boolean;
  index: string | null;
  q: string;
  count: number;
  indices: { name: string; count: number }[];
  items: MarketUniverseItem[];
};

export type LiveOhlc = {
  symbol: string;
  timeframe: string;
  yahoo: string | null;
  live: boolean;
  candles: { t: number; o: number; h: number; l: number; c: number; v: number }[];
};

export type MarketHeatmapTile = {
  symbol: string;
  name: string;
  industry: string;
  last: number;
  change_pct: number;
  market_cap: number;
  live: boolean;
};

export type MarketHeatmap = {
  index: string;
  range: string;
  live: boolean;
  tiles: MarketHeatmapTile[];
};

export type FinancialRatio = {
  id: string;
  label: string;
  value: number | null;
  format: "pct" | "number" | "money";
};

export type StatementTable = {
  columns: string[];
  rows: { id: string; label: string; values: Array<number | null> }[];
};

export type MarketFinancials = {
  symbol: string;
  yahoo: string | null;
  name: string;
  currency: string;
  live: boolean;
  message: string | null;
  ratios: FinancialRatio[];
  income: StatementTable;
  balance: StatementTable;
  cashflow: StatementTable;
};

export async function downloadExport(id: string, format: "xlsx" | "pdf") {
  const res = await fetch(api.exportUrl(id), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.code || "error", data.message || "Export failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const disp = res.headers.get("content-disposition") || "";
  const match = disp.match(/filename="?([^"]+)"?/);
  a.href = url;
  a.download = match?.[1] || `model.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export type ModelListItem = {
  id: string;
  name: string;
  ticker: string | null;
  currency: string;
  country: string;
  company_type: string;
  source: string;
  updated_at: string | null;
  implied_share_price: number | null;
  current_share_price: number | null;
  upside: number | null;
  integrity_score: number | null;
  integrity_band: string | null;
  valuation_error: string | null;
};

export type Workspace = {
  id: string;
  name: string;
  ticker: string | null;
  currency: string;
  country: string;
  company_type: string;
  source: string;
  statement_source?: "screener" | "yahoo" | "manual" | string;
  ingest_notes: string[];
  ingest_warnings: string[];
  updated_at: string | null;
  company: Record<string, unknown>;
  historicals: { income_statements: Record<string, number | string>[]; balance_sheets: Record<string, number | string>[]; cash_flows: Record<string, number | string>[] };
  summary: Record<string, unknown>;
  drivers: Drivers;
  assumptions: Record<string, unknown>;
  forecast: { years: Record<string, number | string>[] };
  wacc: Record<string, unknown>;
  display: { currency: string; country: string; is_india: boolean; scale_label: string; scale_divisor: number };
  valuation: null | Record<string, unknown>;
  valuation_error: string | null;
  scenarios: null | Record<string, Record<string, unknown>>;
  sensitivity: null | { wacc_range: number[]; growth_range: number[]; cells: { wacc: number; terminal_growth: number; enterprise_value: number; equity_value_per_share: number | null }[] };
  driver_ranking: null | { driver_name: string; impact_range_pct: number }[];
  integrity: null | {
    score: number;
    max_score: number;
    band: string;
    status?: string;
    intrinsic_value_reliable?: boolean;
    historical_coverage?: number;
    current_bridge_coverage?: number;
    blockers?: string[];
    categories?: { id: string; name: string; score: number; weight: number; status: string; reasons: string[] }[];
    issues: { severity: string; message: string; materiality?: string; scope?: string }[];
  };
  growth_intelligence?: {
    status: "llm" | "fallback" | "historical" | "local" | "evidence";
    configured: boolean;
    model: string;
    fallback_reason: string | null;
    clamped: boolean;
    abstained: boolean;
    thesis: string;
    latency_ms: number | null;
    used_cache: boolean;
    method: string;
    llm_suggested_year1?: number | null;
  } | null;
  growth_evidence?: Record<string, unknown> | null;
  company_profile?: Record<string, unknown> | null;
  assumption_ledger?: {
    assumption: string;
    value: number | null;
    unit: string;
    source: string;
    as_of: string;
    method: string;
    confidence: string;
    rationale: string;
    display: number | string | null;
  }[];
  compounding?: {
    base_revenue: number;
    year_revenues: number[];
    year_growth: number[];
    forecast_cagr: number | null;
    revenue_multiple: number | null;
    historical_cagr: number | null;
  } | null;
  quality_flags?: { code: string; level: string; category: string; message: string }[];
  sensitivity_growth_margin?: { row_name: string; col_name: string; row_range: number[]; col_range: number[]; cells: { row: number; col: number; enterprise_value: number; equity_value_per_share: number | null }[] } | null;
  sensitivity_growth_wacc?: { row_name: string; col_name: string; row_range: number[]; col_range: number[]; cells: { row: number; col: number; enterprise_value: number; equity_value_per_share: number | null }[] } | null;
  cyclical_normalization?: Record<string, unknown> | null;
  negative_equity_diagnostic?: Record<string, unknown> | null;
  equity_presentation?: { kind?: string; label?: string | null; status?: string; reason?: string; per_share?: number | null } | null;
  bridge_substitutes?: string[];
  classified_lines?: {
    name: string;
    amount: number | null;
    classification?: string;
    operating?: string;
    included_in_ev?: boolean;
    added_in_equity_bridge?: boolean;
    reason?: string;
    source?: string;
    confidence?: string;
  }[];
  asset_classification?: {
    lines: {
      name: string;
      amount: number;
      source: string;
      accounting: string;
      operating: string;
      already_in_ev: boolean;
      equity_adjustment: boolean;
      reason: string;
      confidence: string;
    }[];
    residual_unknown: number;
    equity_additions: number;
    primary_statements: string;
    primary_statements_note: string;
    material_unclassified: boolean;
    screener_plug?: number | null;
  } | null;
  group_structure?: Record<string, unknown> | null;
  nci_policy?: Record<string, unknown> | null;
  tax_policy?: Record<string, unknown> | null;
  wacc_audit?: Record<string, unknown> | null;
  kd_audit?: Record<string, unknown> | null;
  debt_reconciliation?: Record<string, unknown> | null;
  forecast_identities?: { period: string; da_pct_revenue: number | null; identity_ok: boolean }[];
  capex_inference?: Record<string, unknown> | null;
  nwc_audit?: Record<string, unknown> | null;
  revenue_driver_model?: Record<string, unknown> | null;
  valuation_confidence?: { score: number; band: string; deductions: string[]; note: string; status_cap?: string | null } | null;
  terminal_split?: { pv_explicit_fcff: number; pv_terminal_value: number; tv_pct_of_ev: number } | null;
  model_health?: {
    passed?: boolean;
    items?: { id: string; ok: boolean; critical: boolean; label: string }[];
    critical_failures?: string[];
    intrinsic_value?: string;
    block_reason?: string | null;
  } | null;
  negative_iv_diagnostics?: Record<string, unknown> | null;
  reliability?: Reliability | null;
};

export type ReliabilityComponent = {
  id: string;
  label: string;
  score: number;
  weight: number;
  contribution: number;
};

export type ModelHealthReport = {
  overall_status: string;
  overall_score: number;
  data_quality_score: number;
  historical_quality_score: number;
  forecast_quality_score: number;
  business_model_fit_score: number;
  capital_intensity_score: number;
  wacc_quality_score: number;
  terminal_value_score: number;
  valuation_stability_score: number;
  components: ReliabilityComponent[];
  warnings: string[];
  critical_warnings: string[];
  primary_risk: string;
  secondary_risks: string[];
  valuation_status: string;
  can_show_precise_value: boolean;
  methodology: string;
  note: string;
};

export type FieldCoverage = {
  field: string;
  status: string;
  source: string;
  as_of: string;
  value: number | null;
  note: string;
  material: boolean;
};

export type Reliability = {
  health: ModelHealthReport;
  confidence_band: string;
  required_category: string;
  methodology: {
    methodology: string;
    classification: string;
    fcff_appropriate: boolean;
    requires_review: boolean;
    block_reason: string | null;
    review_reason: string | null;
    rationale: string;
    evidence: string[];
    fit_score: number;
  };
  data_quality: {
    score: number;
    fields: FieldCoverage[];
    warnings: string[];
    critical_warnings: string[];
    unavailable_fields: string[];
  };
  historical_quality: Record<string, unknown>;
  forecast_quality: {
    score: number;
    regime: { regime: string; confidence: number; supporting_factors: string[]; contradictory_factors: string[] };
    drivers: {
      driver: string;
      value: number | null;
      unit: string;
      method: string;
      evidence_strength: number;
      historical_consistency: number;
      economic_justification: string;
      confidence: string;
      rationale: string;
    }[];
    historical_cagr: number | null;
    forecast_cagr: number | null;
    growth_gap_pp: number | null;
    growth_gap_statement: string;
    growth_gap_supported: string;
    margin_stability_score: number;
    margin_stats: Record<string, number | null>;
    margin_pattern: string;
    margin_method: string;
    revenue_path: { period: string; revenue: number; growth: number | null }[];
    guidance_available: boolean;
    warnings: string[];
  };
  capital_intensity: {
    category: string;
    score: number;
    capex_pct_revenue: number | null;
    capex_to_da: number | null;
    maintenance_capex_pct: number | null;
    growth_capex_pct: number | null;
    split_available: boolean;
    split_method: string;
    evidence: string[];
    warnings: string[];
  };
  wacc_quality: {
    score: number;
    wacc: number;
    inputs: { input: string; value: number | null; source: string; as_of: string; method: string; confidence: string }[];
    warnings: string[];
    stale_inputs: string[];
  };
  terminal_value_quality: {
    score: number;
    tv_pct_of_ev: number | null;
    terminal_growth: number | null;
    wacc: number | null;
    spread: number | null;
    severity: string;
    warnings: string[];
  };
  stability: {
    score: number;
    perturbations: { driver: string; label: string; shock: string; value_per_share: number | null; pct_change_vs_base: number | null }[];
    properties: { property: string; expectation: string; status: string; note: string }[];
    failures: string[];
    warnings: string[];
    max_swing_pct: number | null;
    sign_flips: boolean;
  } | null;
  value_explanation: {
    available: boolean;
    intrinsic_value_per_share?: number | null;
    drivers?: Record<string, number | null>;
    primary_statement?: string;
    method?: string;
  };
  platform_trajectory?: Record<string, unknown> | null;
  regulated_review?: Record<string, unknown> | null;
  regulated?: boolean;
};

export type GuidanceExtraction = {
  revenue_growth_pct: number | null;
  revenue_growth_quote: string | null;
  revenue_growth_period: string | null;
  ebitda_margin_pct: number | null;
  ebitda_margin_quote: string | null;
  ebitda_margin_period: string | null;
  notes: string;
  revenue_growth_verified: boolean;
  ebitda_margin_verified: boolean;
  rejected_reasons: string[];
  has_usable_guidance?: boolean;
};

export type GuidanceExtractResponse = {
  extraction: GuidanceExtraction;
  applied: boolean;
  workspace: Workspace;
};

export type Drivers = {
  forecast_years: number;
  growth_method?: "llm" | "historical" | "evidence";
  long_term_growth: number;
  target_ebitda_margin: number;
  risk_free_rate: number;
  risk_free_rate_source: string;
  beta: number;
  beta_source: string;
  equity_risk_premium: number;
  pretax_cost_of_debt: number;
  pretax_cost_of_debt_rationale: string;
  terminal_growth: number;
  terminal_growth_ceiling: number;
  exit_multiple: number;
  size_premium: number;
  target_equity_weight: number | null;
  preferred_stock: number;
  company_guidance_revenue_growth?: number | null;
  company_guidance_quote?: string | null;
  company_guidance_period?: string | null;
  year_overrides: {
    revenue_growth: (number | null)[];
    capex_pct_revenue: (number | null)[];
    nwc_pct_revenue: (number | null)[];
    tax_rate: (number | null)[];
  };
};
