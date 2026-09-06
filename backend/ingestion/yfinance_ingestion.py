"""
Automated financial-statement ingestion from Yahoo Finance (via the `yfinance`
library), so a user can type a ticker and get a populated historical model
instead of typing in every line item by hand (spec sections 3-4).

Design choices, disclosed to the caller via `IngestionResult.notes`:
  - Everything is converted to millions of the reporting currency.
  - Yahoo's own EBITDA / EBIT / Pre-Tax Income / Net Income / Tax figures are
    treated as authoritative; COGS and operating opex are NOT independently
    reconstructed line-by-line (Yahoo's summarized data doesn't reliably
    separate them for every company/sector, e.g. banks). Instead the model's
    single `ga` bucket is back-solved so EBITDA ties out exactly to Yahoo's
    reported figure, and `other_below_ebit` is back-solved so Pre-Tax Income
    ties out exactly. This never fabricates a number Yahoo didn't report -
    it only chooses how to distribute an already-reported total across our
    internal line items.
  - Only fiscal years present in ALL of (income statement, balance sheet,
    cash flow) are used, so every historical year is fully populated.
"""
from __future__ import annotations

import pandas as pd
import yfinance as yf
from pydantic import BaseModel

from ..engine.models import (
    BalanceSheet,
    CashFlowStatement,
    Company,
    CompanyType,
    HistoricalFinancials,
    IncomeStatement,
)

MILLION = 1_000_000.0


class IngestionResult(BaseModel):
    company: Company
    historicals: HistoricalFinancials
    notes: list[str]
    warnings: list[str] = []


def _row(df: pd.DataFrame, label: str) -> pd.Series:
    if label in df.index:
        return df.loc[label].astype(float).fillna(0.0)
    return pd.Series(0.0, index=df.columns)


def _val(series: pd.Series, col, default: float = 0.0) -> float:
    v = series.get(col, default)
    return default if pd.isna(v) else float(v)


def _has_row(df: pd.DataFrame, label: str) -> bool:
    return label in df.index and df.loc[label].notna().any()


def _raw_row(df: pd.DataFrame, label: str) -> pd.Series:
    """Unlike `_row`, does NOT fill NaN with 0 - used to detect genuinely missing (not zero) periods."""
    if label in df.index:
        return df.loc[label]
    return pd.Series(float("nan"), index=df.columns)


