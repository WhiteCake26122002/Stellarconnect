# Mutual fund module: audit, fixes and how each number is made

Scope: the Connect app's Mutual Fund desk (Next.js `/funds`, FastAPI `/v1/funds`), plus the legacy
Streamlit analysis tab. Order of work: accuracy, data integrity, interpretation, UX, polish.

## 1. What was wrong

**The headline numbers were real XIRRs of a window that was far too short.** The stored holdings
were bought 25 to 27 Sep 2026, about nine days before the analysis. `xirr()` annualizes whatever
window it is given, so a 1.2% loss over nine days was compounded to a year and shown as
`Your XIRR -35.61%`; a 3.1% dip in the Nifty 50 became `-61.84%`, and Nifty 500's 3.3% became
`-65.61%`. The same page then said "Ahead of 2/2 benchmarks". Nothing was miscalculated; it was
miscommunicated. Measured over the window actually held:

| | Shown before | Over the 9 days held |
|---|---|---|
| Portfolio | -35.61% (annualized) | -1.16% |
| Nifty 50 | -61.84% (annualized) | -3.11% |
| Nifty 500 | -65.61% (annualized) | -3.30% |

Other defects found while tracing the data flow:

| # | Defect | Effect |
|---|---|---|
| 1 | XIRR / CAGR annualized with no minimum window | Absurd percentages on every short holding |
| 2 | "Value over time" headline divided end value by start value | A purchase read as a gain (`+₹2,28,229 (+445.74%)` on a portfolio that had lost 0.27%) |
| 3 | Every fund compared with Nifty 500 | Debt, hybrid and small-cap funds judged against an unrelated index |
| 4 | Historical purchase date with no NAV silently used **today's NAV** | Fabricated gains on any back-dated purchase |
| 5 | Top-ups blended into one average NAV at the first purchase date | Wrong cash-flow dates, so wrong XIRR and value path |
| 6 | Verdicts ("ahead of benchmark") with no minimum period | Judged funds on days of data |
| 7 | Price-index benchmarks used for index funds | An index fund "beat" its index because its NAV includes dividends |
| 8 | Capture ratios reported after 4 up/down periods | Downside capture of 125% on ten weeks of data |
| 9 | Overlap insight inferred from category | "No pair shares a category" read as "no overlap" |
| 10 | Planner extrapolated one trailing return over 25 years | One apparently precise corpus |
| 11 | **91 of 199 funds-module CSS classes had no rule anywhere** | Cards, filters, alerts, tax panel and fact sheet rendered as raw HTML |

## 2. What changed

* **One calculation layer**, `backend/mutual_funds/metrics.py`, pure and tested. The browser does no
  return arithmetic on server figures; it chooses wording (`frontend/lib/funds/returns.ts`).
* Transactions table (`mf_transactions`): every purchase and redemption keeps its own date, units
  and NAV. Legacy holdings become one `aggregated` lot and are labelled as such.
* `analysis_view` rebuilt around one period, one end date and one benchmark window per comparison.
* Consistency engine (`consistency.py`) runs before a result is returned and withholds metrics that
  disagree (`blocked`), with the reason.
* Category-aware benchmark mapping (`benchmarks.py`); no mapping means "benchmark unavailable" with
  the reason, never a default.
* Insights engine (`insights.py`): investor profile, suitability range, prioritised top 5, evidence,
  no buy/sell language (a test scans every sentence).
* Plan page: three scenarios, today's-money values, editable assumptions, long-term index context.
* Analysis page reorganised: snapshot, performance, risk, diversification, cost, how-it-was-made.
* Portfolio cards, table, watchlist, add-fund flow and the whole missing stylesheet
  (`frontend/app/funds/funds-ui.css`); mobile layouts verified at 390px.
* Legacy Streamlit analysis tab gets the same short-window rule.

## 3. Which calculations were rebuilt

Absolute return, CAGR, XIRR (with a validity policy), benchmark return over an exact window,
same-rupees benchmark replica (redemption-safe), relative performance and verdicts, time-weighted
index (flow-adjusted), growth-of-100 basis, value path with net money in, SIP and lumpsum projections
with real value, trailing 1D / 1M / 3M / 1Y changes, long-term index CAGRs, capture-ratio gating.

## 4. Data sources

