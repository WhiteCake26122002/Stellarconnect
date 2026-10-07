"""
End-to-end tests for backend/mutual_funds/portfolio.py with synthetic NAV and index histories.
These reproduce the scenarios that used to mislead: a ten-day window shown as an annual rate,
a fund compared with an unrelated index, new money counted as return.
"""
from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass

import pytest

from ..mutual_funds import benchmarks, consistency, costs, nav, portfolio

D = dt.date
TODAY = D(2026, 10, 5)


def paid(units: float, nav_: float, day: D) -> float:
    """What a purchase of `units` at `nav_` cost: units x NAV plus the stamp duty taken out of the money paid."""
    return units * nav_ + costs.gross_from_units(units, nav_, day)["stamp_duty"]


@dataclass
class H:
    scheme_code: int
    scheme_name: str
    units: float
    avg_nav: float
    purchase_date: str


@dataclass
class T:
    scheme_code: int
    kind: str
    trade_date: str
    units: float
    nav: float
    source: str = "entered"


def _path(start: D, days: int, v0: float, v1: float, *, then: tuple[int, float] | None = None):
    """Daily levels growing geometrically from v0 to v1 over `days` (and optionally on to a later level)."""
    pts = []
    for i in range(days + 1):
        pts.append((start + dt.timedelta(days=i), v0 * (v1 / v0) ** (i / days)))
    if then:
        extra, v2 = then
        for i in range(1, extra + 1):
            pts.append((start + dt.timedelta(days=days + i), v1 * (v2 / v1) ** (i / extra)))
    return pts


def _detail(history, *, category="Equity Scheme - Flexi Cap Fund", house="Test AMC", name="Test Flexi Cap Fund - Direct Plan - Growth"):
    return {
        "fund_house": house, "scheme_category": category, "scheme_name": name,
        "nav_history": sorted(history, key=lambda p: p[0], reverse=True),
    }


@pytest.fixture
def market(monkeypatch):
    """Install per-scheme details and per-ticker index histories; returns the two dicts to fill."""
    details: dict[int, dict] = {}
    indices: dict[str, list] = {}
    monkeypatch.setattr(nav, "get_scheme_detail", lambda code: details.get(code))
    monkeypatch.setattr(nav, "get_index_history", lambda ticker: indices.get(ticker, []))
    return details, indices


def _all_indices(indices, start, days, v0, v1):
    for key, (ticker, _) in benchmarks.INDEX_TICKERS.items():
        indices[ticker] = _path(start, days, v0, v1)


# --------------------------------------------------------------------------- the reported bug

def test_ten_day_window_is_not_annualized_anywhere(market):
    details, indices = market
    start = D(2026, 9, 25)
    details[1] = _detail(_path(start - dt.timedelta(days=60), 70, 100.0, 98.0))  # ends 98 on 5 Oct (-2% since 25 Sep approx)
    _all_indices(indices, start - dt.timedelta(days=60), 70, 24_000.0, 23_376.0)
    holdings = [H(1, "Test Flexi Cap Fund - Direct Plan - Growth", 100.0, details[1]["nav_history"][-1][1], start.isoformat())]
    # buy at the published NAV on the purchase date
    px = [v for d, v in details[1]["nav_history"] if d == start][0]
    holdings[0].avg_nav = px

    r = portfolio.analysis_view(holdings, today=TODAY)

    assert r["ready"] and r["period"]["days"] == 10
    p = r["portfolio"]
    assert p["xirr"]["status"] == "short_history" and p["xirr"]["value"] is None
    assert p["cagr_pct"] is None
    assert p["absolute_return_pct"] == pytest.approx((98.0 / px - 1) * 100, abs=0.01)
    for b in r["benchmarks"]:
        assert b["xirr"]["annualized"] is False
        assert abs(b["return_pct"]) < 10  # a plain ten-day move, not "-62% a year"
    for f in r["funds"]:
        assert f["xirr"]["annualized"] is False
        assert f["verdict"] == "too_early"
    assert not r["blocked"]


