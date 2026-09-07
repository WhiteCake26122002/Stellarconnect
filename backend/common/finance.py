"""
Generic finance math shared across the Paper Trading and Mutual Fund
analysis pages: money-weighted return (XIRR), a benchmark "what if"
equivalent value, CAPM beta, and Jensen's alpha. Pure functions only - no
network calls, no Streamlit - callers supply whatever live price/NAV
history they've already fetched.
"""
from __future__ import annotations

import datetime as dt


def _npv(cash_flows: list[tuple[dt.date, float]], rate: float) -> float:
    if rate <= -1:
        return float("inf")
    t0 = cash_flows[0][0]
    return sum(cf / (1 + rate) ** ((d - t0).days / 365) for d, cf in cash_flows)


def xirr(cash_flows: list[tuple[dt.date, float]]) -> float | None:
    """
    Annualized money-weighted return (%) for (date, amount) cash flows - negative for money
    going in, positive for money coming out or the terminal value. None if it can't be solved:
    fewer than 2 flows, all flows the same sign, or every flow lands on the same date.
    """
    if len(cash_flows) < 2:
        return None
    if all(cf >= 0 for _, cf in cash_flows) or all(cf <= 0 for _, cf in cash_flows):
        return None
    flows = sorted(cash_flows, key=lambda x: x[0])
    low, high = -0.9999, 10.0
    npv_low, npv_high = _npv(flows, low), _npv(flows, high)
    if npv_low * npv_high > 0:
        return None
    mid = low
    for _ in range(100):
        mid = (low + high) / 2
        npv_mid = _npv(flows, mid)
        if abs(npv_mid) < 1e-6:
            break
        if (npv_low < 0) == (npv_mid < 0):
            low, npv_low = mid, npv_mid
        else:
            high, npv_high = mid, npv_mid
    return mid * 100


def price_on_or_before(history: list[tuple[dt.date, float]], target: dt.date) -> float | None:
    """
    Most recent price on or before `target` (markets are closed weekends/holidays). Works
    regardless of whether `history` is sorted ascending or descending by date - some callers hand
    this AMFI NAV history (most-recent-first) and others hand it plain market data
    (oldest-first), and picking the wrong end of an unsorted-relative-to-assumption list would
    silently return the earliest price in history instead of the most recent one.
    """
    candidates = [(date, price) for date, price in history if date <= target]
    if not candidates:
        return None
    return max(candidates, key=lambda pair: pair[0])[1]


def benchmark_equivalent_value(
    invested: float, purchase_date: dt.date, today: dt.date, benchmark_history: list[tuple[dt.date, float]]
) -> float | None:
    """What `invested` would be worth today if put into the benchmark index on `purchase_date`
    instead of the actual investment. None if the benchmark has no price on either date."""
    price_then = price_on_or_before(benchmark_history, purchase_date)
    price_now = price_on_or_before(benchmark_history, today)
    if not price_then or not price_now:
        return None
    return invested * (price_now / price_then)


def daily_returns_from_history(history: list[tuple[dt.date, float]]) -> dict[dt.date, float]:
    """{date: pct_return_from_previous_trading_day}, from an unsorted price history."""
    sorted_hist = sorted(history, key=lambda p: p[0])
    returns: dict[dt.date, float] = {}
    for i in range(1, len(sorted_hist)):
        prev_price = sorted_hist[i - 1][1]
        date, price = sorted_hist[i]
        if prev_price > 0:
            returns[date] = (price / prev_price) - 1
    return returns


def aligned_returns(
    series_a: dict[dt.date, float], series_b: dict[dt.date, float]
) -> tuple[list[float], list[float]]:
    """Two return series as parallel lists, restricted to dates present in both."""
    common_dates = sorted(set(series_a) & set(series_b))
    return [series_a[d] for d in common_dates], [series_b[d] for d in common_dates]


def beta(asset_returns: list[float], benchmark_returns: list[float]) -> float | None:
    """
    CAPM beta: Cov(asset, benchmark) / Var(benchmark), from two aligned, equal-length daily-return
    series. None if there isn't enough data (fewer than 2 points) or the benchmark has zero
    variance (e.g. a flat price series).
    """
    n = min(len(asset_returns), len(benchmark_returns))
    if n < 2:
        return None
    a, b = asset_returns[-n:], benchmark_returns[-n:]
    mean_a, mean_b = sum(a) / n, sum(b) / n
    covariance = sum((a[i] - mean_a) * (b[i] - mean_b) for i in range(n)) / (n - 1)
    variance_b = sum((x - mean_b) ** 2 for x in b) / (n - 1)
    if variance_b == 0:
        return None
    return covariance / variance_b


def jensens_alpha(
    portfolio_return_pct: float, benchmark_return_pct: float, beta_value: float, risk_free_rate_pct: float
) -> float:
    """
    Jensen's alpha (%): the return a portfolio earned in excess of what CAPM says it "should"
    have earned given its beta - Rp - [Rf + beta x (Rm - Rf)]. Positive means it beat what its
    risk level would predict; negative means it fell short.
    """
    expected_return = risk_free_rate_pct + beta_value * (benchmark_return_pct - risk_free_rate_pct)
    return portfolio_return_pct - expected_return
