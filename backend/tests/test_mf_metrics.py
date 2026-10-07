"""
Known-answer tests for backend/mutual_funds/metrics.py: the single source of truth for the mutual
fund desk's return arithmetic. No network; every series is synthetic.
"""
import datetime as dt

import pytest

from ..mutual_funds import metrics
from ..mutual_funds.metrics import (
    Series,
    absolute_return_pct,
    benchmark_replica,
    cagr_pct,
    index_return_pct,
    lumpsum_future_value,
    nav_on_date,
    period_between,
    real_value,
    rebase,
    relative_performance,
    sip_future_value,
    twr_index,
    xirr_result,
)

D = dt.date


def _npv(flows, rate):
    t0 = min(d for d, _ in flows)
    return sum(cf / (1 + rate) ** ((d - t0).days / 365) for d, cf in flows)


# --------------------------------------------------------------------------- period + simple returns

def test_period_between_states_its_window_and_whether_it_can_be_annualized():
    p = period_between(D(2026, 9, 25), D(2026, 10, 5))
    assert p["days"] == 10
    assert p["annualizable"] is False
    assert p["label"] == "25 Sep 2026 → 05 Oct 2026 (10 days)"
    assert period_between(D(2025, 10, 5), D(2026, 10, 5))["annualizable"] is True


def test_absolute_return_known_values():
    assert absolute_return_pct(10_000, 11_000) == pytest.approx(10.0)
    assert absolute_return_pct(10_000, 9_480) == pytest.approx(-5.2)
    assert absolute_return_pct(0, 100) is None
    assert absolute_return_pct(None, 100) is None


def test_cagr_known_values_and_the_one_year_floor():
    assert cagr_pct(100, 121, 730) == pytest.approx(10.0, abs=0.05)
    assert cagr_pct(100, 110, 365) == pytest.approx(10.0)
    # Ten days of +5% must not be compounded into a yearly rate.
    assert cagr_pct(100, 105, 10) is None
    assert cagr_pct(100, 105, 364) is None
    assert cagr_pct(100, -1, 800) is None


# --------------------------------------------------------------------------- XIRR

def test_xirr_two_flows_matches_the_closed_form():
    r = xirr_result([(D(2024, 1, 1), -100.0), (D(2026, 1, 1), 121.0)])
    assert r["status"] == "ok" and r["annualized"] is True
    # 731 days between those dates, so the exact answer is 1.21 ** (365/731) - 1
    assert r["value"] == pytest.approx((1.21 ** (365 / 731) - 1) * 100, abs=1e-3)


def test_xirr_multiple_flows_solves_npv_to_zero():
    flows = [
        (D(2025, 1, 1), -1000.0),
        (D(2025, 7, 1), -1000.0),
        (D(2026, 3, 1), -500.0),
        (D(2026, 10, 1), 3000.0),
    ]
    r = xirr_result(flows)
    assert r["status"] == "ok"
    assert _npv(flows, r["value"] / 100) == pytest.approx(0.0, abs=1e-3)


def test_xirr_short_history_is_withheld_not_annualized():
    # -2.6% in ten days would annualize to about -62%: exactly the figure that misled users.
    r = xirr_result([(D(2026, 9, 25), -10_000.0), (D(2026, 10, 5), 9_740.0)])
    assert r["status"] == "short_history"
    assert r["value"] is None and r["annualized"] is False
    assert r["days"] == 10
    assert "10 days" in r["note"]


def test_xirr_one_year_exactly_is_allowed():
    r = xirr_result([(D(2025, 10, 5), -10_000.0), (D(2026, 10, 5), 11_000.0)])
    assert r["status"] == "ok"
    assert r["value"] == pytest.approx(10.0, abs=0.01)


def test_xirr_recent_money_dominating_an_old_lot_is_still_short():
    # A tiny old lot must not let a large purchase from last week be annualized.
    r = xirr_result([
        (D(2024, 1, 1), -1_000.0),
        (D(2026, 9, 28), -100_000.0),
        (D(2026, 10, 5), 101_000.0),
    ])
    assert r["status"] == "short_history"


def test_xirr_insufficient_inputs():
    assert xirr_result([(D(2025, 1, 1), -100.0)])["status"] == "insufficient"
    assert xirr_result([(D(2025, 1, 1), 100.0), (D(2026, 1, 1), 110.0)])["status"] == "insufficient"
    assert xirr_result([])["status"] == "insufficient"


