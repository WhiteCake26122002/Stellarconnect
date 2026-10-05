/**
 * Data the mutual-fund desk would need from the API but does not get today. Panels that depend on
 * one of these render a "needs data" state that names the gap instead of drawing invented numbers.
 */

export type GapId =
  | "nav-history"
  | "benchmark-levels"
  | "category-average"
  | "category-benchmark"
  | "risk-free"
  | "expense-ratio"
  | "aum"
  | "holdings"
  | "riskometer"
  | "rating"
  | "inception"
  | "screener"
  | "exit-load"
  | "fund-manager"
  | "alerts-service"
  | "watchlist-sync"
  | "documents"
  | "lots";

export type DataGap = {
  title: string;
  /** What the browser is missing, in one sentence. */
  missing: string;
  /** Suggested shape of the follow-up API change. */
  proposal: string;
};

export const DATA_GAPS: Record<GapId, DataGap> = {
  "nav-history": {
    title: "Per-scheme NAV history",
    missing:
      "The API returns only each scheme's latest NAV and a 1-year trailing return. The full daily history is fetched server-side (nav.get_scheme_detail) but never sent to the browser.",
    proposal: "GET /v1/funds/schemes/{code}/history → { points: [[date, nav], …] }",
  },
  "benchmark-levels": {
    title: "Benchmark index levels",
    missing:
      "Nifty 50 / Nifty 500 are only exposed as same-rupees portfolio series inside /v1/funds/analysis, not as raw index levels a single fund can be compared against.",
    proposal: "Include benchmark closes on the same dates in the scheme history response",
  },
  "category-average": {
    title: "Category average",
    missing: "No endpoint aggregates NAV growth across all schemes in an AMFI category.",
    proposal: "GET /v1/funds/categories/{category}/growth → peer-median growth of ₹100",
  },
  "category-benchmark": {
    title: "Category benchmark mapping",
    missing:
      "Only Nifty 50 and Nifty 500 are tracked. A mid-cap or debt fund's own benchmark (Nifty Midcap 150, CRISIL indices, …) is not available, so beta is measured against Nifty 500.",
    proposal: "Add scheme → benchmark index mapping and serve that index's history",
  },
  "risk-free": {
    title: "Risk-free rate",
    missing: "No T-bill yield is served, so Sharpe uses an editable rate you set here.",
    proposal: "GET /v1/market/risk-free?country=IN → 91-day T-bill yield",
  },
  "expense-ratio": {
    title: "Expense ratio (TER) history",
    missing: "AMFI publishes TER changes, but the backend does not ingest them.",
    proposal: "Ingest AMFI TER disclosures; expose ter_history on the scheme endpoint",
  },
  aum: {
    title: "AUM history",
    missing: "Monthly average AUM disclosures are not ingested.",
    proposal: "Ingest AMFI monthly AAUM; expose aum_history on the scheme endpoint",
  },
  holdings: {
    title: "Portfolio holdings",
    missing:
      "The backend has no source for the stocks and bonds inside each fund (monthly portfolio disclosures), so sector weights, top holdings and holding-level overlap cannot be computed.",
    proposal: "Ingest monthly portfolio disclosures → { sectors: [...], top_holdings: [{ name, weight, change_1m }] }",
  },
  riskometer: {
    title: "SEBI riskometer",
    missing: "The scheme's official riskometer level is not in the API. Risk shown here is estimated from the AMFI category.",
    proposal: "Expose riskometer on /v1/funds/schemes/{code}",
  },
  rating: {
    title: "Fund rating",
    missing: "No third-party rating (licensed data) is available.",
    proposal: "Licensing decision first; then expose rating on the scheme endpoint",
  },
  inception: {
    title: "Fund age",
    missing: "Inception date (the first NAV date) is known server-side but not returned.",
    proposal: "Return inception_date on /v1/funds/schemes/{code} and on each holding",
  },
  screener: {
    title: "Category screener",
    missing:
      "Search is a substring match on scheme names. There is no way to list a category's schemes with returns or risk, so suggestions are name matches only.",
    proposal: "GET /v1/funds/screener?category=&plan= → schemes with 1Y/3Y return, volatility, TER",
  },
  "exit-load": {
    title: "Exit load",
    missing: "Exit-load schedules live in each scheme's SID / KIM. The API has none, so the charge on an early sale cannot be shown.",
    proposal: "Expose exit_load: [{ within_days, pct }] on /v1/funds/schemes/{code}",
  },
  "fund-manager": {
    title: "Fund manager",
    missing: "No manager names, tenure or other schemes they run are ingested.",
    proposal: "Ingest from AMC factsheets (or licensed data) → managers: [{ name, since, other_schemes: [code] }]",
  },
  "alerts-service": {
    title: "Alert delivery",
    missing:
      "There is no server-side alert store, scheduled NAV check or email / push channel. Alerts here are saved in this browser and checked only while Mutual funds is open.",
    proposal: "GET / POST / DELETE /v1/funds/alerts, plus a daily job after the AMFI NAV update that sends email or push",
  },
  "watchlist-sync": {
    title: "Watchlist sync",
    missing: "The watchlist is saved in this browser only and does not follow your account to other devices.",
    proposal: "GET / PUT /v1/funds/watchlist",
  },
  documents: {
    title: "Scheme documents",
    missing: "No links to the scheme information document, KIM or monthly factsheet are stored.",
    proposal: "Store AMC document URLs per scheme → documents: [{ kind, url, as_of }]",
  },
  lots: {
    title: "Purchase lots",
    missing:
      "Top-ups are blended into one average NAV and keep the first purchase date, so holding period and tax are worked out per holding, not per lot (first in, first out).",
    proposal: "Store each purchase as a lot: POST /v1/funds/holdings/{code}/lots",
  },
};
