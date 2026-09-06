"""
Integration tests for Yahoo Finance ingestion. These hit the live network
(Yahoo Finance has no sanctioned offline test fixture / sandbox), so they are
marked `network` and skipped by default unless explicitly requested:

    pytest -m network backend/tests/test_yfinance_ingestion.py

This mirrors spec section 40's "Excel upload -> normalized financials"
integration test, but for the live-data ingestion path.
"""
import pytest

from ..engine.historical import analyze_historicals
from ..engine.valuation import run_dcf_valuation
from ..engine.wacc import calculate_wacc, make_wacc_inputs
from ..engine.forecast import build_default_assumptions, project_financials
from ..engine.models import AssumptionSource
from ..ingestion.yfinance_ingestion import fetch_company

pytestmark = pytest.mark.network


def test_fetch_known_ticker_returns_populated_result():
    result = fetch_company("TCS.NS")
    assert result.company.name
    assert result.company.country == "India"
    assert len(result.historicals.income_statements) >= 3
    assert result.historicals.income_statements[-1].revenue > 0


def test_fetch_unknown_ticker_raises_clear_error():
    with pytest.raises(ValueError, match="not found"):
        fetch_company("THISISNOTAREALTICKERXYZ123")


def test_bank_without_ebitda_raises_clear_error_instead_of_fabricating_data():
    """
    Regression test: banks/insurers don't report EBITDA/EBIT on Yahoo Finance.
    Before this guard, the missing rows silently defaulted to 0, which
    cascaded into a fabricated income statement (EBITDA=0, D&A=0, opex =
    100% of revenue) with no warning - exactly the kind of undetectable
    wrong-number bug a user would only notice by accident. HDFCBANK.NS is now
    caught earlier by the industry-classification check below (both paths
    lead to the same refusal; this asserts the bank-specific explanation
    still surfaces either way).
    """
    with pytest.raises(ValueError, match="financial institution"):
        fetch_company("HDFCBANK.NS")


def test_nbfc_lender_with_reported_ebitda_is_still_excluded():
    """
    Regression test for the IREDA.NS case: some NBFC lenders DO have EBITDA/
    EBIT populated on Yahoo Finance (unlike most banks), so the EBITDA/EBIT-
    presence check alone lets them through. But a lender's debt funds its
    loan book rather than operating leverage (IREDA's long-term debt runs to
    ~9x revenue) - running a standard FCFF/WACC DCF on that produced a
    nonsensical +650% "upside" before this guard. Caught instead by Yahoo's
    own industry classification ("Credit Services").
    """
    with pytest.raises(ValueError, match="financial institution"):
        fetch_company("IREDA.NS")


def test_known_good_ticker_has_no_data_quality_warnings():
    """A clean, liquid large-cap should not trip the internal-consistency checks."""
    result = fetch_company("TCS.NS")
    assert result.warnings == []


def test_balance_sheet_balances_exactly():
    """
    Regression test: real balance-sheet-imbalance reports (e.g. Reliance showing
    assets ~15% below liabilities+equity) traced back to unmapped sub-line
    items (non-current investments, deferred taxes, provisions, etc.) leaking
    out of the model. Assets and Liabilities+Equity must now tie out exactly
    for every historical year, for both a simple and a complex (large
    minority interest) company.
    """
    for ticker in ["TCS.NS", "RELIANCE.NS"]:
        result = fetch_company(ticker)
        for bs in result.historicals.balance_sheets:
            implied = bs.total_liabilities + bs.shareholders_equity
            assert bs.total_assets == pytest.approx(implied, rel=1e-4), f"{ticker} {bs.period} does not balance"


def test_dual_currency_ticker_converts_financials_to_price_currency():
    """
    Regression test: some tickers (e.g. INFY.NS - Infosys) report their income
    statement, balance sheet, and cash flow in USD on Yahoo Finance while
    their market price and share count are in INR. Before this fix, that
    ~80-90x FX gap silently leaked straight into revenue/assets/capex, so a
    P/S ratio computed from the ingested data would come out ~80x too high -
    corrupting every ratio and the entire valuation with no error or warning.
    """
    result = fetch_company("INFY.NS")
    company = result.company
    latest_revenue = result.historicals.income_statements[-1].revenue
    market_cap = company.current_share_price * company.diluted_shares_outstanding
    price_to_sales = market_cap / latest_revenue
    assert 1.0 < price_to_sales < 15.0
    assert any("financial statements in" in n for n in result.notes)


def test_phantom_all_nan_fiscal_year_is_dropped_not_zeroed():
    """
    Regression test: RELIANCE.NS's Yahoo Finance data includes a FY2022
    column that exists structurally in the DataFrame but carries no actual
    data (all rows NaN). Before this fix, that period silently became an
    all-zero historical year, dragging every historical average (capex %,
    margins, etc.) down by ~20% without any error or warning.
    """
    result = fetch_company("RELIANCE.NS")
    periods = [i.period for i in result.historicals.income_statements]
    assert "FY2022" not in periods
    # every included year must have real, positive revenue - no phantom zero-years
    assert all(i.revenue > 0 for i in result.historicals.income_statements)


def test_periods_are_chronological():
    result = fetch_company("TCS.NS")
    periods = [i.period for i in result.historicals.income_statements]
    years = [int(p[2:]) for p in periods]
    assert years == sorted(years)


def test_full_pipeline_produces_plausible_valuation():
    """
    End-to-end: fetch -> historical analysis -> forecast -> WACC (via
    Damodaran sector/country lookup) -> DCF. A live blue-chip should produce
    a positive, finite enterprise value in the same order of magnitude as
    its market cap - not a crash, not a nonsense number.
    """
    from ..data.damodaran_reference import get_country_risk, match_india_sector_beta

    result = fetch_company("TCS.NS")
    company, hist = result.company, result.historicals
    summary = analyze_historicals(hist)
    sector = match_india_sector_beta(company.industry)
    country_risk = get_country_risk(company.country)

    assumptions = build_default_assumptions(hist, summary, forecast_years=5)
    forecast = project_financials(hist, assumptions)

    latest_bs = hist.balance_sheets[-1]
    wacc_inputs = make_wacc_inputs(
        company_type=company.company_type,
        risk_free_rate=0.065,
        beta=sector.levered_beta,
        beta_source=AssumptionSource.INDUSTRY_BENCHMARK,
        beta_rationale="test",
        equity_risk_premium=country_risk.total_equity_risk_premium,
        pretax_cost_of_debt=0.08,
        tax_rate=country_risk.corporate_tax_rate or 0.25,
        market_value_of_equity=company.current_share_price * company.diluted_shares_outstanding,
        market_value_of_debt=latest_bs.total_debt_and_leases,
    )
    wacc_result = calculate_wacc(wacc_inputs)
    valuation = run_dcf_valuation(
        forecast, wacc_result, 0.05, company,
        latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities,
    )

    assert valuation.enterprise_value > 0
    assert valuation.equity_bridge.equity_value_per_share > 0
    # Sanity band: DCF/share within 3x of the actual market price (catches gross unit errors).
    price = company.current_share_price
    per_share = valuation.equity_bridge.equity_value_per_share
    assert price / 3 < per_share < price * 3