def test_period_and_comparison_dates_are_identical_everywhere(market):
    details, indices = market
    start = D(2026, 6, 1)
    details[1] = _detail(_path(start - dt.timedelta(days=30), 156, 100.0, 108.0))
    _all_indices(indices, start - dt.timedelta(days=30), 156, 20_000.0, 21_000.0)
    px = dict(details[1]["nav_history"])[start]
    r = portfolio.analysis_view([H(1, "X Flexi Cap Fund - Direct Plan - Growth", 10.0, px, start.isoformat())], today=TODAY)
    assert r["period"]["start"] == "2026-06-01" and r["period"]["end"] == "2026-10-05"
    assert {b["period"]["label"] for b in r["benchmarks"]} == {r["period"]["label"]}
    for f in r["funds"]:
        assert f["period"]["end"] == r["period"]["end"]
        assert f["period"]["start"] == f["first_purchase"]
    assert next(c for c in r["checks"] if c["id"] == "period-alignment")["status"] == "ok"


def test_negative_fund_beating_a_more_negative_benchmark_is_labelled_precisely(market):
    details, indices = market
    start = D(2026, 6, 7)  # 120 days
    details[1] = _detail(_path(start - dt.timedelta(days=30), 150, 100.0, 94.8))
    _all_indices(indices, start - dt.timedelta(days=30), 150, 20_000.0, 18_580.0)
    px = dict(details[1]["nav_history"])[start]
    r = portfolio.analysis_view([H(1, "X Flexi Cap Fund - Direct Plan - Growth", 10.0, px, start.isoformat())], today=TODAY)
    f = r["funds"][0]
    assert f["fund_return_pct"] < 0 and f["benchmark"]["return_pct"] < 0
    assert f["verdict"] == "outperformed"
    assert f["relative_pp"] > 0
    assert "despite a negative absolute return" in f["verdict_text"]


# --------------------------------------------------------------------------- annualization when it is valid

def test_a_year_plus_holding_gets_a_real_xirr_equal_to_cagr(market):
    details, indices = market
    start = TODAY - dt.timedelta(days=400)
    details[1] = _detail(_path(start - dt.timedelta(days=10), 410, 100.0, 120.0))
    _all_indices(indices, start - dt.timedelta(days=10), 410, 20_000.0, 22_000.0)
    px = dict(details[1]["nav_history"])[start]
    r = portfolio.analysis_view([H(1, "X Flexi Cap Fund - Direct Plan - Growth", 10.0, px, start.isoformat())], today=TODAY)
    p = r["portfolio"]
    assert p["xirr"]["status"] == "ok" and p["xirr"]["annualized"]
    assert p["cagr_pct"] == pytest.approx(p["xirr"]["value"], abs=0.05)  # one lump sum: the two coincide
    assert r["funds"][0]["verdict"] in ("outperformed", "underperformed", "in_line")
    assert next(c for c in r["checks"] if c["id"] == "twr-vs-simple")["status"] == "ok"


# --------------------------------------------------------------------------- new money is not return

def test_extra_purchase_is_handled_by_twr_and_xirr(market):
    details, indices = market
    first = TODAY - dt.timedelta(days=200)
    mid = first + dt.timedelta(days=100)
    details[1] = _detail(_path(first - dt.timedelta(days=10), 110, 100.0, 110.0, then=(100, 121.0)))
    _all_indices(indices, first - dt.timedelta(days=10), 210, 20_000.0, 22_000.0)
    nav_map = dict(details[1]["nav_history"])
    holdings = [H(1, "X Flexi Cap Fund - Direct Plan - Growth", 20.0, (10 * nav_map[first] + 10 * nav_map[mid]) / 20, first.isoformat())]
    txs = [
        T(1, "buy", first.isoformat(), 10.0, nav_map[first]),
        T(1, "buy", mid.isoformat(), 10.0, nav_map[mid]),
    ]
    r = portfolio.analysis_view(holdings, txs, today=TODAY)
    p = r["portfolio"]
    invested = paid(10, nav_map[first], first) + paid(10, nav_map[mid], mid)  # the amounts paid, stamp duty included
    assert p["total_invested"] == pytest.approx(invested)
    assert p["absolute_return_pct"] == pytest.approx((20 * 121.0 / invested - 1) * 100, abs=0.2)
    # time-weighted: the NAV rose from its level on day one to 121 whatever was added in between
    assert p["twr_pct"] == pytest.approx((121.0 / nav_map[first] - 1) * 100, abs=0.05)
    assert p["twr_pct"] != pytest.approx(p["absolute_return_pct"], abs=1.0)
    assert p["transactions_source"] == "recorded"
    twr_check = next(c for c in r["checks"] if c["id"] == "twr-vs-simple")
    assert twr_check["status"] == "info"  # differing is expected when money arrives at different times
    # the value path never dips or jumps because of the purchase date
    values = [g["portfolio"] for g in r["growth"]]
    assert all(v is not None for v in values)


