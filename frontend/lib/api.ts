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
  addFund: (body: { scheme_code: number; units: number; avg_nav?: number; purchase_date?: string }) =>
    request<FundPortfolio>("/v1/funds/holdings", { method: "POST", body: JSON.stringify(body) }),
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
};

export type FundHolding = {
  scheme_code: number;
  scheme_name: string;
  scheme_category: string;
  fund_house: string;
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
  data_available: boolean;
};

export type FundFlag = { severity: "warning" | "info"; title: string; detail: string };

export type FundPortfolio = {
  holdings: FundHolding[];
  totals: { invested: number; value: number; gain: number; gain_pct: number | null };
  flags: FundFlag[];
  disclaimer: string;
};

export type FundSlice = { label: string; pct: number };

export type FundAnalysis = {
  ready: boolean;
  xirr: number | null;
  benchmarks: { label: string; xirr: number | null }[];
  benchmarks_beaten?: number;
  benchmarks_compared?: number;
  funds: { scheme_name: string; xirr: number | null; benchmark_xirr: number | null }[];
  asset_allocation: FundSlice[];
  market_cap: FundSlice[];
  amc: FundSlice[];
  growth: { date: string; portfolio: number | null; benchmarks: Record<string, number | null> }[];
  notes: string[];
  disclaimer: string;
  lookthrough: string;
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
