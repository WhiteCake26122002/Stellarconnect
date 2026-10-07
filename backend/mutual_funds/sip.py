"""
Monthly SIP schedules. A simulated SIP is a run of ordinary dated purchases, one per instalment,
each at the NAV the scheme published on (or, for a holiday, just after) its date, so each
instalment becomes its own tax lot with its own holding period.
"""
from __future__ import annotations

import calendar
import datetime as dt
from typing import Iterable

MAX_INSTALMENTS = 120
NAV_GAP_DAYS = 7


def schedule(start: dt.date, day_of_month: int, *, installments: int | None, end: dt.date | None, today: dt.date) -> list[dt.date]:
    """
    The instalment dates: the `day_of_month` of each month from `start` on (clamped to the month's
    last day), not before `start`, not after `end` or `today`, at most `installments` of them.
    """
    if not 1 <= day_of_month <= 31:
        raise ValueError("The instalment day must be between 1 and 31.")
    limit = min(end or today, today)
    cap = min(installments or MAX_INSTALMENTS, MAX_INSTALMENTS)
    out: list[dt.date] = []
    year, month = start.year, start.month
    while len(out) < cap:
        last = calendar.monthrange(year, month)[1]
        day = dt.date(year, month, min(day_of_month, last))
        if day > limit:
            break
        if day >= start:
            out.append(day)
        month += 1
        if month > 12:
            year, month = year + 1, 1
    return out


def nav_on_or_after(history: Iterable[tuple[dt.date, float]], day: dt.date, max_gap: int = NAV_GAP_DAYS) -> tuple[dt.date, float] | None:
    """The first NAV published on or after `day`, within `max_gap` days: where an AMC allots units when `day` is a holiday."""
    best = None
    for d, v in history:
        if day <= d <= day + dt.timedelta(days=max_gap) and (best is None or d < best[0]):
            best = (d, v)
    return best