def test_redemption_is_counted_in_returns_and_flows(market):
    details, indices = market
    first = TODAY - dt.timedelta(days=420)
    sell = first + dt.timedelta(days=200)
    details[1] = _detail(_path(first - dt.timedelta(days=10), 210, 100.0, 120.0, then=(220, 126.0)))
    _all_indices(indices, first - dt.timedelta(days=10), 430, 20_000.0, 22_000.0)
    nav_map = dict(details[1]["nav_history"])
    holdings = [H(1, "X Flexi Cap Fund - Direct Plan - Growth", 6.0, nav_map[first], first.isoformat())]
    txs = [T(1, "buy", first.isoformat(), 10.0, nav_map[first]), T(1, "sell", sell.isoformat(), 4.0, nav_map[sell])]
    r = portfolio.analysis_view(holdings, txs, today=TODAY)
    p = r["portfolio"]
    invested = paid(10, nav_map[first], first)
    proceeds = 4 * nav_map[sell]
    value = 6 * 126.0
    assert p["total_invested"] == pytest.approx(invested)
    assert p["realised_proceeds"] == pytest.approx(proceeds)
    assert p["absolute_return_pct"] == pytest.approx(((value + proceeds) / invested - 1) * 100, abs=0.05)
    assert p["xirr"]["status"] == "ok"


def test_fully_redeemed_scheme_still_counts_towards_portfolio_flows(market):
    details, indices = market
    first = TODAY - dt.timedelta(days=500)
    sold = TODAY - dt.timedelta(days=100)
    details[1] = _detail(_path(first - dt.timedelta(days=10), 510, 100.0, 130.0))
    details[2] = _detail(_path(first - dt.timedelta(days=10), 510, 50.0, 55.0), name="Y Flexi Cap Fund - Direct Plan - Growth")
    _all_indices(indices, first - dt.timedelta(days=10), 510, 20_000.0, 24_000.0)
    n1, n2 = dict(details[1]["nav_history"]), dict(details[2]["nav_history"])
    holdings = [H(2, "Y Flexi Cap Fund - Direct Plan - Growth", 10.0, n2[first], first.isoformat())]
    txs = [
        T(1, "buy", first.isoformat(), 10.0, n1[first]),
        T(1, "sell", sold.isoformat(), 10.0, n1[sold]),   # scheme 1 fully sold, no holding row any more
        T(2, "buy", first.isoformat(), 10.0, n2[first]),
    ]
    r = portfolio.analysis_view(holdings, txs, today=TODAY)
    assert r["portfolio"]["total_invested"] == pytest.approx(paid(10, n1[first], first) + paid(10, n2[first], first))
    assert r["portfolio"]["realised_proceeds"] == pytest.approx(10 * n1[sold])
    assert [f["scheme_code"] for f in r["funds"]] == [2]  # only the current holding appears in the fund table


# --------------------------------------------------------------------------- missing data never becomes a number

def test_missing_benchmark_history_degrades_to_unavailable(market):
    details, indices = market
    start = TODAY - dt.timedelta(days=120)
    details[1] = _detail(_path(start - dt.timedelta(days=10), 130, 100.0, 105.0))
    px = dict(details[1]["nav_history"])[start]
    r = portfolio.analysis_view([H(1, "X Flexi Cap Fund - Direct Plan - Growth", 10.0, px, start.isoformat())], today=TODAY)
    assert all(b["return_pct"] is None for b in r["benchmarks"])
    f = r["funds"][0]
    assert f["benchmark"]["status"] == "no_data" and f["verdict"] == "unavailable"
    assert any(d["metric"] == "Nifty 500" and d["status"] == "unavailable" for d in r["data_quality"])


def test_debt_fund_is_not_compared_with_an_equity_index(market):
    details, indices = market
    start = TODAY - dt.timedelta(days=120)
    details[1] = _detail(_path(start - dt.timedelta(days=10), 130, 100.0, 102.0), category="Debt Scheme - Liquid Fund", name="X Liquid Fund - Direct Plan - Growth")
    _all_indices(indices, start - dt.timedelta(days=10), 130, 20_000.0, 22_000.0)
    px = dict(details[1]["nav_history"])[start]
    r = portfolio.analysis_view([H(1, "X Liquid Fund - Direct Plan - Growth", 10.0, px, start.isoformat())], today=TODAY)
    f = r["funds"][0]
    assert f["benchmark"]["key"] is None and f["benchmark"]["status"] == "no_mapping"
    assert f["benchmark"]["return_pct"] is None and f["verdict"] == "unavailable"
    assert f["benchmark"]["reason"]
    assert any(c["id"] == "benchmark-mapping" for c in r["checks"])


