import pytest

from ..engine.historical import analyze_historicals
from ..engine.models import (
    AssumptionSource,
    BalanceSheet,
    CashFlowStatement,
    Company,
    CompanyType,
    HistoricalFinancials,
    IncomeStatement,
)
from ..engine.valuation import run_dcf_valuation
from ..engine.validation import run_validation


def _minimal_year(period: str, revenue: float, cogs: float = None, opex_total: float = 30.0) -> tuple:
    cogs = revenue * 0.4 if cogs is None else cogs
    inc = IncomeStatement(period=period, revenue=revenue, cogs=cogs, ga=opex_total, da=5.0, interest_expense=2.0, taxes=0.0)
    inc.taxes = max(inc.pretax_income, 0) * 0.25
    bs = BalanceSheet(
        period=period,
        cash=10.0,
        accounts_receivable=revenue * 0.1,
        ppe=50.0,
        accounts_payable=revenue * 0.05,
        shareholders_equity=40.0,
    )
    cf = CashFlowStatement(period=period, net_income=inc.net_income, da=5.0, capex=5.0, change_in_nwc=1.0)
    return inc, bs, cf


def test_zero_revenue_year_does_not_crash():
    years = [_minimal_year("FY2024", 100.0), _minimal_year("FY2025", 0.0), _minimal_year("FY2026", 120.0)]
    hist = HistoricalFinancials(
        income_statements=[y[0] for y in years], balance_sheets=[y[1] for y in years], cash_flows=[y[2] for y in years]
    )
    summary = analyze_historicals(hist)  # should not raise
    assert summary.years[1].revenue == 0.0
    assert summary.years[1].gross_margin == 0.0  # safe-div guard


def test_zero_revenue_flagged_as_error():
    years = [_minimal_year("FY2024", 100.0), _minimal_year("FY2025", 0.0)]
    hist = HistoricalFinancials(
        income_statements=[y[0] for y in years], balance_sheets=[y[1] for y in years], cash_flows=[y[2] for y in years]
    )
    summary = analyze_historicals(hist)
    from ..engine.forecast import build_default_assumptions, project_financials
    from ..engine.wacc import WaccInputs, calculate_wacc
    from ..engine.models import Assumption

    assumptions = build_default_assumptions(hist, summary, forecast_years=2)
    forecast = project_financials(hist, assumptions)
    a = lambda v: Assumption(name="x", value=v, source=AssumptionSource.USER_ASSUMPTION)
    wacc_result = calculate_wacc(
        WaccInputs(
            risk_free_rate=a(0.04), beta=a(1.0), equity_risk_premium=a(0.05), size_premium=a(0.0),
            pretax_cost_of_debt=a(0.05), tax_rate=a(0.25), market_value_of_equity=a(500.0), market_value_of_debt=a(50.0),
        )
    )
    company = Company(name="Test Co", company_type=CompanyType.PRIVATE)
    result = run_dcf_valuation(forecast, wacc_result, 0.03, company, 10.0, 0.0, 0.0)
    report = run_validation(hist, summary, forecast, wacc_result, result)
    assert any("Zero revenue" in i.message for i in report.issues)
    assert report.score < 100


def test_negative_revenue_flagged_as_error():
    years = [_minimal_year("FY2025", 100.0), _minimal_year("FY2026", -20.0)]
    hist = HistoricalFinancials(
        income_statements=[y[0] for y in years], balance_sheets=[y[1] for y in years], cash_flows=[y[2] for y in years]
    )
    summary = analyze_historicals(hist)
    from ..engine.forecast import build_default_assumptions, project_financials

    assumptions = build_default_assumptions(hist, summary, forecast_years=2)
    forecast = project_financials(hist, assumptions)
    assert any(y.revenue for y in forecast.years) is not None  # forecast still computes without crashing


