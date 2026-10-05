"""
Turn stored mutual-fund lines into the portfolio and analysis the website shows.

Network calls stay in nav.py. This module only arranges those results. Nothing
here recommends a buy or a sell.
"""
from __future__ import annotations

import datetime as dt

from . import analysis, nav, recommend

DISCLAIMER = (
    "Observations are arithmetic over your own holdings. Not investment advice, "
    "and not a substitute for a SEBI-registered advisor."
)
LOOKTHROUGH = (
    "Asset class and market-cap splits follow each scheme's AMFI category. "
    "There is no free, reliable source for the stocks inside each fund, so this desk does not invent a sector look-through."
)


def enrich(holdings) -> list[dict]:
    rows = []
    for holding in holdings:
        purchase = dt.date.fromisoformat(holding.purchase_date)
        invested = round(holding.units * holding.avg_nav, 2)
        detail = nav.get_scheme_detail(holding.scheme_code)
        base = {
            "scheme_code": holding.scheme_code,
            "scheme_name": holding.scheme_name,
            "units": holding.units,
            "avg_nav": round(holding.avg_nav, 4),
            "invested": invested,
            "purchase_date": purchase.isoformat(),
        }
        if detail is None:
            rows.append({
                **base,
                "scheme_category": "Unknown",
                "fund_house": "Unknown",
                "current_nav": None,
                "nav_date": None,
                "value": 0.0,
                "gain": None,
                "gain_pct": None,
                "return_1y": None,
                "data_available": False,
            })
            continue
        nav_date, current = nav.latest_nav(detail)
        value = round(holding.units * current, 2)
        rows.append({
            **base,
            "scheme_category": detail["scheme_category"],
            "fund_house": detail["fund_house"],
            "current_nav": round(current, 4),
            "nav_date": nav_date.isoformat(),
            "value": value,
            "gain": round(value - invested, 2),
            "gain_pct": round((value / invested - 1) * 100, 4) if invested else None,
            "return_1y": nav.trailing_return_pct(detail, 365),
            "data_available": True,
        })
    return rows


def portfolio_view(holdings) -> dict:
    rows = enrich(holdings)
    invested = sum(row["invested"] for row in rows)
    value = sum(row["value"] for row in rows)
    gain = value - invested
    flags = recommend.build_flags(rows)
    return {
        "holdings": rows,
        "totals": {
            "invested": invested,
            "value": value,
            "gain": gain,
            "gain_pct": round(gain / invested * 100, 4) if invested else None,
        },
        "flags": [{"severity": flag.severity, "title": flag.title, "detail": flag.detail} for flag in flags],
        "disclaimer": DISCLAIMER,
    }


def _sorted_breakdown(allocation: dict[str, float]) -> list[dict]:
    return [
        {"label": label, "pct": pct}
        for label, pct in sorted(allocation.items(), key=lambda item: item[1], reverse=True)
    ]


def _benchmark_xirr(available: list[dict], today: dt.date, history: list[tuple[dt.date, float]]) -> float | None:
    if not history:
        return None
    total = 0.0
    for row in available:
        equivalent = analysis.benchmark_equivalent_value(
            row["invested"], dt.date.fromisoformat(row["purchase_date"]), today, history
        )
        if equivalent is None:
            return None
        total += equivalent
    flows = [(dt.date.fromisoformat(row["purchase_date"]), -row["invested"]) for row in available]
    flows.append((today, total))
    return analysis.xirr(flows)


