import pytest

from ..engine.valuation import bridge_to_equity_value, discount_cash_flows, run_dcf_valuation


def test_discount_factor_formula():
    discounted, total = discount_cash_flows([100.0, 110.0], ["Y1", "Y2"], 0.10)
    assert discounted[0].discount_factor == pytest.approx(1 / 1.10)
    assert discounted[1].discount_factor == pytest.approx(1 / 1.10 ** 2)
    assert total == pytest.approx(100 / 1.10 + 110 / 1.10 ** 2)


def test_discount_cash_flows_empty():
    discounted, total = discount_cash_flows([], [], 0.10)
    assert discounted == []
    assert total == 0.0


def test_equity_bridge_formula():
    bridge = bridge_to_equity_value(
        enterprise_value=1000.0,
        cash_and_investments=100.0,
        total_debt=300.0,
        lease_liabilities=50.0,
        minority_interest=20.0,
        preferred_stock=10.0,
        diluted_shares_outstanding=100.0,
        current_share_price=8.0,
    )
    expected_equity = 1000.0 + 100.0 - 300.0 - 50.0 - 20.0 - 10.0
    assert bridge.equity_value == pytest.approx(expected_equity)
    assert bridge.equity_value_per_share == pytest.approx(expected_equity / 100.0)
    assert bridge.upside_downside == pytest.approx(bridge.equity_value_per_share / 8.0 - 1)


def test_equity_bridge_handles_missing_shares():
    bridge = bridge_to_equity_value(
        enterprise_value=1000.0,
        cash_and_investments=100.0,
        total_debt=300.0,
        lease_liabilities=0.0,
        minority_interest=0.0,
        preferred_stock=0.0,
        diluted_shares_outstanding=None,
        current_share_price=None,
    )
    assert bridge.equity_value_per_share is None
    assert bridge.upside_downside is None


def test_run_dcf_valuation_end_to_end(forecast, wacc_result, company, hist):
    latest_bs = hist.balance_sheets[-1]
    result = run_dcf_valuation(
        forecast=forecast,
        wacc_result=wacc_result,
        terminal_growth=0.03,
        company=company,
        cash_and_investments=latest_bs.total_cash_and_investments,
        total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
    )
    assert result.enterprise_value == pytest.approx(result.pv_of_explicit_fcf + result.pv_of_terminal_value)
    assert result.equity_bridge.equity_value > 0
    assert 0 <= result.terminal_value_pct_of_ev <= 1


def test_run_dcf_valuation_raises_when_wacc_leq_growth(forecast, wacc_result, company, hist):
    latest_bs = hist.balance_sheets[-1]
    with pytest.raises(ValueError):
        run_dcf_valuation(
            forecast=forecast,
            wacc_result=wacc_result,
            terminal_growth=wacc_result.wacc + 0.01,
            company=company,
            cash_and_investments=latest_bs.total_cash_and_investments,
            total_debt=latest_bs.total_debt,
            lease_liabilities=latest_bs.lease_liabilities,
        )


def test_zero_debt_and_cash_still_values(forecast, wacc_result, company):
    result = run_dcf_valuation(
        forecast=forecast,
        wacc_result=wacc_result,
        terminal_growth=0.03,
        company=company,
        cash_and_investments=0.0,
        total_debt=0.0,
        lease_liabilities=0.0,
    )
    assert result.equity_bridge.equity_value == pytest.approx(result.enterprise_value)
