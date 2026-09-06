"""
Tests for the pure calculation helpers in backend/mutual_funds/nav.py.
Uses synthetic NAV history, never touches the network.
"""
import datetime as dt

import pytest

from ..mutual_funds.nav import latest_nav, search_schemes, trailing_return_pct


def _detail(history_pairs):
    """history_pairs: list of (days_ago, nav) from an arbitrary 'today'."""
    today = dt.date(2026, 1, 1)
    history = [(today - dt.timedelta(days=d), nav) for d, nav in history_pairs]
    history.sort(key=lambda pair: pair[0], reverse=True)
    return {"nav_history": history}


def test_latest_nav_returns_most_recent_entry():
    detail = _detail([(0, 100.0), (30, 90.0), (400, 50.0)])
    date, nav = latest_nav(detail)
    assert nav == 100.0


def test_trailing_return_sub_year_is_simple_percent_change():
    detail = _detail([(0, 110.0), (30, 100.0)])
    result = trailing_return_pct(detail, 30)
    assert result == pytest.approx(10.0)


def test_trailing_return_one_year_is_annualized():
    detail = _detail([(0, 121.0), (730, 100.0)])  # doubled cash-on-cash over 2 years
    result = trailing_return_pct(detail, 730)
    assert result == pytest.approx(10.0, abs=0.5)  # ~10% CAGR over 2 years


def test_trailing_return_none_when_history_too_short():
    detail = _detail([(0, 100.0), (30, 95.0)])
    assert trailing_return_pct(detail, 1095) is None  # asking for 3Y on ~1 month of history


def test_search_schemes_is_case_insensitive_substring_match():
    schemes = [{"code": 1, "name": "HDFC Flexi Cap Fund"}, {"code": 2, "name": "SBI Small Cap Fund"}]
    results = search_schemes("flexi", schemes)
    assert [s["code"] for s in results] == [1]


def test_search_schemes_returns_empty_for_blank_query():
    schemes = [{"code": 1, "name": "HDFC Flexi Cap Fund"}]
    assert search_schemes("   ", schemes) == []
