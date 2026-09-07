"""
Portfolio-level analysis for Paper Trading: money-weighted (XIRR) return
benchmarked against NIFTY 50/500/Midcap 150/Smallcap 250, and the beta
input needed for a CAPM-style alpha (see backend.common.finance.jensens_alpha).
Pure functions only - the caller supplies whatever live price history has
already been fetched.

Alpha needs a risk-free rate. There is no free, live Indian government-bond-
yield feed anywhere in this project's data pipeline (the DCF engine's own
risk-free-rate field is a manual slider, not a fetched number - see
ui_app.py), so the Paper Trading UI asks for it directly too rather than
pretending to fetch one.
"""
from __future__ import annotations

import datetime as dt

from ..common.finance import aligned_returns, beta, benchmark_equivalent_value, daily_returns_from_history, xirr


def account_return_pct(created_at: dt.date, today: dt.date, starting_cash: float, net_worth: float) -> float | None:
    """Annualized return on the account since it was created - a single lump-sum inflow at
    creation (the starting virtual cash), net worth today as the terminal value."""
    return xirr([(created_at, -starting_cash), (today, net_worth)])


def benchmark_return_pct(
    created_at: dt.date, today: dt.date, starting_cash: float, benchmark_history: list[tuple[dt.date, float]]
) -> float | None:
    """What the same starting cash would have returned (annualized) if put into the benchmark
    index on account-creation day instead of being traded."""
    equivalent_value = benchmark_equivalent_value(starting_cash, created_at, today, benchmark_history)
    if equivalent_value is None:
        return None
    return xirr([(created_at, -starting_cash), (today, equivalent_value)])


def stock_beta(
    stock_history: list[tuple[dt.date, float]], benchmark_history: list[tuple[dt.date, float]]
) -> float | None:
    """Beta of one stock against one benchmark, from whatever aligned daily-return history both
    series share. None if either series is empty or there's no overlapping date."""
    stock_returns = daily_returns_from_history(stock_history)
    benchmark_returns = daily_returns_from_history(benchmark_history)
    a, b = aligned_returns(stock_returns, benchmark_returns)
    return beta(a, b)


def portfolio_beta(stock_betas: list[tuple[float, float]], cash_value: float) -> float | None:
    """
    Value-weighted portfolio beta. `stock_betas` is a list of (beta, holding_value) pairs, one
    per stock with a computable beta; idle cash contributes beta 0 (it doesn't move with the
    market). None only if there is no value at all to weight over.
    """
    total_value = sum(v for _, v in stock_betas) + cash_value
    if total_value <= 0:
        return None
    weighted_sum = sum(b * v for b, v in stock_betas)
    return weighted_sum / total_value
