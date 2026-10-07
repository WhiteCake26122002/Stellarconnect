# Transaction costs and tax engine

Scope: the Connect app's Paper Trading desk (the Terminal) and Mutual Fund desk. The legacy Streamlit app is untouched.
Everything is labelled simulated or estimated. Tax output is an estimate for learning, never tax advice.

## One configuration, versioned

| File | Holds |
|---|---|
| `backend/regulatory/charges.json` | dated rate schedules for STT/CTT, exchange charges, SEBI fee, stamp duty, GST, mutual-fund stamp duty / STT / exit-load policy, broker profiles, instrument mapping |
| `backend/regulatory/tax_rules.json` | capital-gains rules per financial year (`FY2025-26`, `FY2026-27`), surcharge bands, security and mutual-fund classification rules |
| `backend/regulatory/tax_vectors.json` | hand-worked tax cases that **both** engines must reproduce |
| `frontend/lib/regulatory/*.json` | byte-for-byte mirror for the browser (`npm run sync:regulatory`); a test in each language fails if they drift |

Every rate is a dated schedule, so a rate follows the trade date (futures STT is 0.02% before 1 Apr 2026 and 0.05% after). A year with no entry is never guessed: a later year carries the latest rules forward *and says so*; FY 2024-25 (rates changed mid-year) is refused. Tests fail if a rate literal appears in a component, in a library, or in the Python tax code.

## Charges (paper trading), `frontend/lib/costs/charges.ts`

`calculateTransactionCharges` composes `calculateBrokerage`, `calculateSTT`, `calculateExchangeCharges`, `calculateSEBICharges`, `calculateStampDuty`, `calculateGST`. Segment, exchange, side, date and broker profile decide every figure:

* STT: delivery 0.1% both sides; intraday 0.025% sell; futures sell; options premium sell. Rounded to the rupee.
* Stamp duty: buy side only, a different rate for delivery, intraday, futures and options.
* GST: on brokerage + exchange charges + SEBI fee + depository charge, **never** on the trade value, STT or stamp duty.
* Brokerage comes from a profile (Default Simulator, Discount, Full-service, Custom): percentage, flat, cap, minimum.
* Instruments with no Indian schedule (commodity, forex, crypto, foreign indices) carry no charge and say so. An index is charged as a future and says so.

Charges flow into cash, invested capital, average cost (`costBasis`), realised P&L and equity. Gross P&L = net P&L + charges paid, so nothing is counted twice. Equity falls by exactly the charges when a price has not moved (tested).

Orders now have a product: Delivery or Intraday. A delivery sale needs shares held (selling unheld shares is a short sale, which is Intraday).

## Lots and capital gains

Each purchase is a lot; sales match oldest first. Holding period is "more than N months" (exactly 12 months is still short-term). The capital gain for tax is the price move less the *deductible* charges: every charge except STT. Intraday and F&O results are business income and are listed as excluded, not taxed as capital gains.

`calculateEstimatedTax` (TypeScript and Python): STCG 20%, LTCG 12.5% only above the annual Rs 1.25 lakh exemption (applied once per financial year to the net, not per sale), loss set-off inside a class (short-term loss absorbs short- and long-term gains; long-term loss only long-term), surcharge capped for flat-rate gains plus 4% cess **only once the user sets an income band**. Without it the label reads "Estimated tax before surcharge and cess". Carry-forward, other income, basic-exemption adjustment and cross-class set-off are not applied, and "Advanced tax-loss adjustment requires additional tax information." is shown whenever losses exist.

Confidence per estimate: **High** (every lot dated and classified, rules configured, profile complete), **Estimated** (needed an assumption), **Incomplete** (part of the history lacks a date or class), with "Based on N% of the available transaction history".

## Mutual funds, `backend/mutual_funds/{costs,lots,tax,sip}.py`

* **Stamp duty (0.005%)** comes out of the amount invested, so units = (amount − duty) / NAV. A lot costs its units' value plus the duty inside it, once; it is not charged again on redemption.
* **No distributor transaction charge**: discontinued by SEBI on 8 Aug 2025 (recorded in config).
* **Expense ratio** is already in the NAV and is never deducted again (stated in the UI).
* **STT 0.001%** on redemption of equity-oriented units only; stored with the redemption.
* **Exit load**: no free source exists, so it is only what the user enters from the scheme document; otherwise "Exit load information unavailable." It applies per lot age (oldest units first) and, as a transfer expense, reduces the taxable gain.
* **Tax class** (equity-oriented / specified / other / unknown) from the AMFI category and name, flagged "depends" where the scheme's mix decides, overridable by the user. Specified funds bought on/after 1 Apr 2023 are deemed short-term at slab rate whatever the period; before that, and "other" funds, use the 24-month rule.
* **SIP**: `POST /v1/funds/sip` creates one dated purchase per instalment at the NAV published that day; each is its own lot with its own term.
* Units bought before 1 Feb 2018 use the 31 Jan 2018 NAV for grandfathering when it is available; otherwise the confidence says it was not.
* Endpoints: `GET /v1/funds/tax`, `POST …/redeem-preview`, `POST …/redeem` (stores exit load and STT), `PUT /v1/funds/schemes/{code}/settings`, `GET …/schemes/{code}/tax`; tax insights join the Insights engine (no buy/sell language: still scanned by a test).

## No double counting (audit)

| Cost | Where it is taken, once |
|---|---|
| Equity charges | cash at the fill; stay with the lot as open charges, released into realised P&L on the sale |
| Charges in tax | the taxable gain starts from price move less deductible charges; net P&L is not reduced again by tax inputs |
| STT | lowers net P&L; never deducted from a taxable gain |
| MF stamp duty | inside the lot's cost (units were reduced); not on redemption |
| Exit load / STT (MF) | out of redemption proceeds; load reduces the taxable gain, STT does not |
| Expense ratio | already in NAV; never subtracted |

## Tests

Backend 492 (`test_mf_tax`, `test_funds_api_tax`, `test_regulatory_config` and the rest), frontend unit 264 (`charges`, `tax`, `engine`, `no-hardcoded-rates`), Playwright `costs-tax.spec.ts`.

## Limits

Brokerage profiles are illustrative, not any named broker's schedule. Intraday positions are not auto-squared-off (a carried-over one is labelled). Options exercise STT, MCX/CTT, DP-charge variation and a real contract note are not simulated. Mutual-fund classification is category-based (no holdings feed). The tax profile is stored in the browser. The legacy Streamlit app has no charges or tax.
