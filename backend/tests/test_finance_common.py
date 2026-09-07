"""
Tests for backend/common/finance.py - the shared XIRR/beta/alpha math used
by both the Mutual Fund and Paper Trading analysis pages. No network.
"""
import datetime as dt

import pytest

from ..common.finance import aligned_returns, beta, daily_returns_from_history, jensens_alpha


def test_daily_returns_from_history_computes_percent_change():
    history = [(dt.date(2026, 1, 1), 100.0), (dt.date(2026, 1, 2), 110.0), (dt.date(2026, 1, 3), 99.0)]
    returns = daily_returns_from_history(history)
    assert returns[dt.date(2026, 1, 2)] == pytest.approx(0.10)
    assert returns[dt.date(2026, 1, 3)] == pytest.approx(-0.10)
    assert dt.date(2026, 1, 1) not in returns


def test_daily_returns_from_history_sorts_unsorted_input():
    history = [(dt.date(2026, 1, 2), 110.0), (dt.date(2026, 1, 1), 100.0)]
    returns = daily_returns_from_history(history)
    assert returns[dt.date(2026, 1, 2)] == pytest.approx(0.10)


def test_aligned_returns_restricts_to_common_dates():
    a = {dt.date(2026, 1, 1): 0.01, dt.date(2026, 1, 2): 0.02, dt.date(2026, 1, 3): 0.03}
    b = {dt.date(2026, 1, 2): 0.05, dt.date(2026, 1, 3): 0.06, dt.date(2026, 1, 4): 0.07}
    ra, rb = aligned_returns(a, b)
    assert ra == [0.02, 0.03]
    assert rb == [0.05, 0.06]


def test_beta_of_a_series_with_itself_is_one():
    series = [0.01, -0.02, 0.03, 0.015, -0.01, 0.02, -0.005]
    assert beta(series, series) == pytest.approx(1.0)


def test_beta_of_a_double_leveraged_series_is_two():
    benchmark = [0.01, -0.02, 0.03, 0.015, -0.01, 0.02, -0.005]
    leveraged = [2 * x for x in benchmark]
    assert beta(leveraged, benchmark) == pytest.approx(2.0)


def test_beta_none_with_fewer_than_two_points():
    assert beta([0.01], [0.02]) is None


def test_beta_none_when_benchmark_has_zero_variance():
    assert beta([0.01, 0.02, 0.03], [0.0, 0.0, 0.0]) is None


def test_jensens_alpha_zero_when_return_matches_capm_expectation():
    # Rf=5%, beta=1.2, Rm=10% -> expected = 5 + 1.2*(10-5) = 11%
    alpha = jensens_alpha(portfolio_return_pct=11.0, benchmark_return_pct=10.0, beta_value=1.2, risk_free_rate_pct=5.0)
    assert alpha == pytest.approx(0.0)


def test_jensens_alpha_positive_when_outperforming_capm_expectation():
    alpha = jensens_alpha(portfolio_return_pct=15.0, benchmark_return_pct=10.0, beta_value=1.0, risk_free_rate_pct=5.0)
    assert alpha == pytest.approx(5.0)


def test_jensens_alpha_negative_when_underperforming_capm_expectation():
    alpha = jensens_alpha(portfolio_return_pct=5.0, benchmark_return_pct=10.0, beta_value=1.0, risk_free_rate_pct=5.0)
    assert alpha == pytest.approx(-5.0)
