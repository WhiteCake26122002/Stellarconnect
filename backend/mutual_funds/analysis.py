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

from ..common.finance import benchmark_equivalent_value, price_on_or_before, xirr

__all__ = [
    "xirr", "price_on_or_before", "benchmark_equivalent_value",
    "classify_asset_class", "classify_market_cap", "weighted_breakdown", "amc_breakdown",
]

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