def fetch_company(ticker: str) -> IngestionResult:
    """
    Fetches and normalizes a company's financials from Yahoo Finance.

    `ticker` should include the exchange suffix Yahoo expects, e.g. "TCS.NS"
    (NSE), "RELIANCE.NS", "AAPL" (US, no suffix needed).
    """
    t = yf.Ticker(ticker)
    info = t.info
    if not info or info.get("quoteType") is None:
        raise ValueError(f"'{ticker}' was not found on Yahoo Finance. Check the ticker/exchange suffix (e.g. 'TCS.NS').")

    # Balance-sheet-driven financial institutions (lenders, insurers, diversified financial
    # conglomerates) break the FCFF/WACC framework the same way a bank does: their "debt" funds
    # a loan/investment book rather than operating leverage, so EV = Debt + Equity and "reinvestment"
    # stop meaning what this template assumes they mean. The check below (missing EBITDA/EBIT) only
    # catches this when Yahoo also happens to omit those fields - it does NOT for some NBFCs (e.g.
    # IREDA.NS: Yahoo reports EBITDA/EBIT for it, but its long-term debt is ~9x revenue because
    # lending is the business - running FCFF DCF on that produced a nonsensical +650% "upside").
    # Catch those by Yahoo's own industry classification instead of relying on data availability.
    _BALANCE_SHEET_DRIVEN_INDUSTRIES = {
        "Banks - Diversified", "Banks - Regional", "Credit Services", "Mortgage Finance",
        "Insurance - Life", "Insurance - Property & Casualty", "Insurance - Diversified",
        "Insurance - Reinsurance", "Insurance - Specialty", "Financial Conglomerates",
    }
    if info.get("industry") in _BALANCE_SHEET_DRIVEN_INDUSTRIES:
        raise ValueError(
            f"'{ticker}' ({info.get('industry')}) is a balance-sheet-driven financial institution "
            "(bank, NBFC/lender, or insurer), where borrowed funds are the business's raw material "
            "rather than operating leverage. A standard unlevered FCFF DCF is not methodologically "
            "appropriate here — a bank-specific model (e.g. dividend discount or excess-return) is "
            "needed instead. This app's automated Yahoo Finance ingestion supports non-financial "
            "companies only. Use 'Enter My Own Company' to build a custom model for this company instead."
        )

    income_stmt = t.income_stmt
    balance_sheet = t.balance_sheet
    cashflow = t.cashflow
    if income_stmt.empty or balance_sheet.empty or cashflow.empty:
        raise ValueError(f"'{ticker}' was found but Yahoo Finance has no financial-statement data for it.")

    # Some tickers (e.g. INFY.NS, HCLTECH.NS - Indian IT firms with US ADR listings) report their
    # financial STATEMENTS in a different currency than their market price/shares. Yahoo exposes this
    # via `financialCurrency` vs `currency`. Missing this would silently mix, e.g., USD-denominated
    # revenue with INR-denominated price/shares - an ~80-90x unit error that corrupts every ratio and
    # the entire valuation without any error or warning. Convert the statements to the price currency
    # up front using a live spot FX rate, rather than risk that silent mismatch.
    fx_rate = 1.0
    fx_conversion_skipped_note = None
    financial_currency = info.get("financialCurrency")
    display_currency = info.get("currency")
    if financial_currency and display_currency and financial_currency != display_currency:
        fx_pair = f"{financial_currency}{display_currency}=X"
        try:
            fx_rate = float(yf.Ticker(fx_pair).fast_info["last_price"])
            if not fx_rate or fx_rate <= 0:
                raise ValueError("non-positive rate")
        except Exception:
            raise ValueError(
                f"'{ticker}': Yahoo Finance reports its financial statements in {financial_currency} but its "
                f"market price/shares in {display_currency}, and the live {fx_pair} conversion rate needed to "
                "reconcile them could not be fetched. Ingesting this ticker without that conversion would "
                "silently mix currencies and produce a badly wrong valuation, so it has been refused instead."
            )

        # Yahoo's `financialCurrency` tag is occasionally wrong (observed on HCLTECH.NS: tagged
        # USD even though the raw statement figures it returns are already denominated in INR).
        # Blindly trusting the tag and applying the FX multiplier in that case inflates every
        # figure by ~80-90x and produces a wildly wrong valuation with no error raised. Sanity
        # check the conversion instead of trusting the label: a real operating company's Price/
        # Sales ratio should fall roughly within 0.02x-100x. If the UNCONVERTED figures already
        # produce a plausible P/S ratio while the CONVERTED ones do not, the tag is almost
        # certainly mislabeled - skip the conversion rather than corrupt the model.
        _raw_rev_row = _raw_row(income_stmt, "Total Revenue" if _has_row(income_stmt, "Total Revenue") else "Operating Revenue")
        _raw_rev_latest = next((v for v in _raw_rev_row.sort_index(ascending=False) if pd.notna(v)), None)
        market_cap = info.get("marketCap")
        if _raw_rev_latest and market_cap:
            SANE_LO, SANE_HI = 0.1, 100.0
            ps_converted = market_cap / (_raw_rev_latest * fx_rate) if _raw_rev_latest * fx_rate else None
            ps_unconverted = market_cap / _raw_rev_latest if _raw_rev_latest else None
            converted_sane = ps_converted is not None and SANE_LO <= ps_converted <= SANE_HI
            unconverted_sane = ps_unconverted is not None and SANE_LO <= ps_unconverted <= SANE_HI
            if unconverted_sane and not converted_sane:
                fx_conversion_skipped_note = (
                    f"'{ticker}': Yahoo Finance tags this ticker's financialCurrency as {financial_currency} "
                    f"(vs. its price currency {display_currency}), which would normally trigger an FX "
                    f"conversion. But applying the live {fx_pair} rate produces an implausible Price/Sales "
                    f"ratio ({ps_converted:.4f}x) against Yahoo's own reported Market Cap, while the "
                    f"unconverted figures are plausible ({ps_unconverted:.2f}x) - this looks like a mislabeled "
                    "currency tag from Yahoo rather than a genuine currency mismatch, so no FX conversion was "
                    "applied. Verify against the company's own reporting if this matters."
                )
                fx_rate = 1.0

        if fx_rate != 1.0:
            income_stmt = income_stmt * fx_rate
            balance_sheet = balance_sheet * fx_rate
            cashflow = cashflow * fx_rate

    periods = sorted(set(income_stmt.columns) & set(balance_sheet.columns) & set(cashflow.columns))
    if not periods:
        raise ValueError(f"'{ticker}': income statement, balance sheet, and cash flow share no common fiscal years.")

    # Checked before the completeness filter below so banks/insurers/NBFCs (which never report
    # EBITDA/EBIT on Yahoo, so every period would fail that filter) get this specific, actionable
    # explanation instead of a generic "no fiscal year has complete data" error.
    if not (_has_row(income_stmt, "EBITDA") and _has_row(income_stmt, "EBIT")):
        raise ValueError(
            f"'{ticker}' does not report EBITDA/EBIT on Yahoo Finance. This is expected for banks, insurers, "
            "and other financial institutions, where interest income/expense is the core business and a "
            "standard unlevered FCFF DCF is not methodologically appropriate — a bank-specific model "
            "(e.g. dividend discount or excess-return) is needed instead. This app's automated Yahoo Finance "
            "ingestion supports non-financial companies only. Use 'Enter My Own Company' to build a custom "
            "model for this company instead."
        )

    # Yahoo's statements sometimes include a fiscal-year column that exists structurally but carries
    # no actual data for this company (all rows NaN). Without this filter, such a "phantom" period
    # silently becomes an all-zero historical year once NaN defaults to 0 below - corrupting every
    # historical average (capex %, margins, etc.) computed across the years. Require the anchor
    # fields to be genuinely present, not just the column to exist.
    _raw_revenue = _raw_row(income_stmt, "Total Revenue" if _has_row(income_stmt, "Total Revenue") else "Operating Revenue")
    _raw_ebitda = _raw_row(income_stmt, "EBITDA")
    _raw_ebit = _raw_row(income_stmt, "EBIT")
    _raw_total_assets = _raw_row(balance_sheet, "Total Assets")
    _raw_total_liab = _raw_row(balance_sheet, "Total Liabilities Net Minority Interest")
    periods = [
        p for p in periods
        if pd.notna(_raw_revenue.get(p)) and pd.notna(_raw_ebitda.get(p)) and pd.notna(_raw_ebit.get(p))
        and pd.notna(_raw_total_assets.get(p)) and pd.notna(_raw_total_liab.get(p))
    ]
    if not periods:
        raise ValueError(f"'{ticker}': no fiscal year has complete Revenue/EBITDA/EBIT/Balance Sheet data on Yahoo Finance.")

    if not (_has_row(balance_sheet, "Total Assets") and _has_row(balance_sheet, "Total Liabilities Net Minority Interest")):
        raise ValueError(
            f"'{ticker}': Yahoo Finance does not report Total Assets / Total Liabilities for this company, "
            "so the balance sheet cannot be reliably constructed."
        )

    warnings: list[str] = []
    notes: list[str] = [
        "Historical financials sourced from Yahoo Finance (yfinance). Figures converted to millions of the "
        "reporting currency.",
        "COGS/operating-expense line items are not independently available from this source; EBITDA, EBIT, "
        "Pre-Tax Income and Net Income are Yahoo Finance's own reported figures, with the gap between Revenue "
        "and EBITDA allocated to a single combined opex line.",
        "Balance sheet 'Other Assets' and 'Other Liabilities' are residual figures computed against Yahoo "
        "Finance's own reported Total Assets / Total Liabilities (rather than summing every individual "
        "sub-line item), so each year ties out exactly to Yahoo's authoritative totals; the specific "
        "composition of those two residual lines is not independently broken out.",
    ]
    if fx_rate != 1.0:
        notes.append(
            f"Yahoo Finance reports this company's financial statements in {financial_currency}, while its "
            f"market price and share count are in {display_currency}. All statement figures below were "
            f"converted to {display_currency} using a live spot rate of {fx_rate:.4f} {display_currency} per "
            f"{financial_currency} at fetch time (not a historical rate for each fiscal year-end), so "
            "year-over-year trends may carry a small amount of FX noise on top of the underlying business "
            "trend - verify against the company's own reporting-currency filings if that precision matters."
        )
    if fx_conversion_skipped_note:
        warnings.append(fx_conversion_skipped_note)

    revenue_row = _row(income_stmt, "Total Revenue")
    if not _has_row(income_stmt, "Total Revenue"):
        revenue_row = _row(income_stmt, "Operating Revenue")
    ebitda_row = _row(income_stmt, "EBITDA")
    ebit_row = _row(income_stmt, "EBIT")
    pretax_row = _row(income_stmt, "Pretax Income")
    _raw_pretax_row = _raw_row(income_stmt, "Pretax Income")
    tax_row = _row(income_stmt, "Tax Provision")
    interest_row = _row(income_stmt, "Interest Expense")
    net_income_row = _row(income_stmt, "Net Income")

    cash_row = _row(balance_sheet, "Cash And Cash Equivalents")
    mkt_sec_row = _row(balance_sheet, "Other Short Term Investments")
    ar_row = _row(balance_sheet, "Accounts Receivable")
    inv_row = _row(balance_sheet, "Inventory")
    other_ca_row = _row(balance_sheet, "Other Current Assets")
    ppe_row = _row(balance_sheet, "Net PPE")
    goodwill_row = _row(balance_sheet, "Goodwill")
    intangibles_row = _row(balance_sheet, "Other Intangible Assets")
    other_assets_row = _row(balance_sheet, "Other Non Current Assets")
    ap_row = _row(balance_sheet, "Accounts Payable")
    other_cl_row = _row(balance_sheet, "Other Current Liabilities")
    current_debt_row = _row(balance_sheet, "Current Debt And Capital Lease Obligation")
    current_lease_row = _row(balance_sheet, "Current Capital Lease Obligation")
    lt_debt_row = _row(balance_sheet, "Long Term Debt And Capital Lease Obligation")
    lt_lease_row = _row(balance_sheet, "Long Term Capital Lease Obligation")
    other_liab_row = _row(balance_sheet, "Other Non Current Liabilities")
    equity_row = _row(balance_sheet, "Stockholders Equity")
    minority_row = _row(balance_sheet, "Minority Interest")
    total_assets_row = _row(balance_sheet, "Total Assets")
    total_liab_row = _row(balance_sheet, "Total Liabilities Net Minority Interest")

    cf_da_row = _row(cashflow, "Depreciation And Amortization")
    sbc_row = _row(cashflow, "Stock Based Compensation")
    change_nwc_row = _row(cashflow, "Change In Working Capital")
    capex_row = _row(cashflow, "Capital Expenditure")
    acq_row = _row(cashflow, "Net Business Purchase And Sale")
    cfi_row = _row(cashflow, "Investing Cash Flow")
    cff_row = _row(cashflow, "Financing Cash Flow")
    dividends_row = _row(cashflow, "Cash Dividends Paid")
    equity_issuance_row = _row(cashflow, "Net Common Stock Issuance")

    income_statements: list[IncomeStatement] = []
    balance_sheets: list[BalanceSheet] = []
    cash_flows: list[CashFlowStatement] = []

    _reconstructed_pretax_periods: list[str] = []

    for period in periods:
        fy = f"FY{period.year}"

        revenue = _val(revenue_row, period)
        ebitda = _val(ebitda_row, period)
        ebit = _val(ebit_row, period)
        interest_expense = max(_val(interest_row, period), 0.0)
        taxes = _val(tax_row, period)

        if pd.isna(_raw_pretax_row.get(period)):
            # Yahoo doesn't report Pretax Income for every year (observed on ASIANPAINT.NS: missing
            # for 3 of its 4 years). Silently defaulting the missing value to 0 would force
            # other_below_ebit to back-solve so that reconstructed pretax income is ~0 for that
            # year - which then blows up tax_rate (taxes / ~0) to an astronomical number and
            # corrupts every forecast year's NOPAT/FCFF through the multi-year average tax rate.
            # Reconstruct the missing value from the standard accounting identity instead, using
            # Net Income and Tax Provision - both of which Yahoo does report reliably.
            pretax = _val(net_income_row, period) + taxes
            _reconstructed_pretax_periods.append(fy)
        else:
            pretax = _val(pretax_row, period)

        da = ebitda - ebit
        ga = revenue - ebitda
        other_below_ebit = pretax - ebit + interest_expense

        # Internal-consistency check: Yahoo's own EBITDA and EBIT should never imply negative D&A.
        # When they do, it signals a data quality issue in the source (restated figures, one-off
        # reclassifications, etc.) rather than a mapping bug on our side - surfaced, not hidden.
        if da < 0:
            warnings.append(
                f"{fy}: Yahoo Finance's reported EBIT ({ebit / MILLION:,.0f}M) exceeds its reported EBITDA "
                f"({ebitda / MILLION:,.0f}M), implying negative D&A. This is a data quality issue in the "
                "source, not a calculation performed by this app — verify this year's figures independently "
                "before relying on them."
            )
        if revenue > 0 and ga < 0:
            warnings.append(
                f"{fy}: Reported EBITDA ({ebitda / MILLION:,.0f}M) exceeds Revenue ({revenue / MILLION:,.0f}M), "
                "which is not possible for operating income — verify this year's figures independently."
            )

        inc = IncomeStatement(
            period=fy,
            revenue=revenue / MILLION,
            cogs=0.0,
            ga=ga / MILLION,
            da=da / MILLION,
            interest_expense=interest_expense / MILLION,
            taxes=taxes / MILLION,
            other_below_ebit=other_below_ebit / MILLION,
        )
        income_statements.append(inc)

        st_debt = max(_val(current_debt_row, period) - _val(current_lease_row, period), 0.0)
        lt_debt = max(_val(lt_debt_row, period) - _val(lt_lease_row, period), 0.0)
        lease = _val(current_lease_row, period) + _val(lt_lease_row, period)

        # Balance-sheet-balance guarantee: rather than enumerating every possible sub-line item
        # (deferred taxes, provisions, non-current investments, restricted cash, etc. - a list that
        # varies by company/sector and is impossible to fully anticipate), the explicitly-modeled
        # asset/liability lines are supplemented by a residual "other" plug computed against Yahoo's
        # own authoritative "Total Assets" / "Total Liabilities" figures. This guarantees Total Assets
        # = Total Liabilities + Equity exactly (to the same accounting identity Yahoo's own reported
        # totals already satisfy), instead of silently leaking a gap from unmapped items.
        cash = _val(cash_row, period)
        mkt_sec = _val(mkt_sec_row, period)
        ar = _val(ar_row, period)
        inv = _val(inv_row, period)
        other_ca = _val(other_ca_row, period)
        ppe = _val(ppe_row, period)
        goodwill = _val(goodwill_row, period)
        intangibles = _val(intangibles_row, period)
        explicit_assets = cash + mkt_sec + ar + inv + other_ca + ppe + goodwill + intangibles
        other_assets_plug = _val(total_assets_row, period) - explicit_assets

        ap = _val(ap_row, period)
        accrued = _val(other_cl_row, period)
        minority = _val(minority_row, period)
        explicit_liabilities = ap + accrued + st_debt + lt_debt + lease
        # Minority interest is part of consolidated equity, not the parent's Shareholders' Equity
        # field below, but this model has no separate minority-equity slot on the historical balance
        # sheet - it's folded into the liabilities-side plug here so the two sides still tie out
        # exactly (Company.minority_interest, used in the EV -> equity bridge, is unaffected).
        other_liabilities_plug = (_val(total_liab_row, period) + minority) - explicit_liabilities

        # A negative residual means the explicitly-mapped lines already exceed Yahoo's own reported
        # total - i.e. double-counting somewhere in the mapping above - rather than a real negative
        # balance, which doesn't occur for these categories. Surfaced rather than silently kept.
        total_assets_reported = _val(total_assets_row, period)
        total_liab_reported = _val(total_liab_row, period)
        if total_assets_reported and other_assets_plug < -0.01 * abs(total_assets_reported):
            warnings.append(
                f"{fy}: explicitly-mapped balance sheet assets exceed Yahoo Finance's reported Total Assets "
                "- possible double-counting in the source-to-model mapping. Verify this year's asset "
                "breakdown independently."
            )
        if total_liab_reported and other_liabilities_plug < -0.01 * abs(total_liab_reported):
            warnings.append(
                f"{fy}: explicitly-mapped balance sheet liabilities exceed Yahoo Finance's reported Total "
                "Liabilities - possible double-counting in the source-to-model mapping. Verify this year's "
                "liability breakdown independently."
            )

        balance_sheets.append(
            BalanceSheet(
                period=fy,
                cash=cash / MILLION,
                marketable_securities=mkt_sec / MILLION,
                accounts_receivable=ar / MILLION,
                inventory=inv / MILLION,
                other_current_assets=other_ca / MILLION,
                ppe=ppe / MILLION,
                goodwill=goodwill / MILLION,
                intangibles=intangibles / MILLION,
                other_assets=other_assets_plug / MILLION,
                accounts_payable=ap / MILLION,
                accrued_liabilities=accrued / MILLION,
                short_term_debt=st_debt / MILLION,
                long_term_debt=lt_debt / MILLION,
                lease_liabilities=lease / MILLION,
                other_liabilities=other_liabilities_plug / MILLION,
                shareholders_equity=_val(equity_row, period) / MILLION,
            )
        )

        capex = abs(_val(capex_row, period))
        acquisitions = max(-_val(acq_row, period), 0.0)
        cfi_reported = _val(cfi_row, period)
        other_investing = cfi_reported + capex + acquisitions

        dividends = abs(_val(dividends_row, period))
        equity_issuance = _val(equity_issuance_row, period)
        cff_reported = _val(cff_row, period)
        debt_issuance_repayment = cff_reported - equity_issuance + dividends

        cash_flows.append(
            CashFlowStatement(
                period=fy,
                net_income=_val(net_income_row, period) / MILLION,
                da=da / MILLION,
                stock_based_comp=_val(sbc_row, period) / MILLION,
                other_noncash=0.0,
                change_in_nwc=-_val(change_nwc_row, period) / MILLION,
                capex=capex / MILLION,
                acquisitions=acquisitions / MILLION,
                other_investing=other_investing / MILLION,
                debt_issuance_repayment=debt_issuance_repayment / MILLION,
                equity_issuance_repurchase=equity_issuance / MILLION,
                dividends=dividends / MILLION,
            )
        )

    shares = info.get("sharesOutstanding")
    price = info.get("currentPrice") or info.get("regularMarketPrice")
    minority_interest_latest = _val(minority_row, periods[-1]) / MILLION

    # Internal-consistency check: Yahoo's own reported marketCap should equal price x shares.
    # A material mismatch usually means one of the three fields is stale (e.g. shares outstanding
    # not yet updated after a buyback/issuance) - flagged so the user can verify independently,
    # since a wrong share count silently distorts every per-share output downstream.
    market_cap = info.get("marketCap")
    if market_cap and shares and price:
        implied_market_cap = shares * price
        diff_pct = abs(implied_market_cap - market_cap) / market_cap
        if diff_pct > 0.05:
            warnings.append(
                f"Yahoo Finance's reported Market Cap ({market_cap / MILLION:,.0f}M) does not match "
                f"Price x Shares Outstanding ({implied_market_cap / MILLION:,.0f}M) - a {diff_pct:.1%} gap. "
                "One of these fields (price, shares outstanding, or market cap) may be stale; verify the "
                "share count independently before trusting per-share results."
            )

    company = Company(
        name=info.get("longName") or info.get("shortName") or ticker,
        ticker=ticker,
        company_type=CompanyType.PUBLIC,
        currency=info.get("currency", "USD"),
        units="millions",
        industry=info.get("industry", "") or info.get("sector", ""),
        country=info.get("country", ""),
        website=info.get("website", ""),
        diluted_shares_outstanding=(shares / MILLION) if shares else None,
        current_share_price=float(price) if price else None,
        minority_interest=minority_interest_latest,
        preferred_stock=0.0,
    )

    historicals = HistoricalFinancials(
        income_statements=income_statements, balance_sheets=balance_sheets, cash_flows=cash_flows
    )

    if len(periods) < 5:
        notes.append(
            f"Only {len(periods)} historical fiscal years are available from Yahoo Finance for this ticker "
            "(vs. the 5-6 years typically wanted for reliable CAGR/trend analysis)."
        )

    if _reconstructed_pretax_periods:
        notes.append(
            f"Yahoo Finance does not report Pretax Income for {', '.join(_reconstructed_pretax_periods)}; "
            "it was reconstructed as Net Income + Tax Provision (both independently reported) instead of "
            "being left at 0, which would otherwise distort that year's effective tax rate."
        )

    return IngestionResult(company=company, historicals=historicals, notes=notes, warnings=warnings)