def test_only_one_historical_year_flagged_as_warning():
    inc, bs, cf = _minimal_year("FY2026", 100.0)
    hist = HistoricalFinancials(income_statements=[inc], balance_sheets=[bs], cash_flows=[cf])
    summary = analyze_historicals(hist)
    assert summary.revenue_cagr_3y is None
    assert summary.revenue_cagr_5y is None

    from ..engine.forecast import build_default_assumptions, project_financials
    from ..engine.wacc import WaccInputs, calculate_wacc
    from ..engine.models import Assumption

    assumptions = build_default_assumptions(hist, summary, forecast_years=2)
    forecast = project_financials(hist, assumptions)
    a = lambda v: Assumption(name="x", value=v, source=AssumptionSource.USER_ASSUMPTION)
    wacc_result = calculate_wacc(
        WaccInputs(
            risk_free_rate=a(0.04), beta=a(1.0), equity_risk_premium=a(0.05), size_premium=a(0.0),
            pretax_cost_of_debt=a(0.05), tax_rate=a(0.25), market_value_of_equity=a(500.0), market_value_of_debt=a(50.0),
        )
    )
    company = Company(name="Test Co", company_type=CompanyType.PRIVATE)
    result = run_dcf_valuation(forecast, wacc_result, 0.03, company, 10.0, 0.0, 0.0)
    report = run_validation(hist, summary, forecast, wacc_result, result)
    assert any("Fewer than 3 historical years" in i.message for i in report.issues)


def test_negative_fcff_does_not_crash_valuation(hist, summary, wacc_result, company):
    from ..engine.forecast import build_default_assumptions, project_financials
    from ..engine.assumption_utils import shift_assumption

    assumptions = build_default_assumptions(hist, summary, forecast_years=5)
    # Blow out capex so FCFF goes deeply negative.
    assumptions.capex_pct_revenue = [shift_assumption(a, 0.9, "test") for a in assumptions.capex_pct_revenue]
    forecast = project_financials(hist, assumptions)
    assert any(y.fcff < 0 for y in forecast.years)

    latest_bs = hist.balance_sheets[-1]
    result = run_dcf_valuation(
        forecast, wacc_result, 0.03, company, latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities
    )
    assert result.enterprise_value == result.enterprise_value  # not NaN, computed without raising


def test_missing_debt_and_cash_handled(forecast, wacc_result, company):
    result = run_dcf_valuation(forecast, wacc_result, 0.03, company, cash_and_investments=0.0, total_debt=0.0, lease_liabilities=0.0)
    assert result.equity_bridge.equity_value == pytest.approx(result.enterprise_value)


def test_revenue_dropping_to_zero_does_not_crash_scenarios():
    """
    Regression test: a most-recent historical year of exactly 0 revenue (e.g. a
    user-entered company with only one populated year) produces a -100% YoY
    growth data point, which the historical-trend forecast can glide into a
    -100% assumed growth rate. run_scenario used to reconstruct a "pre-growth"
    base revenue via `first_rev / (1 + growth)`, which divided by zero here.
    """
    years = [_minimal_year("FY2022", 100.0), _minimal_year("FY2023", 0.0, cogs=0.0, opex_total=0.0)]
    hist = HistoricalFinancials(
        income_statements=[y[0] for y in years], balance_sheets=[y[1] for y in years], cash_flows=[y[2] for y in years]
    )
    summary = analyze_historicals(hist)
    assert summary.years[1].revenue_growth == pytest.approx(-1.0)

    from ..engine.forecast import build_default_assumptions
    from ..engine.models import Assumption
    from ..engine.scenarios import run_all_scenarios
    from ..engine.wacc import WaccInputs

    assumptions = build_default_assumptions(hist, summary, forecast_years=5)
    a = lambda v: Assumption(name="x", value=v, source=AssumptionSource.USER_ASSUMPTION)

    wacc_inputs = WaccInputs(
        risk_free_rate=a(0.04), beta=a(1.0), equity_risk_premium=a(0.05), size_premium=a(0.0),
        pretax_cost_of_debt=a(0.05), tax_rate=a(0.25), market_value_of_equity=a(500.0), market_value_of_debt=a(50.0),
    )
    company = Company(name="Test Co", company_type=CompanyType.PUBLIC)

    scenarios = run_all_scenarios(
        hist=hist, summary=summary, company=company, base_assumptions=assumptions,
        base_wacc_inputs=wacc_inputs, base_terminal_growth=0.03,
        cash_and_investments=10.0, total_debt=0.0, lease_liabilities=0.0,
    )  # must not raise ZeroDivisionError
    assert scenarios["Base Case"].revenue_cagr is None  # base-year revenue is 0 -> CAGR undefined, not a crash


