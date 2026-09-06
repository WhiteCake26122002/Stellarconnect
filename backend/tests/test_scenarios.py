import pytest

from ..engine.scenarios import run_all_scenarios


@pytest.fixture
def scenarios(hist, summary, company, assumptions, wacc_inputs):
    latest_bs = hist.balance_sheets[-1]
    return run_all_scenarios(
        hist=hist,
        summary=summary,
        company=company,
        base_assumptions=assumptions,
        base_wacc_inputs=wacc_inputs,
        base_terminal_growth=0.03,
        cash_and_investments=latest_bs.total_cash_and_investments,
        total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
    )


def test_all_three_scenarios_present(scenarios):
    assert set(scenarios.keys()) == {"Bear Case", "Base Case", "Bull Case"}


def test_bull_ev_exceeds_base_exceeds_bear(scenarios):
    bear_ev = scenarios["Bear Case"].valuation.enterprise_value
    base_ev = scenarios["Base Case"].valuation.enterprise_value
    bull_ev = scenarios["Bull Case"].valuation.enterprise_value
    assert bear_ev < base_ev < bull_ev


def test_bull_revenue_cagr_exceeds_bear(scenarios):
    assert scenarios["Bull Case"].revenue_cagr > scenarios["Bear Case"].revenue_cagr


def test_bull_wacc_lower_than_bear(scenarios):
    assert scenarios["Bull Case"].wacc_result.wacc < scenarios["Bear Case"].wacc_result.wacc


def test_base_case_has_no_deltas_applied_to_definition():
    from ..engine.scenarios import BASE_CASE

    assert BASE_CASE.revenue_growth_delta == 0.0
    assert BASE_CASE.wacc_delta == 0.0
