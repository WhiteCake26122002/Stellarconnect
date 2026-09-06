"""
Portfolio-level analysis for the Mutual Fund tracker: money-weighted (XIRR)
returns benchmarked against the NIFTY 500, plus asset-class, market-cap and
AMC concentration. Pure functions only - no network calls - so the caller
supplies whatever live data (NAV history, benchmark history) is needed.

Two honesty notes baked into the design:
1. Asset-class and market-cap splits are read off each scheme's AMFI
   category label (e.g. "Equity Scheme - Large Cap Fund"), not a live
   look-through of the stocks a fund actually holds - AMFI/mfapi doesn't
   publish that, so a fund is bucketed as a whole into one category.
2. There is no free, trustworthy sector look-through (Financial/Tech/etc.)
   data source in this pipeline. Faking one with plausible-looking numbers
   would be actively misleading in a finance tool, so it isn't offered here.
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
    """Most recent price on or before `target` (markets are closed weekends/holidays)."""
    candidates = [price for date, price in history if date <= target]
    return candidates[-1] if candidates else None


def benchmark_equivalent_value(
    invested: float, purchase_date: dt.date, today: dt.date, benchmark_history: list[tuple[dt.date, float]]
) -> float | None:
    """What `invested` would be worth today if put into the benchmark index on `purchase_date`
    instead of the actual fund. None if the benchmark has no price on either date."""
    price_then = price_on_or_before(benchmark_history, purchase_date)
    price_now = price_on_or_before(benchmark_history, today)
    if not price_then or not price_now:
        return None
    return invested * (price_now / price_then)


ASSET_CLASS_KEYWORDS = [
    ("equity", "Equity"),
    ("debt", "Debt"),
    ("hybrid", "Hybrid"),
    ("index", "Index/ETF"),
    ("etf", "Index/ETF"),
]


def classify_asset_class(scheme_category: str) -> str:
    c = (scheme_category or "").lower()
    for keyword, label in ASSET_CLASS_KEYWORDS:
        if keyword in c:
            return label
    return "Other"


MARKET_CAP_KEYWORDS = [
    ("large & mid cap", "Large & Mid Cap"),
    ("large cap", "Large Cap"),
    ("mid cap", "Mid Cap"),
    ("small cap", "Small Cap"),
    ("multi cap", "Multi Cap"),
    ("flexi cap", "Flexi Cap"),
    ("elss", "ELSS (Tax Saver)"),
    ("focused", "Focused"),
    ("contra", "Value/Contra"),
    ("value", "Value/Contra"),
    ("dividend yield", "Dividend Yield"),
]


def classify_market_cap(scheme_category: str) -> str:
    c = (scheme_category or "").lower()
    for keyword, label in MARKET_CAP_KEYWORDS:
        if keyword in c:
            return label
    return "Other Equity"


def weighted_breakdown(rows: list[dict], classify_fn) -> dict[str, float]:
    """{label: percent_of_total_value} over `rows`, each a {"scheme_category", "value"} dict."""
    total = sum(r["value"] for r in rows)
    if total <= 0:
        return {}
    buckets: dict[str, float] = {}
    for r in rows:
        label = classify_fn(r["scheme_category"])
        buckets[label] = buckets.get(label, 0.0) + r["value"]
    return {label: value / total * 100 for label, value in buckets.items()}


def amc_breakdown(rows: list[dict]) -> dict[str, float]:
    """{fund_house: percent_of_total_value} over `rows`, each a {"fund_house", "value"} dict."""
    total = sum(r["value"] for r in rows)
    if total <= 0:
        return {}
    buckets: dict[str, float] = {}
    for r in rows:
        buckets[r["fund_house"]] = buckets.get(r["fund_house"], 0.0) + r["value"]
    return {label: value / total * 100 for label, value in buckets.items()}
