"""
Manual company data-entry form for the basic Streamlit UI.

There is no upload/parsing engine yet (spec sections 3-4), so this is the
stand-in: a non-technical user types their own company's historicals
directly into editable tables and the same deterministic engine used for
the sample company runs on top of it.
"""
from __future__ import annotations

import pandas as pd
import streamlit as st

import ui_theme
from backend.engine.models import (
    BalanceSheet,
    CashFlowStatement,
    Company,
    CompanyType,
    HistoricalFinancials,
    IncomeStatement,
)
from backend.engine.wacc import WaccInputs, make_wacc_inputs
from backend.engine.models import AssumptionSource
from backend.engine.cost_of_debt import CostOfDebtEstimate
from backend.data.damodaran_reference import SectorBetaMatch, CountryRiskData, get_country_risk, match_india_sector_beta
from backend.common.company_search import search_companies
from backend.ingestion.yfinance_ingestion import fetch_company

IS_ROWS = ["Revenue", "COGS", "R&D", "S&M", "G&A", "D&A", "Interest Expense", "Taxes", "Other Below EBIT"]
BS_ROWS = [
    "Cash & Equivalents", "Marketable Securities", "Accounts Receivable", "Inventory", "Other Current Assets",
    "PP&E", "Goodwill", "Intangible Assets", "Other Assets", "Accounts Payable", "Accrued Liabilities",
    "Short-Term Debt", "Long-Term Debt", "Lease Liabilities", "Other Liabilities", "Shareholders' Equity",
]
CF_ROWS = [
    "Net Income", "D&A", "Stock-Based Comp", "Other Non-Cash Items", "Change in NWC", "Capex", "Acquisitions",
    "Other Investing", "Debt Issuance/(Repayment)", "Equity Issuance/(Repurchase)", "Dividends",
]