def test_xirr_all_negative_money_is_unsolvable_not_a_number():
    r = xirr_result([(D(2024, 1, 1), -100.0), (D(2026, 1, 1), -10.0)])
    assert r["value"] is None


def test_xirr_handles_a_redemption_leg():
    flows = [
        (D(2024, 1, 1), -10_000.0),
        (D(2025, 1, 1), 6_000.0),   # partial redemption
        (D(2026, 1, 1), 5_500.0),   # closing value
    ]
    r = xirr_result(flows)
    assert r["status"] == "ok"
    assert _npv(flows, r["value"] / 100) == pytest.approx(0.0, abs=1e-3)


# --------------------------------------------------------------------------- series + index returns

def test_series_never_lets_a_distant_level_stand_in_for_a_date():
    s = Series([(D(2026, 1, 1), 100.0), (D(2026, 1, 20), 120.0)])
    assert s.near(D(2026, 1, 5)) == (D(2026, 1, 1), 100.0)
    assert s.near(D(2026, 1, 9)) is None  # 8 days stale
    assert s.near(D(2025, 12, 31)) is None  # before the data begins
    assert s.near(D(2026, 1, 20)) == (D(2026, 1, 20), 120.0)


def test_series_accepts_most_recent_first_input():
    desc = [(D(2026, 1, 10), 120.0), (D(2026, 1, 5), 110.0), (D(2026, 1, 1), 100.0)]
    assert Series(desc).near(D(2026, 1, 7)) == (D(2026, 1, 5), 110.0)


def test_nav_on_date_uses_the_published_nav_for_that_day():
    hist = [(D(2026, 3, 2), 50.0), (D(2026, 3, 3), 51.0), (D(2026, 3, 6), 53.0)]
    assert nav_on_date(hist, D(2026, 3, 3)) == (D(2026, 3, 3), 51.0)
    assert nav_on_date(hist, D(2026, 3, 5)) == (D(2026, 3, 3), 51.0)  # weekend/holiday: last business day
    assert nav_on_date(hist, D(2026, 2, 1)) is None


def test_index_return_known_levels():
    hist = [(D(2026, 9, 25), 24_000.0), (D(2026, 10, 5), 23_376.0)]
    r = index_return_pct(hist, D(2026, 9, 25), D(2026, 10, 5))
    assert r["pct"] == pytest.approx(-2.6)
    assert r["start_date_used"] == "2026-09-25" and r["end_date_used"] == "2026-10-05"


def test_index_return_is_none_when_history_does_not_cover_the_window():
    hist = [(D(2026, 9, 30), 100.0), (D(2026, 10, 5), 110.0)]
    assert index_return_pct(hist, D(2026, 9, 1), D(2026, 10, 5)) is None  # starts too late
    assert index_return_pct(hist, D(2026, 10, 5), D(2026, 10, 5)) is None  # empty window
    stale = [(D(2026, 1, 1), 100.0), (D(2026, 2, 1), 110.0)]
    assert index_return_pct(stale, D(2026, 1, 1), D(2026, 10, 5)) is None  # ends months early


def test_index_levels_are_not_mistaken_for_percentages():
    # A level of 24,000 against 23,376 is -2.6%, not -23,376.
    r = index_return_pct([(D(2026, 1, 1), 24_000.0), (D(2026, 1, 11), 23_376.0)], D(2026, 1, 1), D(2026, 1, 11))
    assert abs(r["pct"]) < 100


# --------------------------------------------------------------------------- benchmark replica

def test_replica_single_purchase():
    hist = [(D(2026, 1, 1), 100.0), (D(2026, 7, 1), 110.0)]
    r = benchmark_replica([(D(2026, 1, 1), 100.0, 100.0)], D(2026, 7, 1), hist)
    assert r["invested"] == pytest.approx(10_000)
    assert r["terminal"] == pytest.approx(11_000)
    assert r["pct"] == pytest.approx(10.0)


def test_replica_two_purchases_use_each_purchase_date():
    hist = [(D(2026, 1, 1), 100.0), (D(2026, 4, 1), 120.0), (D(2026, 7, 1), 132.0)]
    trades = [(D(2026, 1, 1), 10.0, 100.0), (D(2026, 4, 1), 10.0, 120.0)]  # Rs 1,000 then Rs 1,200
    r = benchmark_replica(trades, D(2026, 7, 1), hist)
    assert r["invested"] == pytest.approx(2_200)
    assert r["terminal"] == pytest.approx(1_000 * 1.32 + 1_200 * 1.10)
    assert r["pct"] == pytest.approx((r["terminal"] / 2_200 - 1) * 100)


