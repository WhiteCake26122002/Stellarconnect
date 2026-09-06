"""
Tests for the mutual-fund rule-based observation engine (backend/mutual_funds/recommend.py).
Pure functions over synthetic portfolio data - no network involved.
"""
from ..mutual_funds.recommend import build_flags


def _holding(name, category, value, return_1y, data_available=True):
    return {
        "scheme_name": name, "scheme_category": category, "value": value,
        "return_1y": return_1y, "data_available": data_available,
    }


def test_no_flags_for_a_small_balanced_portfolio():
    # Three evenly-weighted holdings across three categories: no single fund
    # dominates (below the 40% concentration threshold), no category has 3+
    # funds, and no fund is negative or lagging far behind its peers.
    holdings = [
        _holding("Fund A", "Equity - Large Cap", 3400, 12.0),
        _holding("Fund B", "Debt - Short Duration", 3300, 6.0),
        _holding("Fund C", "Hybrid - Balanced Advantage", 3300, 9.0),
    ]
    assert build_flags(holdings) == []


def test_concentration_flag_when_one_holding_dominates():
    holdings = [
        _holding("Fund A", "Equity - Large Cap", 9000, 12.0),
        _holding("Fund B", "Debt - Short Duration", 1000, 6.0),
    ]
    flags = build_flags(holdings)
    assert any("Fund A" in f.title and "90%" in f.title for f in flags)


def test_no_concentration_flag_with_a_single_holding():
    holdings = [_holding("Fund A", "Equity - Large Cap", 9000, 12.0)]
    flags = build_flags(holdings)
    assert not any("portfolio" in f.title for f in flags)


def test_negative_return_flag():
    holdings = [
        _holding("Fund A", "Equity - Large Cap", 5000, -8.5),
        _holding("Fund B", "Debt - Short Duration", 5000, 6.0),
    ]
    flags = build_flags(holdings)
    assert any("Fund A" in f.title and "down" in f.title for f in flags)


def test_category_overlap_flag_with_three_or_more_in_same_category():
    holdings = [
        _holding("Fund A", "Equity - Large Cap", 3000, 10.0),
        _holding("Fund B", "Equity - Large Cap", 3000, 11.0),
        _holding("Fund C", "Equity - Large Cap", 3000, 9.0),
    ]
    flags = build_flags(holdings)
    assert any("3 funds in 'Equity - Large Cap'" in f.title for f in flags)


def test_no_category_overlap_flag_with_only_two_in_same_category():
    holdings = [
        _holding("Fund A", "Equity - Large Cap", 3000, 10.0),
        _holding("Fund B", "Equity - Large Cap", 3000, 11.0),
    ]
    flags = build_flags(holdings)
    assert not any("funds in" in f.title for f in flags)


def test_underperformer_flag_against_same_category_peers():
    holdings = [
        _holding("Fund A", "Equity - Large Cap", 3000, 20.0),
        _holding("Fund B", "Equity - Large Cap", 3000, 2.0),
    ]
    flags = build_flags(holdings)
    assert any("Fund B" in f.title and "lags its peers" in f.title for f in flags)
    assert not any("Fund A" in f.title and "lags" in f.title for f in flags)


def test_missing_data_flag_for_unavailable_scheme():
    holdings = [
        _holding("Fund A", "Equity - Large Cap", 5000, 12.0),
        _holding("Fund B", "Unknown", 0.0, None, data_available=False),
    ]
    flags = build_flags(holdings)
    assert any("No live NAV data for Fund B" in f.title for f in flags)
