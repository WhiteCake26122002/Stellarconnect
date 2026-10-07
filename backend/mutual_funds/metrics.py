"""
Single source of truth for the mutual-fund desk's return arithmetic.

Everything here is a pure function over dates and numbers. Nothing fetches data, and nothing fills a
gap with an assumed value: when a figure cannot be measured honestly the function returns None (or a
result whose `status` says why), and the caller shows "unavailable" instead of a number.

Policies enforced here, because the desk used to get them wrong:

* A return is only annualized (CAGR, XIRR) when the money has been invested for at least a year.
  Compounding ten days of movement to twelve months turns a -2.6% index dip into "-62% a year".
* A benchmark is only compared over the same start and end dates as the thing it is compared with,
  and only if its history actually covers both dates (no silent use of a stale or distant level).
* "Outperformed" / "underperformed" labels are only given once the window is long enough to mean
  something.
"""
from __future__ import annotations

import datetime as dt
from bisect import bisect_right
from typing import Iterable, Sequence

from ..common.finance import price_on_or_before, xirr

__all__ = [
    "MIN_ANNUALIZE_DAYS", "MIN_VERDICT_DAYS", "MAX_STALE_DAYS",
    "period_between", "absolute_return_pct", "cagr_pct", "xirr_result",
    "index_return_pct", "benchmark_replica", "relative_performance",
    "rebase", "twr_index", "trailing_changes", "sip_future_value", "lumpsum_future_value", "real_value",
    "nav_on_date", "price_on_or_before", "xirr", "Series",
]

MIN_ANNUALIZE_DAYS = 365
MIN_WEIGHTED_AGE_DAYS = 90
MIN_VERDICT_DAYS = 30
MAX_STALE_DAYS = 7  # a price may stand in for a date only if it is at most this many days older


def _fmt(d: dt.date) -> str:
    return f"{d.day:02d} {d.strftime('%b %Y')}"


def period_between(start: dt.date, end: dt.date) -> dict:
    """The window a number was measured over, in words the UI can show verbatim."""
    days = (end - start).days
    unit = "day" if days == 1 else "days"
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": days,
        "label": f"{_fmt(start)} → {_fmt(end)} ({days} {unit})",
        "annualizable": days >= MIN_ANNUALIZE_DAYS,
    }


def absolute_return_pct(start_value: float | None, end_value: float | None) -> float | None:
    """(end - start) / start, in percent. Needs a positive starting value."""
    if start_value is None or end_value is None or start_value <= 0:
        return None
    return (end_value / start_value - 1) * 100


def cagr_pct(start_value: float | None, end_value: float | None, days: int) -> float | None:
    """Compound annual growth rate, in percent. None below one year of history: a shorter window
    would only extrapolate noise."""
    if days < MIN_ANNUALIZE_DAYS or start_value is None or end_value is None or start_value <= 0 or end_value <= 0:
        return None
    return ((end_value / start_value) ** (365 / days) - 1) * 100


def xirr_result(flows: Sequence[tuple[dt.date, float]]) -> dict:
    """
    Money-weighted annualized return for dated cash flows (negative = money in, the last positive
    flow = the closing value), wrapped with the reason when it cannot be shown.

    status: "ok" | "short_history" | "insufficient" | "unsolvable"
    """
    flows = sorted(flows, key=lambda x: x[0])
    if len(flows) < 2:
        return {"value": None, "annualized": False, "status": "insufficient", "days": 0,
                "note": "XIRR needs at least one purchase and a closing value."}
    first, last = flows[0][0], flows[-1][0]
    days = (last - first).days
    outflows = [(d, -cf) for d, cf in flows if cf < 0]
    if not outflows:
        return {"value": None, "annualized": False, "status": "insufficient", "days": days,
                "note": "XIRR needs at least one purchase (money in)."}
    total_in = sum(a for _, a in outflows)
    weighted_age = sum((last - d).days * a for d, a in outflows) / total_in
    if days < MIN_ANNUALIZE_DAYS or weighted_age < MIN_WEIGHTED_AGE_DAYS:
        return {
            "value": None, "annualized": False, "status": "short_history", "days": days,
            "note": (
                f"Only {days} {'day' if days == 1 else 'days'} since the first purchase. Annualizing a window this "
                "short would overstate both gains and losses, so the plain return is shown instead."
            ),
        }
    value = xirr(list(flows))
    if value is None:
        return {"value": None, "annualized": False, "status": "unsolvable", "days": days,
                "note": "These cash flows do not produce a single annualized rate."}
    return {"value": value, "annualized": True, "status": "ok", "days": days,
            "note": f"Annualized over {days} days from {len(outflows)} purchase{'s' if len(outflows) != 1 else ''}."}


