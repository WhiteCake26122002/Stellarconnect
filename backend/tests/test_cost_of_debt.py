import pytest

from ..engine.cost_of_debt import estimate_pretax_cost_of_debt, synthetic_rating_and_spread


def test_high_coverage_maps_to_aaa():
    rating, spread = synthetic_rating_and_spread(20.0)
    assert rating == "Aaa/AAA"
    assert spread == pytest.approx(0.0040)


def test_low_coverage_maps_to_default_tier():
    rating, spread = synthetic_rating_and_spread(0.1)
    assert rating == "D2/D"
    assert spread == pytest.approx(0.19)


def test_mid_coverage_maps_to_investment_grade():
    # 3.5x coverage should land in the A3/A- bucket (3.0 < icr <= 4.25).
    rating, spread = synthetic_rating_and_spread(3.5)
    assert rating == "A3/A-"
    assert spread == pytest.approx(0.0089)


def test_boundary_is_inclusive_on_upper_end():
    # Exactly the table's stated upper bound for Baa2/BBB (2.999999) should still land in that bucket,
    # not roll over into the next one.
    rating, _ = synthetic_rating_and_spread(2.999999)
    assert rating == "Baa2/BBB"


def test_cost_of_debt_equals_risk_free_plus_spread():
    result = estimate_pretax_cost_of_debt(risk_free_rate=0.065, ebit=1000.0, interest_expense=200.0)
    # ICR = 5.0 -> A2/A bucket (4.25 < 5.0 <= 5.5) -> spread 0.78%
    assert result.interest_coverage_ratio == pytest.approx(5.0)
    assert result.synthetic_rating == "A2/A"
    assert result.default_spread == pytest.approx(0.0078)
    assert result.pretax_cost_of_debt == pytest.approx(0.065 + 0.0078)


def test_zero_interest_expense_defaults_to_safest_tier_not_a_crash():
    result = estimate_pretax_cost_of_debt(risk_free_rate=0.07, ebit=500.0, interest_expense=0.0)
    assert result.interest_coverage_ratio is None
    assert result.synthetic_rating == "Aaa/AAA"
    assert result.pretax_cost_of_debt == pytest.approx(0.07 + 0.0040)


def test_negative_ebit_maps_to_worst_tier():
    result = estimate_pretax_cost_of_debt(risk_free_rate=0.07, ebit=-50.0, interest_expense=100.0)
    assert result.synthetic_rating == "D2/D"
    assert result.default_spread == pytest.approx(0.19)


def test_rationale_discloses_source_and_formula():
    result = estimate_pretax_cost_of_debt(risk_free_rate=0.065, ebit=1000.0, interest_expense=200.0, period_label="FY2026")
    assert "Damodaran" in result.rationale
    assert "FY2026" in result.rationale
    assert "5.00x" in result.rationale