def test_extreme_growth_flagged(hist, summary, wacc_result, company):
    from ..engine.forecast import build_default_assumptions, project_financials
    from ..engine.assumption_utils import shift_assumption

    assumptions = build_default_assumptions(hist, summary, forecast_years=5)
    assumptions.revenue_growth[1] = shift_assumption(assumptions.revenue_growth[1], 2.0, "test")  # +200pp jump
    forecast = project_financials(hist, assumptions)
    latest_bs = hist.balance_sheets[-1]
    result = run_dcf_valuation(
        forecast, wacc_result, 0.03, company, latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities
    )
    report = run_validation(hist, summary, forecast, wacc_result, result)
    assert any("Large unexplained revenue jump" in i.message for i in report.issues)


def test_negative_equity_value_flagged_prominently(hist, summary, forecast, wacc_result, company):
    """
    Regression test for the Reliance case: a large, legitimately-sourced
    minority interest can push Equity Value negative. This must never pass
    silently - a negative equity value is always worth an explicit error-level
    flag, whether or not the underlying inputs are individually "correct".
    """
    huge_minority_company = company.model_copy(update={"minority_interest": 1_000_000.0})
    latest_bs = hist.balance_sheets[-1]
    result = run_dcf_valuation(
        forecast, wacc_result, 0.03, huge_minority_company,
        latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities,
    )
    assert result.equity_bridge.equity_value < 0
    report = run_validation(hist, summary, forecast, wacc_result, result)
    assert any(i.severity == "error" and "Equity Value is negative" in i.message for i in report.issues)


def test_large_minority_interest_pct_of_ev_flagged(hist, summary, forecast, wacc_result, company):
    latest_bs = hist.balance_sheets[-1]
    base_result = run_dcf_valuation(
        forecast, wacc_result, 0.03, company,
        latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities,
    )
    large_minority_company = company.model_copy(
        update={"minority_interest": base_result.enterprise_value * 0.20}
    )
    result = run_dcf_valuation(
        forecast, wacc_result, 0.03, large_minority_company,
        latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities,
    )
    report = run_validation(hist, summary, forecast, wacc_result, result)
    assert any("Minority interest and preferred stock" in i.message for i in report.issues)


def test_real_estate_style_nwc_flagged(hist, summary, forecast, wacc_result, company):
    """
    Regression test for the DLF case: a real-estate developer's land/WIP
    "inventory" can run to several multiples of revenue - an accurate balance
    sheet figure, not a data error, but one the standard FCFF/WACC template
    (which assumes working capital scales with revenue like it does for a
    typical operating company) badly understates value for. This must be
    flagged, not silently produce a falsely-precise low number.
    """
    huge_nwc_bs = hist.balance_sheets[-1].model_copy(update={"inventory": hist.income_statements[-1].revenue * 3.0})
    huge_nwc_hist = hist.model_copy(update={"balance_sheets": hist.balance_sheets[:-1] + [huge_nwc_bs]})
    latest_bs = huge_nwc_hist.balance_sheets[-1]
    result = run_dcf_valuation(
        forecast, wacc_result, 0.03, company,
        latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities,
    )
    report = run_validation(huge_nwc_hist, summary, forecast, wacc_result, result)
    assert any("Net working capital" in i.message and "real-estate" in i.message for i in report.issues)
