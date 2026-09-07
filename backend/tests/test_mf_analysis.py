"""
Tests for the pure portfolio-analysis math in backend/mutual_funds/analysis.py.
No network involved - benchmark history is supplied as synthetic data.
"""
import datetime as dt

import pytest

from ..mutual_funds.analysis import (
    amc_breakdown,
    benchmark_equivalent_value,
    classify_asset_class,
    classify_market_cap,
    price_on_or_before,
    weighted_breakdown,
    xirr,
)


def test_xirr_doubling_money_in_one_year_is_roughly_100_percent():
    flows = [(dt.date(2025, 1, 1), -10000.0), (dt.date(2026, 1, 1), 20000.0)]
    assert xirr(flows) == pytest.approx(100.0, abs=1.0)


def test_xirr_flat_return_is_roughly_zero():
    flows = [(dt.date(2025, 1, 1), -10000.0), (dt.date(2026, 1, 1), 10000.0)]
    assert xirr(flows) == pytest.approx(0.0, abs=0.5)


def test_xirr_none_with_fewer_than_two_flows():
    assert xirr([(dt.date(2025, 1, 1), -10000.0)]) is None


def test_xirr_none_when_all_flows_are_the_same_sign():
    flows = [(dt.date(2025, 1, 1), -1000.0), (dt.date(2025, 6, 1), -500.0)]
    assert xirr(flows) is None


def test_xirr_none_when_all_flows_land_on_the_same_date():
    # Same-day buy and "sell" - no time elapsed, no meaningful annualized rate.
    flows = [(dt.date(2026, 1, 1), -10000.0), (dt.date(2026, 1, 1), 11000.0)]
    assert xirr(flows) is None


def test_price_on_or_before_finds_the_most_recent_match():
    history = [(dt.date(2026, 1, 1), 100.0), (dt.date(2026, 1, 5), 110.0), (dt.date(2026, 1, 10), 120.0)]
    assert price_on_or_before(history, dt.date(2026, 1, 7)) == 110.0


def test_price_on_or_before_returns_none_when_target_predates_history():
    history = [(dt.date(2026, 1, 5), 110.0)]
    assert price_on_or_before(history, dt.date(2026, 1, 1)) is None


def test_price_on_or_before_works_with_descending_input():
    # AMFI-style NAV history (backend/mutual_funds/nav.py) is stored most-recent-first, unlike
    # the ascending market-data history most other callers pass - must not silently return the
    # oldest price in history when given this order.
    history = [(dt.date(2026, 1, 10), 120.0), (dt.date(2026, 1, 5), 110.0), (dt.date(2026, 1, 1), 100.0)]
    assert price_on_or_before(history, dt.date(2026, 1, 7)) == 110.0


def test_benchmark_equivalent_value_scales_by_index_growth():
    history = [(dt.date(2025, 1, 1), 100.0), (dt.date(2026, 1, 1), 110.0)]
    result = benchmark_equivalent_value(10000.0, dt.date(2025, 1, 1), dt.date(2026, 1, 1), history)
    assert result == pytest.approx(11000.0)


def test_benchmark_equivalent_value_none_when_history_missing_a_date():
    history = [(dt.date(2026, 1, 1), 110.0)]
    assert benchmark_equivalent_value(10000.0, dt.date(2025, 1, 1), dt.date(2026, 1, 1), history) is None


@pytest.mark.parametrize("category,expected", [
    ("Equity Scheme - Large Cap Fund", "Equity"),
    ("Debt Scheme - Banking and PSU Fund", "Debt"),
    ("Hybrid Scheme - Balanced Advantage", "Hybrid"),
    ("Other Scheme - Index Fund", "Index/ETF"),
    ("Solution Oriented Scheme - Retirement Fund", "Other"),
])
def test_classify_asset_class(category, expected):
    assert classify_asset_class(category) == expected


@pytest.mark.parametrize("category,expected", [
    ("Equity Scheme - Large Cap Fund", "Large Cap"),
    ("Equity Scheme - Mid Cap Fund", "Mid Cap"),
    ("Equity Scheme - Small Cap Fund", "Small Cap"),
    ("Equity Scheme - Flexi Cap Fund", "Flexi Cap"),
    ("Equity Scheme - ELSS", "ELSS (Tax Saver)"),
    ("Equity Scheme - Sectoral/Thematic", "Other Equity"),
])
def test_classify_market_cap(category, expected):
    assert classify_market_cap(category) == expected


def test_weighted_breakdown_computes_value_weighted_percentages():
    rows = [
        {"scheme_category": "Equity Scheme - Large Cap Fund", "value": 7000.0},
        {"scheme_category": "Debt Scheme - Liquid Fund", "value": 3000.0},
    ]
    result = weighted_breakdown(rows, classify_asset_class)
    assert result == pytest.approx({"Equity": 70.0, "Debt": 30.0})


def test_weighted_breakdown_empty_when_total_value_is_zero():
    rows = [{"scheme_category": "Equity Scheme - Large Cap Fund", "value": 0.0}]
    assert weighted_breakdown(rows, classify_asset_class) == {}


def test_amc_breakdown_computes_value_weighted_percentages():
    rows = [
        {"fund_house": "HDFC Mutual Fund", "value": 6000.0},
        {"fund_house": "SBI Mutual Fund", "value": 4000.0},
    ]
    assert amc_breakdown(rows) == pytest.approx({"HDFC Mutual Fund": 60.0, "SBI Mutual Fund": 40.0})