def render_custom_company_form() -> tuple[Company | None, HistoricalFinancials | None]:
    st.header("Enter Your Company's Financials")
    st.caption(
        "Type your company's historical statements below (any currency, consistent units e.g. all in millions). "
        "Leave a cell at 0 if a line item does not apply. Nothing is uploaded anywhere: this stays in your browser session."
    )

    c1, c2, c3 = st.columns(3)
    name = c1.text_input("Company Name", value=st.session_state.get("custom_name", ""))
    ticker = c2.text_input("Ticker (optional)", value="")
    company_type_label = c3.selectbox("Company Type", ["Public", "Private"])

    c4, c5, c6, c7 = st.columns(4)
    currency = c4.text_input("Currency", value="USD")
    industry = c5.text_input("Industry", value="")
    n_years = c6.selectbox("Historical years", [2, 3, 4, 5, 6, 7, 8], index=3)
    latest_fy = c7.number_input("Most recent fiscal year", min_value=1990, max_value=2100, value=2026, step=1)

    current_share_price = None
    diluted_shares = None
    target_equity_weight = None
    if company_type_label == "Public":
        c8, c9 = st.columns(2)
        price_in = c8.number_input("Current Share Price", min_value=0.0, value=0.0, step=0.01)
        shares_in = c9.number_input("Diluted Shares Outstanding (millions)", min_value=0.0, value=0.0, step=0.1)
        current_share_price = price_in or None
        diluted_shares = shares_in or None
        if not (current_share_price and diluted_shares):
            st.caption("Share price and diluted shares are optional, but without both, per-share value and market-based WACC weights can't be computed.")
    else:
        target_equity_weight = st.slider(
            "Target Equity Weight in Capital Structure (for WACC; no market price exists for a private company)",
            0, 100, 70, 1, format="%d%%",
        ) / 100

    periods = [f"FY{int(latest_fy) - (n_years - 1 - i)}" for i in range(n_years)]

    sig = (n_years, latest_fy)
    if st.session_state.get("custom_sig") != sig:
        st.session_state["custom_sig"] = sig
        st.session_state["custom_is_df"] = pd.DataFrame(0.0, index=IS_ROWS, columns=periods)
        st.session_state["custom_bs_df"] = pd.DataFrame(0.0, index=BS_ROWS, columns=periods)
        st.session_state["custom_cf_df"] = pd.DataFrame(0.0, index=CF_ROWS, columns=periods)

    st.subheader("Income Statement")
    is_edited = st.data_editor(st.session_state["custom_is_df"], key="custom_is_editor", use_container_width=True)
    st.session_state["custom_is_df"] = is_edited

    st.subheader("Balance Sheet")
    bs_edited = st.data_editor(st.session_state["custom_bs_df"], key="custom_bs_editor", use_container_width=True)
    st.session_state["custom_bs_df"] = bs_edited

    st.subheader("Cash Flow Statement")
    st.caption("Tip: click below to auto-calculate 'Change in NWC' from the Balance Sheet you entered above (AR + Inventory + Other CA - AP - Accrued).")
    if st.button("Auto-fill Change in NWC from Balance Sheet"):
        bs = st.session_state["custom_bs_df"]
        nwc = bs.loc["Accounts Receivable"] + bs.loc["Inventory"] + bs.loc["Other Current Assets"] - bs.loc["Accounts Payable"] - bs.loc["Accrued Liabilities"]
        change = nwc.diff().fillna(0.0)
        st.session_state["custom_cf_df"].loc["Change in NWC"] = change.values
        st.rerun()
    cf_edited = st.data_editor(st.session_state["custom_cf_df"], key="custom_cf_editor", use_container_width=True)
    st.session_state["custom_cf_df"] = cf_edited

    if not name.strip():
        st.info("Enter a company name above to continue.")
        return None, None
    if float(is_edited.loc["Revenue"].sum()) == 0.0:
        st.info("Enter at least one year of Revenue in the Income Statement above to continue.")
        return None, None

    company = Company(
        name=name.strip(),
        ticker=ticker.strip() or None,
        company_type=CompanyType.PUBLIC if company_type_label == "Public" else CompanyType.PRIVATE,
        currency=currency.strip() or "USD",
        industry=industry.strip(),
        diluted_shares_outstanding=diluted_shares,
        current_share_price=current_share_price,
    )

    income_statements, balance_sheets, cash_flows = [], [], []
    for p in periods:
        isc = is_edited[p]
        income_statements.append(
            IncomeStatement(
                period=p, revenue=float(isc["Revenue"]), cogs=float(isc["COGS"]), rnd=float(isc["R&D"]),
                sm=float(isc["S&M"]), ga=float(isc["G&A"]),
                da=float(isc["D&A"]), interest_expense=float(isc["Interest Expense"]),
                taxes=float(isc["Taxes"]), other_below_ebit=float(isc["Other Below EBIT"]),
            )
        )

        bsc = bs_edited[p]
        balance_sheets.append(
            BalanceSheet(
                period=p, cash=float(bsc["Cash & Equivalents"]), marketable_securities=float(bsc["Marketable Securities"]),
                accounts_receivable=float(bsc["Accounts Receivable"]), inventory=float(bsc["Inventory"]),
                other_current_assets=float(bsc["Other Current Assets"]), ppe=float(bsc["PP&E"]),
                goodwill=float(bsc["Goodwill"]), intangibles=float(bsc["Intangible Assets"]),
                other_assets=float(bsc["Other Assets"]), accounts_payable=float(bsc["Accounts Payable"]),
                accrued_liabilities=float(bsc["Accrued Liabilities"]), short_term_debt=float(bsc["Short-Term Debt"]),
                long_term_debt=float(bsc["Long-Term Debt"]), lease_liabilities=float(bsc["Lease Liabilities"]),
                other_liabilities=float(bsc["Other Liabilities"]), shareholders_equity=float(bsc["Shareholders' Equity"]),
            )
        )

        cfc = cf_edited[p]
        cash_flows.append(
            CashFlowStatement(
                period=p, net_income=float(cfc["Net Income"]), da=float(cfc["D&A"]),
                stock_based_comp=float(cfc["Stock-Based Comp"]), other_noncash=float(cfc["Other Non-Cash Items"]),
                change_in_nwc=float(cfc["Change in NWC"]), capex=float(cfc["Capex"]),
                acquisitions=float(cfc["Acquisitions"]), other_investing=float(cfc["Other Investing"]),
                debt_issuance_repayment=float(cfc["Debt Issuance/(Repayment)"]),
                equity_issuance_repurchase=float(cfc["Equity Issuance/(Repurchase)"]), dividends=float(cfc["Dividends"]),
            )
        )

    hist = HistoricalFinancials(income_statements=income_statements, balance_sheets=balance_sheets, cash_flows=cash_flows)
    st.session_state["custom_target_equity_weight"] = target_equity_weight
    return company, hist


def build_wacc_inputs_for_company(
    hist,
    summary,
    company: Company,
    rf: float,
    beta_val: float,
    erp: float,
    kd: float,
    kd_estimate: CostOfDebtEstimate | None = None,
    risk_free_rate_rationale: str | None = None,
) -> WaccInputs:
    """
    Generic WACC-input builder that works for any company (sample or custom-entered),
    public or private. Spec section 13: public uses market value of equity where
    available; private falls back to a user-specified target capital structure since
    no market price exists.

    `risk_free_rate_rationale` (optional): a human-readable note on where `rf` came
    from (e.g. "Live: 10Y US Treasury yield") - passed straight through to
    make_wacc_inputs so the sourcing is visible on the Assumptions tab, not just
    the sidebar caption.
    """
    latest_bs = hist.balance_sheets[-1]
    target_equity_weight = st.session_state.get("custom_target_equity_weight")

    beta_source = AssumptionSource.MARKET_DATA if company.company_type == CompanyType.PUBLIC else AssumptionSource.USER_ASSUMPTION
    beta_rationale = (
        "User-provided beta."
        if company.company_type == CompanyType.PUBLIC
        else "User-provided comparable-company beta estimate; no public market beta exists for a private company."
    )

    if company.company_type == CompanyType.PUBLIC and company.current_share_price and company.diluted_shares_outstanding:
        mv_equity = company.current_share_price * company.diluted_shares_outstanding
    elif target_equity_weight is not None:
        mv_equity = target_equity_weight * 1000.0
    else:
        mv_equity = max(latest_bs.shareholders_equity, 1.0)  # book-value fallback when price/shares are missing

    if target_equity_weight is not None:
        mv_debt = (1 - target_equity_weight) * 1000.0
    else:
        mv_debt = latest_bs.total_debt_and_leases

    return make_wacc_inputs(
        company_type=company.company_type,
        risk_free_rate=rf,
        beta=beta_val,
        beta_source=beta_source,
        beta_rationale=beta_rationale,
        equity_risk_premium=erp,
        pretax_cost_of_debt=kd,
        tax_rate=summary.avg_tax_rate,
        market_value_of_equity=mv_equity,
        market_value_of_debt=mv_debt,
        pretax_cost_of_debt_source=AssumptionSource.CALCULATED if kd_estimate is not None else None,
        pretax_cost_of_debt_rationale=kd_estimate.rationale if kd_estimate is not None else None,
        risk_free_rate_rationale=risk_free_rate_rationale,
    )


