"""
Integration tests covering the Phase 1 vertical slice pipeline end to end
(spec section 40): historicals -> forecast -> DCF -> scenarios ->
sensitivities, and assumption-change -> full recalculation.
"""
import pytest

from ..engine.forecast import project_financials
from ..engine.scenarios import run_all_scenarios
from ..engine.sensitivity import ValuationContext, wacc_vs_growth_table
from ..engine.valuation import run_dcf_valuation
from ..engine.validation import run_validation


def test_full_pipeline_produces_consistent_valuation(hist, summary, forecast, wacc_result, company):
    latest_bs = hist.balance_sheets[-1]
    valuation = run_dcf_valuation(
        forecast, wacc_result, 0.03, company,
        latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities, exit_multiple=14.0,
    )
    assert valuation.enterprise_value > 0
    assert valuation.equity_bridge.equity_value_per_share is not None

    report = run_validation(hist, summary, forecast, wacc_result, valuation)
    assert report.score >= 0


def test_assumption_change_triggers_full_recalculation(hist, assumptions, wacc_result, company):
    latest_bs = hist.balance_sheets[-1]
    baseline_forecast = project_financials(hist, assumptions)
    baseline_valuation = run_dcf_valuation(
        baseline_forecast, wacc_result, 0.03, company,
        latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities,
    )

    updated = assumptions.model_copy(deep=True)
    updated.revenue_growth = [a.overridden(a.effective_value + 0.05) for a in updated.revenue_growth]
    updated_forecast = project_financials(hist, updated)
    updated_valuation = run_dcf_valuation(
        updated_forecast, wacc_result, 0.03, company,
        latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities,
    )

    # Higher revenue growth for every year must flow through to higher EV -- proves the whole
    # chain (forecast -> FCFF -> discounting -> EV) recalculates from a single assumption edit.
    assert updated_valuation.enterprise_value > baseline_valuation.enterprise_value
    assert updated_forecast.years[0].revenue > baseline_forecast.years[0].revenue


def test_scenarios_feed_from_same_base_assumptions(hist, summary, company, assumptions, wacc_inputs):
    latest_bs = hist.balance_sheets[-1]
    scenarios = run_all_scenarios(
        hist=hist, summary=summary, company=company, base_assumptions=assumptions,
        base_wacc_inputs=wacc_inputs, base_terminal_growth=0.03,
        cash_and_investments=latest_bs.total_cash_and_investments, total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
    )
    for scenario in scenarios.values():
        assert len(scenario.forecast.years) == len(assumptions.forecast_years)


def test_sensitivity_table_covers_full_grid(hist, assumptions, wacc_result, company):
    latest_bs = hist.balance_sheets[-1]
    ctx = ValuationContext(
        cash_and_investments=latest_bs.total_cash_and_investments,
        total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
    )
    wacc_range = [wacc_result.wacc - 0.01, wacc_result.wacc, wacc_result.wacc + 0.01]
    growth_range = [0.02, 0.03, 0.04]
    table = wacc_vs_growth_table(hist, assumptions, wacc_result, company, ctx, wacc_range, growth_range)
    assert len(table.cells) == len(wacc_range) * len(growth_range)
    center = table.value_at(wacc_result.wacc, 0.03)
    assert center is not None
    assert center.enterprise_value > 0


def test_excel_export_produces_file(tmp_path, company, hist, summary, forecast, wacc_result):
    from ..engine.sensitivity import rank_valuation_drivers
    from ..engine.scenarios import run_all_scenarios
    from ..data.sample_wacc import build_orion_wacc_inputs
    from ..export.excel_export import export_dcf_to_excel

    latest_bs = hist.balance_sheets[-1]
    valuation = run_dcf_valuation(
        forecast, wacc_result, 0.03, company,
        latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities, exit_multiple=14.0,
    )
    report = run_validation(hist, summary, forecast, wacc_result, valuation)
    wacc_inputs = build_orion_wacc_inputs(hist, company.current_share_price, company.diluted_shares_outstanding)
    scenarios = run_all_scenarios(
        hist=hist, summary=summary, company=company, base_assumptions=forecast.assumptions,
        base_wacc_inputs=wacc_inputs, base_terminal_growth=0.03,
        cash_and_investments=latest_bs.total_cash_and_investments, total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
    )
    ctx = ValuationContext(
        cash_and_investments=latest_bs.total_cash_and_investments,
        total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
    )
    table = wacc_vs_growth_table(hist, forecast.assumptions, wacc_result, company, ctx, [0.09, 0.10, 0.11], [0.02, 0.03, 0.04])
    ranking = rank_valuation_drivers(hist, forecast.assumptions, wacc_result, 0.03, company, ctx)

    out_path = tmp_path / "test_export.xlsx"
    export_dcf_to_excel(str(out_path), company, hist, summary, forecast, wacc_result, valuation, scenarios, table, ranking, report)
    assert out_path.exists()
    assert out_path.stat().st_size > 0