def _sample_dates(start: dt.date, today: dt.date) -> list[dt.date]:
    span = max((today - start).days, 1)
    step = 7 if span / 7 <= 160 else max(7, span // 160)
    dates: list[dt.date] = []
    cursor = start
    while cursor < today:
        dates.append(cursor)
        cursor += dt.timedelta(days=step)
    if not dates or dates[-1] != today:
        dates.append(today)
    return dates


def _growth(available: list[dict], histories: dict[str, list[tuple[dt.date, float]]]) -> list[dict]:
    schemes = []
    for row in available:
        detail = nav.get_scheme_detail(row["scheme_code"])
        if detail is None:
            continue
        schemes.append((
            dt.date.fromisoformat(row["purchase_date"]),
            row["units"],
            row["invested"],
            detail["nav_history"],
        ))
    if not schemes:
        return []
    start = min(item[0] for item in schemes)
    today = dt.date.today()
    if start >= today:
        return []
    points = []
    for day in _sample_dates(start, today):
        held = [item for item in schemes if item[0] <= day]
        if not held:
            continue
        portfolio_value = 0.0
        portfolio_ok = True
        for _, units, _, history in held:
            price = analysis.price_on_or_before(history, day)
            if price is None:
                portfolio_ok = False
                break
            portfolio_value += units * price
        benchmarks: dict[str, float | None] = {}
        for label, history in histories.items():
            if not history:
                benchmarks[label] = None
                continue
            total = 0.0
            ok = True
            for purchased, _, invested, _ in held:
                equivalent = analysis.benchmark_equivalent_value(invested, purchased, day, history)
                if equivalent is None:
                    ok = False
                    break
                total += equivalent
            benchmarks[label] = total if ok else None
        points.append({
            "date": day.isoformat(),
            "portfolio": portfolio_value if portfolio_ok else None,
            "benchmarks": benchmarks,
        })
    return points if len(points) >= 2 else []


def analysis_view(holdings) -> dict:
    rows = enrich(holdings)
    available = [row for row in rows if row["data_available"]]
    empty = {
        "ready": False,
        "xirr": None,
        "benchmarks": [],
        "funds": [],
        "asset_allocation": [],
        "market_cap": [],
        "amc": [],
        "growth": [],
        "notes": [],
        "disclaimer": DISCLAIMER,
        "lookthrough": LOOKTHROUGH,
    }
    if not available:
        return empty

    today = dt.date.today()
    histories = {label: nav.get_index_history(ticker) for label, ticker in nav.BENCHMARK_INDICES.items()}
    flows = [(dt.date.fromisoformat(row["purchase_date"]), -row["invested"]) for row in available]
    flows.append((today, sum(row["value"] for row in available)))
    portfolio_xirr = analysis.xirr(flows)
    benchmarks = [
        {"label": label, "xirr": _benchmark_xirr(available, today, history)}
        for label, history in histories.items()
    ]

    nifty = histories.get("NIFTY 500", [])
    funds = []
    for row in available:
        bought = dt.date.fromisoformat(row["purchase_date"])
        own = analysis.xirr([(bought, -row["invested"]), (today, row["value"])])
        equivalent = analysis.benchmark_equivalent_value(row["invested"], bought, today, nifty) if nifty else None
        bench = analysis.xirr([(bought, -row["invested"]), (today, equivalent)]) if equivalent is not None else None
        funds.append({
            "scheme_name": row["scheme_name"],
            "xirr": own,
            "benchmark_xirr": bench,
        })

    category_rows = [{"scheme_category": row["scheme_category"], "value": row["value"]} for row in available]
    asset_allocation = _sorted_breakdown(analysis.weighted_breakdown(category_rows, analysis.classify_asset_class))
    equity_rows = [
        row for row in category_rows
        if analysis.classify_asset_class(row["scheme_category"]) == "Equity"
    ]
    market_cap = (
        _sorted_breakdown(analysis.weighted_breakdown(equity_rows, analysis.classify_market_cap))
        if equity_rows else []
    )
    amc = _sorted_breakdown(analysis.amc_breakdown(
        [{"fund_house": row["fund_house"], "value": row["value"]} for row in available]
    ))

    notes: list[str] = []
    if asset_allocation and asset_allocation[0]["pct"] >= 80:
        top = asset_allocation[0]
        notes.append(
            f"Most of this portfolio is in {top['label']} ({top['pct']:.0f}%). "
            "Check whether that concentration matches the risk you want."
        )
    if market_cap and market_cap[0]["pct"] >= 50:
        top = market_cap[0]
        notes.append(f"Equity holdings are concentrated in {top['label']} ({top['pct']:.0f}%).")

    comparable = [item for item in benchmarks if item["xirr"] is not None and portfolio_xirr is not None]
    beaten = [item["label"] for item in comparable if portfolio_xirr > item["xirr"]]
    return {
        "ready": True,
        "xirr": portfolio_xirr,
        "benchmarks": benchmarks,
        "benchmarks_beaten": len(beaten),
        "benchmarks_compared": len(comparable),
        "funds": funds,
        "asset_allocation": asset_allocation,
        "market_cap": market_cap,
        "amc": amc,
        "growth": _growth(available, histories),
        "notes": notes,
        "disclaimer": DISCLAIMER,
        "lookthrough": LOOKTHROUGH,
    }
