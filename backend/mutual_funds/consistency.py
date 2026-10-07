"""
Checks run over a finished analysis before it is shown.

The point is to catch the class of bug where every number is individually "correct" but together
they mislead: an annualized figure over ten days, a benchmark that moved implausibly, a chart that
disagrees with the table beside it. A check with status "block" names the metrics it `affects`;
the UI withholds those metrics and says why instead of drawing them.

status: "ok" | "info" | "warn" | "block"
"""
from __future__ import annotations

from .metrics import MIN_ANNUALIZE_DAYS

__all__ = ["run_checks", "blocked_metrics"]

VALUE_TOLERANCE = 0.5  # rupees
PCT_TOLERANCE = 0.05  # percentage points
CHART_TOLERANCE_PCT = 0.5


def _check(id_: str, status: str, message: str, affects: list[str] | None = None) -> dict:
    return {"id": id_, "status": status, "message": message, "affects": affects or []}


def _suspicious_move(pct: float | None, days: int) -> bool:
    if pct is None:
        return False
    return (days <= 45 and abs(pct) > 25) or (days <= 365 and abs(pct) > 60)


def run_checks(report: dict) -> list[dict]:
    checks: list[dict] = []
    period = report.get("period") or {}
    days = period.get("days", 0)
    portfolio = report.get("portfolio") or {}
    funds = report.get("funds") or []
    benchmarks = report.get("benchmarks") or []

    # 1. Nothing annualized over less than a year.
    offenders = []
    if (portfolio.get("xirr") or {}).get("annualized") and days < MIN_ANNUALIZE_DAYS:
        offenders.append("portfolio XIRR")
    for b in benchmarks:
        if (b.get("xirr") or {}).get("annualized") and days < MIN_ANNUALIZE_DAYS:
            offenders.append(f"{b['label']} XIRR")
    for f in funds:
        if (f.get("xirr") or {}).get("annualized") and (f.get("days_held") or 0) < MIN_ANNUALIZE_DAYS:
            offenders.append(f"{f['scheme_name']} XIRR")
    if offenders:
        checks.append(_check("annualization-window", "block",
                             f"Annualized figures over less than a year were withheld: {', '.join(offenders)}.", ["xirr"]))
    else:
        checks.append(_check("annualization-window", "ok", "No figure is annualized over less than a year."))

    # 2. Every comparison shares the report's end date; each benchmark window matches its fund's.
    end = period.get("end")
    mismatched = []
    for f in funds:
        bm = f.get("benchmark") or {}
        if bm.get("return_pct") is None:
            continue
        if f.get("period", {}).get("end") != end:
            mismatched.append(f["scheme_name"])
    if mismatched:
        checks.append(_check("period-alignment", "block",
                             f"Comparison windows do not share an end date for: {', '.join(mismatched)}.", ["fund-vs-benchmark"]))
    else:
        checks.append(_check("period-alignment", "ok", "Every comparison uses the same start and end dates as the fund it is measured against."))

    # 3. Implausible index moves for the window.
    odd = [b["label"] for b in benchmarks if _suspicious_move(b.get("return_pct"), days)]
    odd += [
        f"{(f.get('benchmark') or {}).get('label')} (for {f['scheme_name']})"
        for f in funds
        if _suspicious_move((f.get("benchmark") or {}).get("return_pct"), f.get("days_held") or 0)
    ]
    if odd:
        checks.append(_check("benchmark-magnitude", "warn",
                             f"A benchmark moved by an unusual amount for its window ({', '.join(odd)}). Treat it as unverified until the index data is checked.",
                             ["benchmarks"]))
    else:
        checks.append(_check("benchmark-magnitude", "ok", "Benchmark moves are plausible for their windows."))

    # 4. Totals add up.
    fund_value = sum((f.get("value") or 0) for f in funds)
    if portfolio.get("value") is not None and abs(fund_value - portfolio["value"]) > VALUE_TOLERANCE:
        checks.append(_check("totals", "block", "The funds' values do not add up to the portfolio value.", ["portfolio"]))
    else:
        checks.append(_check("totals", "ok", "Fund values add up to the portfolio value."))

    # 5. Chart and table agree.
    growth = report.get("growth") or []
    last_value = next((p["portfolio"] for p in reversed(growth) if p.get("portfolio") is not None), None)
    if last_value is not None and portfolio.get("value"):
        gap = abs(last_value - portfolio["value"]) / portfolio["value"] * 100
        if gap > CHART_TOLERANCE_PCT:
            checks.append(_check("chart-vs-table", "block",
                                 "The value chart ends at a different value from the portfolio total.", ["growth"]))
        else:
            checks.append(_check("chart-vs-table", "ok", "The value chart ends at the portfolio total."))
    twr = portfolio.get("twr_pct")
    simple = portfolio.get("absolute_return_pct")
    if twr is not None and simple is not None and portfolio.get("single_date") and portfolio.get("nav_entries_match", True):
        if abs(twr - simple) > max(PCT_TOLERANCE, 0.5):
            checks.append(_check("twr-vs-simple", "block",
                                 "With every purchase on one date, the time-weighted and simple returns must agree, and they do not.", ["performance"]))
        else:
            checks.append(_check("twr-vs-simple", "ok", "Time-weighted and simple returns agree (single purchase date)."))
    elif twr is not None and simple is not None:
        checks.append(_check("twr-vs-simple", "info",
                             "Time-weighted and money-weighted returns can differ when money is added at different times; that is expected."))

    # 6. Benchmark mapping.
    unmapped = [f["scheme_name"] for f in funds if (f.get("benchmark") or {}).get("key") is None]
    if unmapped:
        checks.append(_check("benchmark-mapping", "info",
                             f"No suitable benchmark for: {', '.join(unmapped)}. They are shown without a comparison rather than against an unrelated index."))

    # 7. Category average and history depth.
    checks.append(_check("category-average", "info", "Category-average returns are not available from the data sources used here."))
    if days < MIN_ANNUALIZE_DAYS:
        checks.append(_check("history-depth", "info",
                             f"{days} days of history: annualized return, volatility, Sharpe and beta need at least {MIN_ANNUALIZE_DAYS} days.",
                             ["risk"]))
    return checks


def blocked_metrics(checks: list[dict]) -> set[str]:
    return {a for c in checks if c["status"] == "block" for a in c["affects"]}
