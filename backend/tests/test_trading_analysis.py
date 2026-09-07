"""
Tests for backend/trading/analysis.py - the Paper Trading benchmark/beta
orchestration built on top of backend.common.finance. No network.
"""
import datetime as dt

import pytest

from ..trading.analysis import account_return_pct, benchmark_return_pct, portfolio_beta, stock_beta


def test_account_return_doubling_in_one_year_is_roughly_100_percent():
    result = account_return_pct(dt.date(2025, 1, 1), dt.date(2026, 1, 1), 1_000_000.0, 2_000_000.0)
    assert result == pytest.approx(100.0, abs=1.0)


def test_account_return_none_when_created_today():
    result = account_return_pct(dt.date(2026, 1, 1), dt.date(2026, 1, 1), 1_000_000.0, 1_050_000.0)
    assert result is None


def test_benchmark_return_matches_index_growth():
    history = [(dt.date(2025, 1, 1), 100.0), (dt.date(2026, 1, 1), 120.0)]
    result = benchmark_return_pct(dt.date(2025, 1, 1), dt.date(2026, 1, 1), 1_000_000.0, history)
    assert result == pytest.approx(20.0, abs=0.5)


def test_benchmark_return_none_when_history_missing():
    result = benchmark_return_pct(dt.date(2025, 1, 1), dt.date(2026, 1, 1), 1_000_000.0, [])
    assert result is None


def test_stock_beta_of_index_against_itself_is_one():
    history = [(dt.date(2026, 1, 1) + dt.timedelta(days=i), 100.0 * (1.001 ** i)) for i in range(30)]
    assert stock_beta(history, history) == pytest.approx(1.0, abs=1e-6)


def test_stock_beta_none_when_no_overlapping_dates():
    a = [(dt.date(2026, 1, 1), 100.0), (dt.date(2026, 1, 2), 101.0)]
    b = [(dt.date(2027, 1, 1), 100.0), (dt.date(2027, 1, 2), 101.0)]
    assert stock_beta(a, b) is None


def test_portfolio_beta_weights_by_holding_value():
    # One stock at beta 2.0 worth 6000, one at beta 0.5 worth 4000: (2*6000 + 0.5*4000) / 10000 = 1.4
    result = portfolio_beta([(2.0, 6000.0), (0.5, 4000.0)], cash_value=0.0)
    assert result == pytest.approx(1.4)


def test_portfolio_beta_with_idle_cash_pulls_toward_zero():
    # One stock at beta 2.0 worth 5000, plus 5000 idle cash (beta 0): (2*5000 + 0*5000) / 10000 = 1.0
    result = portfolio_beta([(2.0, 5000.0)], cash_value=5000.0)
    assert result == pytest.approx(1.0)


def test_portfolio_beta_none_when_no_value_at_all():
    assert portfolio_beta([], cash_value=0.0) is None
