import pytest

from ..engine.terminal_value import (
    compare_terminal_value_methods,
    exit_multiple_terminal_value,
    gordon_growth_terminal_value,
)


def test_gordon_growth_matches_formula():
    fcf, wacc, g = 100.0, 0.10, 0.03
    expected = (fcf * (1 + g)) / (wacc - g)
    assert gordon_growth_terminal_value(fcf, wacc, g) == pytest.approx(expected)


def test_gordon_growth_raises_when_wacc_equals_growth():
    with pytest.raises(ValueError):
        gordon_growth_terminal_value(100.0, 0.05, 0.05)


def test_gordon_growth_raises_when_wacc_below_growth():
    with pytest.raises(ValueError):
        gordon_growth_terminal_value(100.0, 0.04, 0.05)


def test_exit_multiple_matches_formula():
    assert exit_multiple_terminal_value(200.0, 12.0) == pytest.approx(2400.0)


def test_exit_multiple_rejects_non_positive_multiple():
    with pytest.raises(ValueError):
        exit_multiple_terminal_value(200.0, 0.0)


def test_compare_methods_returns_both_when_multiple_given():
    results = compare_terminal_value_methods(100.0, 200.0, 0.10, 0.03, 12.0)
    assert "gordon_growth" in results
    assert "exit_multiple" in results
    assert results["exit_multiple"].exit_multiple_value == pytest.approx(2400.0)


def test_compare_methods_omits_exit_multiple_when_not_given():
    results = compare_terminal_value_methods(100.0, 200.0, 0.10, 0.03, None)
    assert "exit_multiple" not in results