| Data | Source | Notes |
|---|---|---|
| NAV history | AMFI via mfapi.in | Daily; cached 6h |
| Indices | Yahoo Finance daily closes | **Price** indices (no dividends). Usable: Nifty 50, 100, 200, 500, Next 50, Midcap 150, Smallcap 250, Bank, IT, Pharma |
| Category, plan | AMFI scheme category and name | Risk level is estimated from the category |
| Transactions, profile | Account database (profile: this browser) | |

## 5. Unavailable because the data is not connected

Fund holdings (so no stock overlap, sector exposure or top stocks), total-return benchmarks,
debt and hybrid benchmark histories, category averages, expense ratios and direct-vs-regular cost
difference, official riskometer, AUM, fund age. Each is shown as "Unavailable" with the reason, in the
"How these numbers were made" table, and never filled in.

## 6. How each metric is now calculated

* **Period**: first purchase date to the latest NAV date. Every comparison uses the same window.
* **Absolute return** = (value + redemption proceeds) / invested - 1. Not annualized.
* **CAGR** = (end/start)^(365/days) - 1, only for one purchase date and at least 365 days.
* **XIRR**: solved on dated flows; shown only if the first purchase is at least 365 days old *and*
  the investment-weighted age is at least 90 days. Otherwise the plain return is shown and the reason is stated.
* **Time-weighted return**: chain-linked; each interval is (closing value - that day's flow) / previous value - 1,
  flows valued at the NAV published that day. New money never counts as return.
* **Benchmark return**: (end level / start level) - 1 over the same window; each level must exist within 7 days
  of its date or the benchmark is unavailable. Same-rupees replica: a purchase of Rs a buys a / level units; a
  redemption sells the same fraction of the replica's units.
* **Relative performance**: fund minus benchmark in percentage points. Verdict only after 30 days of
  holding; index funds are judged on tracking, not on beating the index. A negative fund beating a more negative
  index is described as exactly that.
* **Volatility, Sharpe, beta, capture ratios**: need at least 52 weekly observations; otherwise "Not enough history"
  with the requirement. Drawdown is reported over whatever period exists, with the period stated.
* **Rolling returns**: only windows the history fully covers; otherwise one clear message.
* **SIP**: FV = P x ((1+r)^n - 1)/r x (1+r), r = (1+annual)^(1/12) - 1 (beginning of month).
  **Lumpsum**: FV = PV x (1+annual)^years. **Real value** = nominal / (1+inflation)^years.
* **Suitability**: equity share of value compared with an educational reference range for the stated risk
  tolerance and horizon. Hybrid funds are reported separately, never guessed as equity.

## 7. Tests added

| Suite | Count | Covers |
|---|---|---|
| `test_mf_metrics.py` | 48 | Every formula with known answers and edge cases |
| `test_mf_portfolio.py` | 46 | The ten-day scenario, extra purchases, redemptions, closed positions, missing data, debt/hybrid, index funds, NAV-entry check, consistency engine, benchmark mapping |
| `test_mf_insights.py` | 26 | Concentration, suitability, language rules, prioritisation |
| `test_funds_api_dated.py` | 15 | Dated NAVs, transactions, legacy backfill, redemption, insights endpoint |
| `test_mf_context.py` | 5 | Long-term CAGR windows |
| `test_ui_mutual_funds_analysis.py` | 2 | Legacy Streamlit tab |
| `frontend/lib/funds/*.test.ts` | 38 | Drawdown, beta, capture, rolling, window returns, SIP, lumpsum, plan blending, wording (`npm run test:unit`) |
| `e2e/funds-honesty.spec.ts` | 8 | The rules above, end to end, plus phone fit on every tab |

Writing the tests found two more defects (capture ratios on short history; an expectation that
mixed up where flows fall in an interval), both fixed.

## 8. Remaining limitations

* No holdings feed, so the X-ray is category-based and overlap is "unavailable".
* Benchmarks are price indices; a fund's NAV includes dividends, which flatters funds by roughly a point a year.
* Holdings created before the transactions table have one date and a blended NAV (labelled "aggregated").
* Tax is now worked out per lot (every purchase and SIP instalment); see `docs/costs-and-tax.md`.
* Redemption exists in the API and the model; there is no button for it yet.
* The investor profile is stored in the browser, not the account.
* Scenario rates are planning conventions the user can edit; they are not forecasts.
* Weekly marks drive the value path and risk measures.