def test_each_fund_uses_its_own_category_benchmark(market):
    details, indices = market
    start = TODAY - dt.timedelta(days=120)
    flat = _path(start - dt.timedelta(days=10), 130, 100.0, 105.0)
    details[1] = _detail(flat, category="Equity Scheme - Small Cap Fund", name="S Small Cap Fund - Direct Plan - Growth")
    details[2] = _detail(flat, category="Equity Scheme - Large Cap Fund", name="L Large Cap Fund - Direct Plan - Growth")
    _all_indices(indices, start - dt.timedelta(days=10), 130, 20_000.0, 22_000.0)
    px = dict(flat)[start]
    r = portfolio.analysis_view([
        H(1, "S Small Cap Fund - Direct Plan - Growth", 10.0, px, start.isoformat()),
        H(2, "L Large Cap Fund - Direct Plan - Growth", 10.0, px, start.isoformat()),
    ], today=TODAY)
    labels = {f["scheme_code"]: f["benchmark"]["label"] for f in r["funds"]}
    assert labels == {1: "Nifty Smallcap 250", 2: "Nifty 100"}


def test_fund_without_nav_data_is_excluded_not_zeroed(market):
    details, indices = market
    r = portfolio.analysis_view([H(9, "Gone Fund", 10.0, 100.0, "2026-01-01")], today=TODAY)
    assert r["ready"] is False and r["portfolio"] is None


def test_empty_portfolio_is_not_ready(market):
    assert portfolio.analysis_view([], today=TODAY)["ready"] is False


# --------------------------------------------------------------------------- data integrity checks

def test_purchase_nav_that_disagrees_with_the_published_one_is_flagged(market):
    details, indices = market
    start = TODAY - dt.timedelta(days=120)
    details[1] = _detail(_path(start - dt.timedelta(days=10), 130, 100.0, 105.0))
    _all_indices(indices, start - dt.timedelta(days=10), 130, 20_000.0, 22_000.0)
    published = dict(details[1]["nav_history"])[start]
    h = H(1, "X Flexi Cap Fund - Direct Plan - Growth", 10.0, published * 1.08, start.isoformat())
    t = T(1, "buy", start.isoformat(), 10.0, published * 1.08)
    r = portfolio.analysis_view([h], [t], today=TODAY)
    check = next(c for c in r["checks"] if c["id"] == "purchase-nav")
    assert check["status"] == "warn" and "differs" in check["message"]
    assert r["portfolio"]["nav_entries_match"] is False


def test_legacy_holding_without_transactions_is_marked_aggregated(market):
    details, indices = market
    start = TODAY - dt.timedelta(days=120)
    details[1] = _detail(_path(start - dt.timedelta(days=10), 130, 100.0, 105.0))
    _all_indices(indices, start - dt.timedelta(days=10), 130, 20_000.0, 22_000.0)
    px = dict(details[1]["nav_history"])[start]
    r = portfolio.analysis_view([H(1, "X Flexi Cap Fund - Direct Plan - Growth", 10.0, px, start.isoformat())], today=TODAY)
    assert r["portfolio"]["transactions_source"] == "aggregated"


def test_value_chart_ends_at_the_portfolio_total_and_index_starts_at_100(market):
    details, indices = market
    start = TODAY - dt.timedelta(days=90)
    details[1] = _detail(_path(start - dt.timedelta(days=10), 100, 100.0, 109.0))
    _all_indices(indices, start - dt.timedelta(days=10), 100, 20_000.0, 21_000.0)
    px = dict(details[1]["nav_history"])[start]
    r = portfolio.analysis_view([H(1, "X Flexi Cap Fund - Direct Plan - Growth", 10.0, px, start.isoformat())], today=TODAY)
    assert r["growth"][-1]["portfolio"] == pytest.approx(r["portfolio"]["value"])
    assert r["performance"][0]["portfolio"] == 100.0
    assert all(b == pytest.approx(100.0) for b in r["performance"][0]["benchmarks"].values())
    assert r["performance"][-1]["portfolio"] - 100 == pytest.approx(r["portfolio"]["twr_pct"])


