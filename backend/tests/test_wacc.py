import pytest

from ..engine.wacc import calculate_wacc, relever_beta, unlever_beta
from ..engine.models import Assumption, AssumptionSource
from ..engine.wacc import WaccInputs


def _assumption(value, name="x"):
    return Assumption(name=name, value=value, source=AssumptionSource.USER_ASSUMPTION)


def test_wacc_matches_manual_formula(wacc_inputs, wacc_result):
    rf = wacc_inputs.risk_free_rate.effective_value
    beta = wacc_inputs.beta.effective_value
    erp = wacc_inputs.equity_risk_premium.effective_value
    ke = rf + beta * erp
    kd_at = wacc_inputs.pretax_cost_of_debt.effective_value * (1 - wacc_inputs.tax_rate.effective_value)
    e = wacc_inputs.market_value_of_equity.effective_value
    d = wacc_inputs.market_value_of_debt.effective_value
    expected_wacc = (e / (d + e)) * ke + (d / (d + e)) * kd_at
    assert wacc_result.wacc == pytest.approx(expected_wacc)


def test_cost_of_equity_capm(wacc_result, wacc_inputs):
    expected = (
        wacc_inputs.risk_free_rate.effective_value
        + wacc_inputs.beta.effective_value * wacc_inputs.equity_risk_premium.effective_value
    )
    assert wacc_result.cost_of_equity == pytest.approx(expected)


def test_weights_sum_to_one(wacc_result):
    assert wacc_result.equity_weight + wacc_result.debt_weight == pytest.approx(1.0)


def test_zero_capital_raises():
    inputs = WaccInputs(
        risk_free_rate=_assumption(0.04),
        beta=_assumption(1.0),
        equity_risk_premium=_assumption(0.05),
        size_premium=_assumption(0.0),
        pretax_cost_of_debt=_assumption(0.05),
        tax_rate=_assumption(0.25),
        market_value_of_equity=_assumption(0.0),
        market_value_of_debt=_assumption(0.0),
    )
    with pytest.raises(ValueError):
        calculate_wacc(inputs)


def test_unlever_relever_beta_roundtrip():
    levered = 1.3
    d_e = 0.4
    tax = 0.25
    unlevered = unlever_beta(levered, d_e, tax)
    relevered = relever_beta(unlevered, d_e, tax)
    assert relevered == pytest.approx(levered)


def test_unlevering_reduces_beta_when_debt_present():
    unlevered = unlever_beta(1.3, 0.4, 0.25)
    assert unlevered < 1.3