def test_replica_partial_redemption_sells_the_same_fraction():
    hist = [(D(2026, 1, 1), 100.0), (D(2026, 4, 1), 120.0), (D(2026, 7, 1), 110.0)]
    trades = [(D(2026, 1, 1), 100.0, 10.0), (D(2026, 4, 1), -50.0, 15.0)]  # buy Rs 1,000, sell half
    r = benchmark_replica(trades, D(2026, 7, 1), hist)
    assert r["invested"] == pytest.approx(1_000)
    assert r["proceeds"] == pytest.approx(600)  # 5 replica units x 120
    assert r["terminal"] == pytest.approx(550)  # 5 replica units x 110
    assert r["pct"] == pytest.approx(15.0)


def test_replica_none_when_a_purchase_date_has_no_index_level():
    hist = [(D(2026, 6, 1), 100.0), (D(2026, 7, 1), 110.0)]
    assert benchmark_replica([(D(2026, 1, 1), 10.0, 100.0)], D(2026, 7, 1), hist) is None
    assert benchmark_replica([(D(2026, 6, 1), 10.0, 100.0)], D(2026, 7, 1), []) is None


# --------------------------------------------------------------------------- relative performance

def test_outperforming_while_both_fell_is_explained_not_called_simply_ahead():
    r = relative_performance(-5.2, -7.1, days=120)
    assert r["relative_pp"] == pytest.approx(1.9)
    assert r["verdict"] == "outperformed"
    assert "despite a negative absolute return" in r["text"]


def test_underperforming_while_both_rose():
    r = relative_performance(4.0, 9.0, days=200)
    assert r["verdict"] == "underperformed"
    assert "despite a positive absolute return" in r["text"]


def test_in_line_inside_the_tolerance():
    assert relative_performance(8.2, 8.0, days=200)["verdict"] == "in_line"


def test_no_verdict_on_a_short_window():
    r = relative_performance(-1.0, -3.0, days=10)
    assert r["verdict"] == "too_early"
    assert r["relative_pp"] == pytest.approx(2.0)  # the gap is still shown, just not judged


def test_no_verdict_without_a_benchmark_return():
    assert relative_performance(5.0, None, days=400)["verdict"] == "unavailable"
    assert relative_performance(None, 5.0, days=400)["verdict"] == "unavailable"


# --------------------------------------------------------------------------- rebasing + TWR

def test_rebase_starts_at_100():
    assert rebase([50.0, 55.0, 60.0]) == pytest.approx([100.0, 110.0, 120.0])
    assert rebase([None, 50.0, 75.0]) == [None, 100.0, 150.0]
    assert rebase([None, None]) == [None, None]


def test_growth_of_100_known_return_series():
    # +20% total: 100 becomes 120
    levels = rebase([40.0, 44.0, 48.0])
    assert levels[-1] == pytest.approx(120.0)


def test_twr_ignores_new_money_added_part_way():
    # Value 1000 -> 1100 (+10%), then Rs 1100 more is added and it grows to 2420 (+10% on 2200).
    pts = [
        (D(2026, 1, 1), 1_000.0, 1_000.0),
        (D(2026, 4, 1), 2_200.0, 1_100.0),  # closing value includes the new 1100
        (D(2026, 7, 1), 2_420.0, 0.0),
    ]
    idx = [lvl for _, lvl in twr_index(pts)]
    # Interval 1: (2200 - 1100 new money) / 1000 = +10%. Interval 2: 2420 / 2200 = +10%.
    assert idx == [100.0, pytest.approx(110.0), pytest.approx(121.0)]


def test_twr_known_chain():
    pts = [
        (D(2026, 1, 1), 1_000.0, 1_000.0),
        (D(2026, 4, 1), 1_100.0, 0.0),            # +10%
        (D(2026, 7, 1), 2_310.0, 1_000.0),         # added 1000; (2310-1000)/1100 = +19.09%
    ]
    idx = [lvl for _, lvl in twr_index(pts)]
    assert idx == [100.0, pytest.approx(110.0), pytest.approx(110.0 * 1310 / 1100)]


def test_twr_a_redemption_removes_no_return():
    pts = [
        (D(2026, 1, 1), 1_000.0, 1_000.0),
        (D(2026, 4, 1), 600.0, -500.0),  # 500 is sold at the end of the interval; 600 is what is left
    ]
    # Before the sale the whole 1000 was worth 1100, so the interval returned +10%, not +20%.
    assert [l for _, l in twr_index(pts)][-1] == pytest.approx(110.0)