class Series:
    """A dated level series (NAV or index close) with fast "level on or before a date" lookups.

    `near` only answers if the level is at most MAX_STALE_DAYS older than the date asked for, so a
    gap in the data can never silently stand in for a date months away.
    """

    def __init__(self, history: Iterable[tuple[dt.date, float]]):
        pairs = sorted((d, v) for d, v in history if v and v > 0)
        self.dates = [d for d, _ in pairs]
        self.levels = [v for _, v in pairs]

    def __bool__(self) -> bool:
        return bool(self.dates)

    def near(self, target: dt.date) -> tuple[dt.date, float] | None:
        i = bisect_right(self.dates, target)
        if i == 0:
            return None
        d = self.dates[i - 1]
        if (target - d).days > MAX_STALE_DAYS:
            return None
        return d, self.levels[i - 1]


def _as_series(history) -> Series:
    return history if isinstance(history, Series) else Series(history)


def _level_near(history, target: dt.date) -> tuple[dt.date, float] | None:
    return _as_series(history).near(target)


def nav_on_date(nav_history: Iterable[tuple[dt.date, float]], target: dt.date) -> tuple[dt.date, float] | None:
    """The NAV a fund actually published on `target` (or the last business day before it)."""
    return _level_near(nav_history, target)


def index_return_pct(history: Sequence[tuple[dt.date, float]], start: dt.date, end: dt.date) -> dict | None:
    """
    (ending level / starting level) - 1 for an index over exactly [start, end]. Both levels must
    exist within MAX_STALE_DAYS of the requested dates; otherwise None (benchmark unavailable).
    """
    if end <= start:
        return None
    series = _as_series(history)
    a = series.near(start)
    b = series.near(end)
    if a is None or b is None or b[0] < a[0]:
        return None
    return {
        "pct": (b[1] / a[1] - 1) * 100,
        "start_level": a[1], "end_level": b[1],
        "start_date_used": a[0].isoformat(), "end_date_used": b[0].isoformat(),
    }


def benchmark_replica(
    trades: Sequence[tuple[dt.date, float, float]], end: dt.date, history
) -> dict | None:
    """
    The same rupees, on the same dates, but in the index.

    `trades` are (date, signed units, unit price) for ONE holding: units > 0 a purchase, < 0 a
    redemption. A purchase of Rs a buys a / level index units on that date. A redemption sells the
    same *fraction* of the replica's units that the real redemption sold of the fund's, so the
    replica never goes short. Returns invested, proceeds, the replica's value on `end`, and the
    simple return (terminal + proceeds) / invested - 1. None unless the index has a level for every
    trade date and for `end`.
    """
    series = _as_series(history)
    end_level = series.near(end)
    if end_level is None:
        return None
    fund_units = 0.0
    replica_units = 0.0
    invested = 0.0
    proceeds = 0.0
    flows: list[tuple[dt.date, float]] = []
    for d, units, price in sorted(trades, key=lambda t: t[0]):
        if d > end:
            continue
        level = series.near(d)
        if level is None:
            return None
        if units > 0:
            amount = units * price
            invested += amount
            replica_units += amount / level[1]
            fund_units += units
            flows.append((d, -amount))
        elif units < 0 and fund_units > 0:
            fraction = min(1.0, -units / fund_units)
            sold = replica_units * fraction
            cash = sold * level[1]
            proceeds += cash
            replica_units -= sold
            fund_units -= -units
            flows.append((d, cash))
    if invested <= 0:
        return None
    terminal = replica_units * end_level[1]
    return {
        "invested": invested, "proceeds": proceeds, "terminal": terminal, "flows": flows,
        "pct": ((terminal + proceeds) / invested - 1) * 100, "end_date_used": end_level[0].isoformat(),
    }