def render_live_company_form() -> tuple[Company | None, HistoricalFinancials | None, SectorBetaMatch | None, CountryRiskData | None]:
    """
    Automated data-entry path: user types a ticker, financials are fetched
    from Yahoo Finance, and WACC inputs (sector beta, country ERP, country
    tax rate) are auto-matched from the bundled Damodaran reference data.
    Nothing here is fabricated: every value traces back to Yahoo Finance or
    the Damodaran workbooks, and match confidence is always shown so a poor
    auto-match can be spotted and overridden.
    """
    st.header("Search Live Company Data")
    st.caption(
        "Search by company name or ticker, e.g. \"TCS\", \"Reliance\", or \"AAPL\". Financials are fetched "
        "automatically once you pick a match; sector beta / country equity risk premium / tax rate are then "
        "auto-matched against the bundled Damodaran (NYU Stern) reference data."
    )
    query = st.text_input("Search company", placeholder="e.g. TCS, Reliance Industries, AAPL", key="dcf_company_query")

    ticker = ""
    if query.strip():
        matches = search_companies(query.strip())
        if matches:
            st.caption("Matching companies:")
            for m in matches:
                with st.container(border=True):
                    row_col, btn_col = st.columns([4, 1])
                    with row_col:
                        st.markdown(
                            ui_theme.search_result_row_html(m["name"], m["symbol"], m["exchange"]),
                            unsafe_allow_html=True,
                        )
                    with btn_col:
                        if st.button("Select", key=f"dcf_select_{m['symbol']}", use_container_width=True):
                            st.session_state["dcf_selected_ticker"] = m["symbol"]
                            st.rerun()
            selected = st.session_state.get("dcf_selected_ticker", "")
            if selected in {m["symbol"] for m in matches}:
                ticker = selected
                st.success(f"Selected **{selected}**. Click Fetch Company Data below to continue.")
        else:
            st.caption("No matches yet - keep typing, or enter the exact ticker (e.g. TCS.NS) directly.")
            ticker = query.strip()

    fetch_clicked = st.button("Fetch Company Data", disabled=not ticker, type="primary")

    if fetch_clicked and ticker:
        with st.spinner(f"Fetching {ticker} from Yahoo Finance..."):
            try:
                st.session_state["live_result"] = fetch_company(ticker)
            except ValueError as e:
                st.session_state.pop("live_result", None)
                st.error(str(e))

    result = st.session_state.get("live_result")
    if result is None:
        st.info("Enter a ticker and click Fetch Company Data to continue.")
        return None, None, None, None

    company, hist = result.company, result.historicals
    st.success(f"Loaded **{company.name}** ({company.ticker}): {company.industry or 'industry n/a'}, {company.country or 'country n/a'}")
    for warning in result.warnings:
        st.warning(f"Data quality: {warning}")
    for note in result.notes:
        st.caption(f"Note: {note}")

    sector_match: SectorBetaMatch | None = None
    if company.industry and company.country.lower() == "india":
        sector_match = match_india_sector_beta(company.industry)
        confidence = "low-confidence fallback (market average)" if sector_match.low_confidence else f"{sector_match.match_score:.0f}% confidence"
        st.info(
            f"Sector beta auto-matched to **{sector_match.matched_industry}** ({confidence}): levered beta "
            f"{sector_match.levered_beta:.2f}, unlevered beta {sector_match.unlevered_beta:.2f}. "
            "Override in the sidebar if this looks wrong."
        )
    elif company.industry:
        st.caption(
            "Sector-beta auto-matching is only available for India-listed companies in this version "
            "(the bundled reference data is India-specific); enter beta manually in the sidebar."
        )

    country_risk: CountryRiskData | None = None
    if company.country:
        try:
            country_risk = get_country_risk(company.country)
            tax_display = f"{country_risk.corporate_tax_rate:.1%}" if country_risk.corporate_tax_rate is not None else "n/a"
            st.info(
                f"Country risk auto-matched to **{country_risk.country}**: Total Equity Risk Premium "
                f"{country_risk.total_equity_risk_premium:.2%}, corporate tax rate {tax_display}."
            )
        except ValueError as e:
            st.warning(str(e))

    return company, hist, sector_match, country_risk