def test_twr_skips_an_interval_that_starts_from_zero():
    pts = [(D(2026, 1, 1), 0.0, 0.0), (D(2026, 2, 1), 100.0, 100.0)]
    assert [l for _, l in twr_index(pts)] == [100.0, 100.0]


# --------------------------------------------------------------------------- SIP, lumpsum, real value

def _simulate_sip(monthly, annual_pct, months, at_start=True):
    r = (1 + annual_pct / 100) ** (1 / 12) - 1
    value = 0.0
    for _ in range(months):
        value = (value + monthly) * (1 + r) if at_start else value * (1 + r) + monthly
    return value


@pytest.mark.parametrize("monthly,rate,months", [(10_000, 12, 12), (5_000, 8, 120), (25_000, 15, 300), (1_000, 0.5, 36)])
def test_sip_formula_matches_month_by_month_simulation(monthly, rate, months):
    assert sip_future_value(monthly, rate, months) == pytest.approx(_simulate_sip(monthly, rate, months), rel=1e-9)
    assert sip_future_value(monthly, rate, months, at_start=False) == pytest.approx(_simulate_sip(monthly, rate, months, False), rel=1e-9)


def test_sip_known_value_one_year_at_twelve_percent():
    # monthly rate equivalent to 12% a year is 0.9489%, so Rs 10,000 x 12 grows to about Rs 1.277 lakh
    assert sip_future_value(10_000, 12, 12) == pytest.approx(127_666, abs=60)


def test_sip_does_not_treat_the_annual_rate_as_monthly():
    # If 12% were applied monthly, 12 contributions would be worth about Rs 1.5 lakh.
    assert sip_future_value(10_000, 12, 12) < 135_000


def test_sip_zero_rate_is_just_the_contributions():
    assert sip_future_value(5_000, 0, 24) == pytest.approx(120_000)


def test_sip_beginning_of_month_beats_end_of_month_by_one_period():
    start = sip_future_value(10_000, 10, 60, at_start=True)
    end = sip_future_value(10_000, 10, 60, at_start=False)
    assert start / end == pytest.approx((1.10) ** (1 / 12))


def test_sip_degenerate_inputs():
    assert sip_future_value(0, 10, 12) == 0
    assert sip_future_value(1_000, 10, 0) == 0


def test_lumpsum_known_value():
    assert lumpsum_future_value(100_000, 10, 5) == pytest.approx(161_051)
    assert lumpsum_future_value(100_000, 0, 5) == pytest.approx(100_000)
    assert lumpsum_future_value(0, 10, 5) == 0


def test_real_value_deflates_by_the_inflation_assumption():
    assert real_value(12_400_000, 6, 25) == pytest.approx(12_400_000 / 1.06 ** 25)
    assert real_value(100, 6, 0) == 100


# --------------------------------------------------------------------------- very large and very small

def test_very_large_returns_do_not_overflow():
    assert absolute_return_pct(1, 1_000_000) == pytest.approx(99_999_900)
    assert cagr_pct(1, 1_000_000, 3650) == pytest.approx((1_000_000 ** 0.1 - 1) * 100)


def test_module_exports_one_xirr():
    from ..common import finance
    assert metrics.xirr is finance.xirr


# --------------------------------------------------------------------------- trailing NAV changes

def test_trailing_changes_known_values():
    latest = D(2026, 10, 5)
    hist = [(latest - dt.timedelta(days=i), 100.0 + (400 - i) * 0.1) for i in range(0, 401)]
    out = metrics.trailing_changes(hist)
    top = 140.0
    assert out["d1"] == pytest.approx((top / (top - 0.1) - 1) * 100)
    assert out["m1"] == pytest.approx((top / (top - 3.0) - 1) * 100)
    assert out["y1"] == pytest.approx((top / (top - 36.5) - 1) * 100)


def test_trailing_changes_never_estimate_a_window_the_history_does_not_cover():
    latest = D(2026, 10, 5)
    hist = [(latest - dt.timedelta(days=i), 100.0 + (45 - i) * 0.1) for i in range(0, 46)]  # 45 days of NAVs
    out = metrics.trailing_changes(hist)
    assert out["d1"] is not None and out["m1"] is not None
    assert out["m3"] is None and out["y1"] is None


def test_trailing_changes_with_one_point_is_all_none():
    assert metrics.trailing_changes([(D(2026, 1, 1), 100.0)]) == {"d1": None, "m1": None, "m3": None, "y1": None}