def relative_performance(
    fund_pct: float | None, bench_pct: float | None, *, days: int, tolerance_pp: float = 0.5
) -> dict:
    """
    Fund return minus benchmark return, in percentage points, plus a verdict that is only given
    when the window is long enough. verdict: outperformed | underperformed | in_line | too_early | unavailable
    """
    if fund_pct is None or bench_pct is None:
        return {"relative_pp": None, "verdict": "unavailable", "text": "No like-for-like benchmark return for these dates."}
    diff = fund_pct - bench_pct
    if days < MIN_VERDICT_DAYS:
        return {"relative_pp": diff, "verdict": "too_early",
                "text": f"Too early to call: only {days} {'day' if days == 1 else 'days'} of data."}
    if abs(diff) <= tolerance_pp:
        verdict, text = "in_line", "In line with the benchmark."
    elif diff > 0:
        verdict, text = "outperformed", "Outperformed the benchmark."
    else:
        verdict, text = "underperformed", "Underperformed the benchmark."
    if verdict == "outperformed" and fund_pct < 0:
        text = "Outperformed the benchmark despite a negative absolute return."
    elif verdict == "underperformed" and fund_pct > 0:
        text = "Underperformed the benchmark despite a positive absolute return."
    return {"relative_pp": diff, "verdict": verdict, "text": text}


def rebase(values: Sequence[float | None], base: float = 100.0) -> list[float | None]:
    """Scale a level series so its first usable value equals `base`."""
    first = next((v for v in values if v is not None and v > 0), None)
    if first is None:
        return [None for _ in values]
    return [None if v is None else v / first * base for v in values]


def twr_index(points: Sequence[tuple[dt.date, float, float]], base: float = 100.0) -> list[tuple[dt.date, float]]:
    """
    Chain-linked time-weighted return index from (date, closing value, external flow on that date).

    Each interval's return is (closing value - the day's flow) / previous closing value - 1, so new
    money bought at the interval's end adds no return and a redemption removes none. A flow is
    positive for money added. Intervals that start from a zero value are skipped.
    """
    out: list[tuple[dt.date, float]] = []
    level = base
    prev_value: float | None = None
    for d, value, flow in points:
        if prev_value is None:
            out.append((d, level))
        else:
            if prev_value > 0:
                level *= (value - flow) / prev_value
            out.append((d, level))
        prev_value = value
    return out


def sip_future_value(monthly: float, annual_rate_pct: float, months: int, *, at_start: bool = True) -> float:
    """
    Future value of a monthly SIP: FV = P x [((1+r)^n - 1) / r] x (1+r) with r the *monthly* rate
    equivalent to the annual rate, (1+annual)^(1/12) - 1. `at_start=False` is an end-of-month
    contribution (the (1+r) factor is dropped).
    """
    if months <= 0 or monthly <= 0:
        return 0.0
    r = (1 + annual_rate_pct / 100) ** (1 / 12) - 1
    if abs(r) < 1e-12:
        return monthly * months
    fv = monthly * (((1 + r) ** months - 1) / r)
    return fv * (1 + r) if at_start else fv


def lumpsum_future_value(amount: float, annual_rate_pct: float, years: float) -> float:
    """FV = PV x (1 + annual rate)^years, annual rate with annual periods."""
    if amount <= 0 or years < 0:
        return 0.0
    return amount * (1 + annual_rate_pct / 100) ** years


def real_value(nominal: float, inflation_pct: float, years: float) -> float:
    """A future rupee amount restated in today's purchasing power."""
    return nominal / (1 + inflation_pct / 100) ** years if years >= 0 else nominal


def trailing_changes(nav_history: Iterable[tuple[dt.date, float]]) -> dict:
    """
    Point-to-point NAV change, in percent, for 1 day, 1 month (30 days), 3 months (91 days) and
    1 year (365 days), measured back from the latest published NAV. A window the history does not
    reach back to (within MAX_STALE_DAYS) is None, never an estimate.
    """
    series = Series(nav_history)
    out: dict[str, float | None] = {"d1": None, "m1": None, "m3": None, "y1": None}
    if len(series.dates) < 2:
        return out
    latest_date, latest = series.dates[-1], series.levels[-1]
    out["d1"] = (latest / series.levels[-2] - 1) * 100
    for key, days in (("m1", 30), ("m3", 91), ("y1", 365)):
        then = series.near(latest_date - dt.timedelta(days=days))
        if then is not None:
            out[key] = (latest / then[1] - 1) * 100
    return out
