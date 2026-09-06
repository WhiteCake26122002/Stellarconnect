import pytest

from ..engine.sensitivity import (
    ValuationContext,
    rank_valuation_drivers,
    revenue_growth_sensitivity,
    wacc_sensitivity,
    wacc_vs_growth_table,
)


@pytest.fixture
def ctx(hist):
    latest_bs = hist.balance_sheets[-1]
    return ValuationContext(
        cash_and_investments=latest_bs.total_cash_and_investments,
        total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
    )


def test_wacc_vs_growth_table_shape(hist, assumptions, wacc_result, company, ctx):
    table = wacc_vs_growth_table(
        hist, assumptions, wacc_result, company, ctx, wacc_range=[0.08, 0.09, 0.10], growth_range=[0.02, 0.03]
    )
    assert len(table.cells) == 6


def test_wacc_vs_growth_table_ev_decreases_as_wacc_increases(hist, assumptions, wacc_result, company, ctx):
    table = wacc_vs_growth_table(
        hist, assumptions, wacc_result, company, ctx, wacc_range=[0.08, 0.10, 0.12], growth_range=[0.03]
    )
    ev_low_wacc = table.value_at(0.08, 0.03).enterprise_value
    ev_high_wacc = table.value_at(0.12, 0.03).enterprise_value
    assert ev_low_wacc > ev_high_wacc


def test_wacc_vs_growth_table_ev_increases_with_growth(hist, assumptions, wacc_result, company, ctx):
    table = wacc_vs_growth_table(
        hist, assumptions, wacc_result, company, ctx, wacc_range=[0.10], growth_range=[0.02, 0.03, 0.04]
    )
    ev_low_g = table.value_at(0.10, 0.02).enterprise_value
    ev_high_g = table.value_at(0.10, 0.04).enterprise_value
    assert ev_high_g > ev_low_g


def test_invalid_wacc_growth_combo_returns_nan(hist, assumptions, wacc_result, company, ctx):
    table = wacc_vs_growth_table(hist, assumptions, wacc_result, company, ctx, wacc_range=[0.03], growth_range=[0.05])
    cell = table.value_at(0.03, 0.05)
    assert cell.enterprise_value != cell.enterprise_value  # NaN


def test_revenue_growth_sensitivity_monotonic(hist, assumptions, wacc_result, company, ctx):
    result = revenue_growth_sensitivity(hist, assumptions, wacc_result, 0.03, company, ctx, [-0.02, 0.0, 0.02])
    evs = [p.enterprise_value for p in result.points]
    assert evs[0] < evs[1] < evs[2]


def test_wacc_sensitivity_inverse_relationship(hist, assumptions, wacc_result, company, ctx):
    result = wacc_sensitivity(hist, assumptions, wacc_result, 0.03, company, ctx, [-0.01, 0.0, 0.01])
    evs = [p.enterprise_value for p in result.points]
    assert evs[0] > evs[1] > evs[2]


def test_rank_valuation_drivers_sorted_descending(hist, assumptions, wacc_result, company, ctx):
    ranking = rank_valuation_drivers(hist, assumptions, wacc_result, 0.03, company, ctx)
    impacts = [d.impact_range_pct for d in ranking]
    assert impacts == sorted(impacts, reverse=True)
    assert len(ranking) == 5