def test_portfolio_view_weights_sum_to_100(market):
    details, _ = market
    details[1] = _detail(_path(D(2026, 1, 1), 100, 100.0, 110.0))
    details[2] = _detail(_path(D(2026, 1, 1), 100, 50.0, 40.0), name="Other Fund - Regular Plan - Growth")
    view = portfolio.portfolio_view([
        H(1, "A Fund - Direct Plan - Growth", 10.0, 100.0, "2026-01-01"),
        H(2, "Other Fund - Regular Plan - Growth", 20.0, 50.0, "2026-01-01"),
    ])
    assert sum(r["weight_pct"] for r in view["holdings"]) == pytest.approx(100.0)
    assert {r["plan"] for r in view["holdings"]} == {"Direct", "Regular"}
    assert view["totals"]["value"] == pytest.approx(sum(r["value"] for r in view["holdings"]))


# --------------------------------------------------------------------------- the consistency engine itself

def _report(**over):
    base = {
        "period": {"start": "2026-09-25", "end": "2026-10-05", "days": 10},
        "portfolio": {"value": 1000.0, "xirr": {"annualized": False}, "twr_pct": -1.0, "absolute_return_pct": -1.0,
                      "single_date": True, "nav_entries_match": True},
        "benchmarks": [{"label": "Nifty 50", "return_pct": -2.6, "xirr": {"annualized": False}}],
        "funds": [{"scheme_name": "A", "value": 1000.0, "days_held": 10, "xirr": {"annualized": False},
                   "period": {"end": "2026-10-05"}, "benchmark": {"key": "NIFTY 500", "label": "Nifty 500", "return_pct": -2.0}}],
        "growth": [{"portfolio": 1000.0}],
    }
    base.update(over)
    return base


def _status(checks, id_):
    return next(c["status"] for c in checks if c["id"] == id_)


def test_clean_report_passes_every_hard_check():
    checks = consistency.run_checks(_report())
    assert consistency.blocked_metrics(checks) == set()
    assert _status(checks, "annualization-window") == "ok"


def test_annualized_figure_over_a_short_window_is_blocked():
    rep = _report()
    rep["portfolio"]["xirr"] = {"annualized": True}
    checks = consistency.run_checks(rep)
    assert _status(checks, "annualization-window") == "block"
    assert "xirr" in consistency.blocked_metrics(checks)


def test_a_benchmark_that_fell_64_percent_in_a_month_is_flagged_suspicious():
    rep = _report(period={"start": "2026-09-05", "end": "2026-10-05", "days": 30})
    rep["benchmarks"] = [{"label": "Nifty 500", "return_pct": -64.47, "xirr": {"annualized": False}}]
    checks = consistency.run_checks(rep)
    assert _status(checks, "benchmark-magnitude") == "warn"


def test_totals_that_do_not_add_up_are_blocked():
    rep = _report()
    rep["funds"][0]["value"] = 900.0
    assert _status(consistency.run_checks(rep), "totals") == "block"


def test_chart_that_disagrees_with_the_table_is_blocked():
    rep = _report(growth=[{"portfolio": 1020.0}])  # 2% off the 1000 total
    checks = consistency.run_checks(rep)
    assert _status(checks, "chart-vs-table") == "block"
    assert "growth" in consistency.blocked_metrics(checks)


def test_twr_and_simple_return_must_agree_for_a_single_purchase_date():
    rep = _report()
    rep["portfolio"]["twr_pct"] = 5.0
    assert _status(consistency.run_checks(rep), "twr-vs-simple") == "block"


def test_mismatched_comparison_end_dates_are_blocked():
    rep = _report()
    rep["funds"][0]["period"] = {"end": "2026-09-30"}
    assert _status(consistency.run_checks(rep), "period-alignment") == "block"


def test_category_average_is_always_declared_unavailable():
    assert _status(consistency.run_checks(_report()), "category-average") == "info"


# --------------------------------------------------------------------------- benchmark mapping table

