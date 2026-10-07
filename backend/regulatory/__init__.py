"""
Loader for the central charge and tax configuration (charges.json, tax_rules.json).

Nothing outside the two JSON files holds a rate. Callers ask for a dated rate or a financial
year's rules; this module never invents one. A rule year that is not configured is reported as
such, or (when the caller allows it) the latest configured year is carried forward with the fact
stated, so a screen can say "FY 2027-28 rules are not published here yet; FY 2026-27 rates used".
"""
from __future__ import annotations

import datetime as dt
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping, Sequence

_HERE = Path(__file__).parent


@lru_cache(maxsize=1)
def charges() -> dict:
    return json.loads((_HERE / "charges.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def tax_rules() -> dict:
    return json.loads((_HERE / "tax_rules.json").read_text(encoding="utf-8"))


def _day(value: dt.date | str) -> dt.date:
    return value if isinstance(value, dt.date) else dt.date.fromisoformat(value)


def rate_on(schedule: Sequence[Mapping[str, Any]], day: dt.date | str) -> float:
    """
    The percentage in force on `day` from a dated schedule `[{from, pct}, ...]`.
    A date before the first entry gets the first entry's rate (the earliest known rate).
    """
    target = _day(day)
    chosen = None
    for entry in sorted(schedule, key=lambda e: e["from"]):
        if dt.date.fromisoformat(entry["from"]) <= target:
            chosen = entry
    if chosen is None:
        chosen = sorted(schedule, key=lambda e: e["from"])[0]
    return float(chosen["pct"])


def entry_on(schedule: Sequence[Mapping[str, Any]], day: dt.date | str) -> Mapping[str, Any]:
    target = _day(day)
    ordered = sorted(schedule, key=lambda e: e["from"])
    chosen = ordered[0]
    for entry in ordered:
        if dt.date.fromisoformat(entry["from"]) <= target:
            chosen = entry
    return chosen


# --- financial years --------------------------------------------------------------------------

def financial_year_of(day: dt.date | str) -> str:
    """'FY2026-27' for any date from 1 Apr 2026 to 31 Mar 2027."""
    d = _day(day)
    start = d.year if d.month >= 4 else d.year - 1
    return f"FY{start}-{str(start + 1)[-2:]}"


def fy_start_year(fy: str) -> int:
    return int(fy[2:6])


def fy_bounds(fy: str) -> tuple[dt.date, dt.date]:
    start = fy_start_year(fy)
    return dt.date(start, 4, 1), dt.date(start + 1, 3, 31)


def fy_label(fy: str) -> str:
    """'FY 2026-27'."""
    return f"FY {fy[2:]}"


class RuleSet(dict):
    """The rules for one financial year, plus how they were chosen."""

    fy: str
    source_fy: str
    assumed: bool
    note: str | None


def rules_for(fy: str, *, carry_forward: bool = True) -> RuleSet | None:
    """
    Rules for a financial year. An exact entry wins. For a later year with no entry, the latest
    configured year is carried forward and `assumed` is set, but only if `carry_forward`. A year
    before the supported range, or one listed as unsupported, returns None.
    """
    cfg = tax_rules()
    years: dict = cfg["financialYears"]
    if fy in cfg.get("unsupportedYears", {}):
        return None
    if fy in years:
        found = RuleSet(years[fy])
        found.fy, found.source_fy, found.assumed, found.note = fy, fy, False, None
        return found
    latest = max(years, key=fy_start_year)
    if fy_start_year(fy) > fy_start_year(latest) and carry_forward:
        found = RuleSet(years[latest])
        found.fy, found.source_fy, found.assumed = fy, latest, True
        found.note = (
            f"{fy_label(fy)} rules are not configured yet, so {fy_label(latest)} rates are carried forward as an assumption."
        )
        return found
    return None


def configured_years() -> list[str]:
    return sorted(tax_rules()["financialYears"], key=fy_start_year)


def unsupported_reason(fy: str) -> str | None:
    cfg = tax_rules()
    if fy in cfg.get("unsupportedYears", {}):
        return cfg["unsupportedYears"][fy]
    if fy_start_year(fy) < fy_start_year(cfg["supportedFrom"]):
        return f"Rules before {fy_label(cfg['supportedFrom'])} are not configured."
    return None
