"""
Long-term index context for the planning page: what the broad market actually compounded at over
5 and 10 years, from the same daily closes used for benchmark comparisons.

This anchors the Plan page's scenario rates in something measured. It is context, not a forecast:
past compounding does not predict future returns, and the figures are price-index returns, so
dividends are excluded.
"""
from __future__ import annotations

import datetime as dt

from . import benchmarks, metrics, nav

__all__ = ["window_cagr", "long_term_context"]

DAYS_PER_YEAR = 365.25
TOLERANCE_DAYS = 7


def window_cagr(series: metrics.Series, years: int) -> dict | None:
    """Compound annual growth over the last `years` years, or None if the history does not reach back that far."""
    if not series or len(series.dates) < 2:
        return None
    end_date, end_level = series.dates[-1], series.levels[-1]
    target = end_date - dt.timedelta(days=round(years * DAYS_PER_YEAR))
    first = series.dates[0]
    if first > target + dt.timedelta(days=TOLERANCE_DAYS):
        return None
    start = series.near(max(target, first))
    if start is None:
        return None
    start_date, start_level = start
    days = (end_date - start_date).days
    cagr = metrics.cagr_pct(start_level, end_level, days)
    if cagr is None:
        return None
    return {
        "cagr_pct": cagr,
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
        "days": days,
        "total_pct": (end_level / start_level - 1) * 100,
    }


def long_term_context() -> dict:
    indices = []
    latest: dt.date | None = None
    for key in benchmarks.REFERENCE_BENCHMARKS:
        ticker, label = benchmarks.INDEX_TICKERS[key]
        series = metrics.Series(nav.get_index_history(ticker))
        five = window_cagr(series, 5)
        ten = window_cagr(series, 10)
        if series:
            latest = max(latest, series.dates[-1]) if latest else series.dates[-1]
        indices.append({"key": key, "label": label, "five_year": five, "ten_year": ten})
    return {
        "as_of": latest.isoformat() if latest else None,
        "indices": indices,
        "basis": benchmarks.PRICE_BASIS_NOTE,
        "note": "What the index compounded at in the past. It is context for choosing a scenario, not a forecast.",
    }