@pytest.mark.parametrize("category,name,key,proxy", [
    ("Equity Scheme - Large Cap Fund", "X Large Cap Fund", "NIFTY 100", False),
    ("Equity Scheme - Mid Cap Fund", "X Midcap Fund", "NIFTY MIDCAP 150", False),
    ("Equity Scheme - Small Cap Fund", "X Small Cap Fund", "NIFTY SMALLCAP 250", False),
    ("Equity Scheme - Flexi Cap Fund", "X Flexi Cap Fund", "NIFTY 500", False),
    ("Equity Scheme - ELSS", "X Tax Saver", "NIFTY 500", False),
    ("Equity Scheme - Large & Mid Cap Fund", "X Large & Midcap", "NIFTY 200", True),
    ("Equity Scheme - Sectoral/Thematic", "HDFC Manufacturing Fund", "NIFTY 500", True),
    ("Equity Scheme - Sectoral/Thematic", "X Technology Fund", "NIFTY IT", False),
    ("Equity Scheme - Sectoral/Thematic", "X Banking & Financial Services Fund", "NIFTY BANK", True),
    ("Other Scheme - Index Funds", "UTI Nifty 50 Index Fund", "NIFTY 50", False),
    ("Other Scheme - Index Funds", "X Nifty Next 50 Index Fund", "NIFTY NEXT 50", False),
    ("Other Scheme - Index Funds", "X Nifty Midcap 150 Index Fund", "NIFTY MIDCAP 150", False),
])
def test_benchmark_mapping(category, name, key, proxy):
    m = benchmarks.benchmark_for(category, name)
    assert m["key"] == key and m["proxy"] is proxy
    assert (m["note"] != "") == proxy


@pytest.mark.parametrize("category", [
    "Debt Scheme - Liquid Fund", "Debt Scheme - Credit Risk Fund", "Debt Scheme - Gilt Fund",
    "Hybrid Scheme - Balanced Hybrid Fund", "Hybrid Scheme - Arbitrage Fund", "Solution Oriented Scheme - Retirement Fund",
])
def test_no_benchmark_rather_than_a_misleading_one(category):
    m = benchmarks.benchmark_for(category, "Some Fund")
    assert m["key"] is None and m["reason"]


def test_every_mapped_key_has_a_ticker():
    for key in benchmarks.REFERENCE_BENCHMARKS:
        assert key in benchmarks.INDEX_TICKERS
    assert not math.isnan(len(benchmarks.INDEX_TICKERS))


def test_portfolio_is_compared_with_each_broad_index_over_the_same_window(market):
    details, indices = market
    start = TODAY - dt.timedelta(days=120)
    details[1] = _detail(_path(start - dt.timedelta(days=10), 130, 100.0, 105.0))
    _all_indices(indices, start - dt.timedelta(days=10), 130, 20_000.0, 19_000.0)
    px = dict(details[1]["nav_history"])[start]
    r = portfolio.analysis_view([H(1, "X Flexi Cap Fund - Direct Plan - Growth", 10.0, px, start.isoformat())], today=TODAY)
    for b in r["benchmarks"]:
        assert b["return_pct"] < 0 < r["portfolio"]["absolute_return_pct"]
        assert b["relative_pp"] == pytest.approx(r["portfolio"]["absolute_return_pct"] - b["return_pct"])
        assert b["verdict"] == "outperformed" and b["period"]["label"] == r["period"]["label"]


def test_portfolio_verdict_waits_for_enough_days(market):
    details, indices = market
    start = TODAY - dt.timedelta(days=9)
    details[1] = _detail(_path(start - dt.timedelta(days=10), 20, 100.0, 98.0))
    _all_indices(indices, start - dt.timedelta(days=10), 20, 24_000.0, 23_000.0)
    px = dict(details[1]["nav_history"])[start]
    r = portfolio.analysis_view([H(1, "X Flexi Cap Fund - Direct Plan - Growth", 10.0, px, start.isoformat())], today=TODAY)
    assert {b["verdict"] for b in r["benchmarks"]} == {"too_early"}


def test_index_funds_are_judged_on_tracking_not_on_beating_the_index(market):
    details, indices = market
    start = TODAY - dt.timedelta(days=200)
    details[1] = _detail(
        _path(start - dt.timedelta(days=10), 210, 100.0, 108.0),
        category="Other Scheme - Index Funds", name="UTI Nifty 50 Index Fund - Direct Plan - Growth",
    )
    _all_indices(indices, start - dt.timedelta(days=10), 210, 20_000.0, 20_800.0)
    px = dict(details[1]["nav_history"])[start]
    r = portfolio.analysis_view([H(1, "UTI Nifty 50 Index Fund - Direct Plan - Growth", 10.0, px, start.isoformat())], today=TODAY)
    f = r["funds"][0]
    assert f["benchmark"]["label"] == "Nifty 50"
    assert f["verdict"] == "tracking"
    assert "not on beating the index" in f["verdict_text"] and "dividends" in f["verdict_text"]
    assert f["relative_pp"] is not None  # the gap is still shown
