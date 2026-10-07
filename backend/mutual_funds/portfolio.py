"""
Turn stored mutual-fund lines into the portfolio and analysis the website shows.

Network calls stay in nav.py. Every return, window and comparison is computed in metrics.py;
this module only arranges those results and makes sure they share one set of dates. Nothing here
recommends a buy or a sell.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from . import analysis, benchmarks, consistency, metrics, nav
from .lots import Lot, build_lots, replay_all  # noqa: F401  (Lot and build_lots are re-exported)

DISCLAIMER = (
    "Observations are arithmetic over your own holdings. Not investment advice, "
    "and not a substitute for a SEBI-registered advisor."
)
LOOKTHROUGH = (
    "Asset class and market-cap splits follow each scheme's AMFI category. "
    "There is no free, reliable source for the stocks inside each fund, so this desk does not invent a sector look-through."
)
NAV_SOURCE = "AMFI daily NAV via mfapi.in"
INDEX_SOURCE = "Yahoo Finance index closes (price index)"
NAV_ENTRY_TOLERANCE_PCT = 1.5  # an entered purchase NAV this far from the published one is flagged


def _date(value) -> dt.date:
    return value if isinstance(value, dt.date) else dt.date.fromisoformat(value)


def plan_of(scheme_name: str) -> str:
    n = (scheme_name or "").lower()
    if "direct" in n:
        return "Direct"
    if "regular" in n:
        return "Regular"
    return "Unknown"


def enrich(holdings, transactions=None) -> list[dict]:
    lots = build_lots(holdings, transactions)
    books = replay_all(lots)
    first_by_code: dict[int, dt.date] = {}
    for lot in lots:
        first_by_code[lot.scheme_code] = min(lot.date, first_by_code.get(lot.scheme_code, lot.date))
    rows = []
    for holding in holdings:
        purchase = first_by_code.get(holding.scheme_code) or _date(holding.purchase_date)
        # What is still held, lot by lot: the cost includes the stamp duty paid inside each purchase,
        # and a redemption has already used up the oldest units first.
        open_lots = books[holding.scheme_code].open_lots if holding.scheme_code in books else []
        open_units = sum(o.units for o in open_lots)
        if open_lots and abs(open_units - holding.units) <= max(1e-6, holding.units * 1e-9):
            invested = round(sum(o.cost for o in open_lots), 2)
            avg_nav = sum(o.units * o.nav for o in open_lots) / open_units
        else:
            invested = round(holding.units * holding.avg_nav, 2)
            avg_nav = holding.avg_nav
        detail = nav.get_scheme_detail(holding.scheme_code)
        base = {
            "scheme_code": holding.scheme_code,
            "scheme_name": holding.scheme_name,
            "units": holding.units,
            "avg_nav": round(avg_nav, 4),
            "invested": invested,
            "purchase_date": purchase.isoformat(),
            "plan": plan_of(holding.scheme_name),
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
                "days_held": None,
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
            "days_held": max(0, (nav_date - purchase).days),
            "data_available": True,
        })
    return rows


def portfolio_view(holdings, transactions=None) -> dict:
    rows = enrich(holdings, transactions)
    invested = sum(row["invested"] for row in rows)
    value = sum(row["value"] for row in rows)
    gain = value - invested
    for row in rows:
        row["weight_pct"] = round(row["value"] / value * 100, 4) if value > 0 and row["data_available"] else None
    as_of = max((row["nav_date"] for row in rows if row["nav_date"]), default=None)
    return {
        "holdings": rows,
        "totals": {
            "invested": invested,
            "value": value,
            "gain": gain,
            "gain_pct": round(gain / invested * 100, 4) if invested else None,
            "as_of": as_of,
        },
        "disclaimer": DISCLAIMER,
    }


def _sorted_breakdown(allocation: dict[str, float]) -> list[dict]:
    return [
        {"label": label, "pct": pct}
        for label, pct in sorted(allocation.items(), key=lambda item: item[1], reverse=True)
    ]


# ---------------------------------------------------------------------------------------------
# dated series

def _sample_dates(start: dt.date, end: dt.date, anchors: set[dt.date]) -> list[dt.date]:
    span = max((end - start).days, 1)
    step = 7 if span / 7 <= 160 else max(7, span // 160)
    dates = set(anchors)
    cursor = start
    while cursor < end:
        dates.add(cursor)
        cursor += dt.timedelta(days=step)
    dates.add(end)
    return sorted(d for d in dates if start <= d <= end)


def _timeline(
    lots: list[Lot],
    nav_series: dict[int, metrics.Series],
    ref_series: dict[str, metrics.Series],
    start: dt.date,
    end: dt.date,
) -> tuple[list[dict], list[dict]]:
    """
    Two aligned series over the same dates:
      growth      rupee value of the portfolio, net money put in, and the same rupees in each index;
      performance time-weighted index (100 at the start) for the portfolio and each index.
    Returns ([], []) rather than guess if any purchase cannot be valued from published NAVs.
    """
    ordered = sorted(lots, key=lambda l: l.date)
    dates = _sample_dates(start, end, {l.date for l in ordered})
    units: dict[int, float] = defaultdict(float)
    replica: dict[str, dict[int, float]] = {k: defaultdict(float) for k in ref_series}
    broken: set[str] = set()
    base_level = {k: s.near(start) for k, s in ref_series.items()}
    net_invested = 0.0
    pending_flow = 0.0
    i = 0
    growth: list[dict] = []
    points: list[tuple[dt.date, float, float]] = []
    kept: list[dt.date] = []
    bench_idx: list[dict[str, float | None]] = []

    for d in dates:
        flow = 0.0
        while i < len(ordered) and ordered[i].date <= d:
            lot = ordered[i]
            i += 1
            px = nav_series[lot.scheme_code].near(lot.date)
            if px is None:
                return [], []
            flow += lot.units * px[1]
            held_before = units[lot.scheme_code]
            units[lot.scheme_code] = held_before + lot.units
            if lot.units > 0:
                net_invested += lot.amount
            else:
                net_invested -= lot.amount
            for key, series in ref_series.items():
                if key in broken:
                    continue
                level = series.near(lot.date)
                if level is None:
                    broken.add(key)
                elif lot.units > 0:
                    replica[key][lot.scheme_code] += lot.amount / level[1]
                elif held_before > 0:
                    replica[key][lot.scheme_code] *= max(0.0, 1 - (-lot.units) / held_before)
        value = 0.0
        ok = True
        for code, held in units.items():
            if held <= 1e-9:
                continue
            px = nav_series[code].near(d)
            if px is None:
                ok = False
                break
            value += held * px[1]
        if not ok:
            pending_flow += flow
            continue
        points.append((d, value, flow + pending_flow))
        pending_flow = 0.0
        kept.append(d)
        row_bench: dict[str, float | None] = {}
        row_idx: dict[str, float | None] = {}
        for key, series in ref_series.items():
            label = benchmarks.INDEX_TICKERS[key][1]
            level = series.near(d)
            if key in broken or level is None:
                row_bench[label] = None
            else:
                row_bench[label] = sum(replica[key].values()) * level[1]
            row_idx[label] = level[1] / base_level[key][1] * 100 if level and base_level[key] else None
        growth.append({"date": d.isoformat(), "portfolio": value, "invested": net_invested, "benchmarks": row_bench})
        bench_idx.append(row_idx)

    if len(points) < 2:
        return [], []
    chain = metrics.twr_index(points)
    performance = [
        {"date": d.isoformat(), "portfolio": level, "benchmarks": bench_idx[k]}
        for k, (d, level) in enumerate(chain)
    ]
    return growth, performance


# ---------------------------------------------------------------------------------------------
# analysis

def _fetch_index_series(keys: set[str]) -> dict[str, metrics.Series]:
    def load(key: str):
        return key, metrics.Series(nav.get_index_history(benchmarks.INDEX_TICKERS[key][0]))

    with ThreadPoolExecutor(max_workers=max(1, min(6, len(keys)))) as pool:
        return dict(pool.map(load, sorted(keys)))


def _signed_trades(lots: list[Lot]) -> list[tuple[dt.date, float, float]]:
    # The effective price is the cash per unit, so a purchase replicates the rupees actually paid
    # (stamp duty included) and a redemption the fraction actually sold.
    return [(l.date, l.units, l.amount / abs(l.units) if l.units else l.nav) for l in lots]


def _fund_result(row: dict, lots: list[Lot], end: dt.date, series: dict[str, metrics.Series]) -> dict:
    buys = [l for l in lots if l.units > 0]
    invested = sum(l.amount for l in buys)
    proceeds = sum(l.amount for l in lots if l.units < 0)
    first = min(l.date for l in lots)
    weighted_age = sum((end - l.date).days * l.amount for l in buys) / invested if invested else 0.0
    own = metrics.absolute_return_pct(invested, row["value"] + proceeds)
    flows = [(l.date, l.cash) for l in lots] + [(end, row["value"])]
    mapping = benchmarks.benchmark_for(row["scheme_category"], row["scheme_name"])
    bench = {**mapping, "return_pct": None, "status": "no_mapping", "start_date_used": None, "end_date_used": None}
    if mapping["key"]:
        replica = metrics.benchmark_replica(_signed_trades(lots), end, series[mapping["key"]])
        if replica is None:
            bench.update(status="no_data", reason="The index history does not cover these dates.")
        else:
            bench.update(status="available", return_pct=replica["pct"], end_date_used=replica["end_date_used"])
    rel = metrics.relative_performance(own, bench["return_pct"], days=round(weighted_age))
    cat = row["scheme_category"].lower()
    if ("index" in cat or "etf" in cat) and rel["verdict"] in ("outperformed", "underperformed", "in_line"):
        # A tracker's job is to follow its index, so "beat the index" is the wrong question, and the
        # benchmark here is a price index while the fund's NAV includes dividends.
        rel = {
            "relative_pp": rel["relative_pp"],
            "verdict": "tracking",
            "text": (
                f"Index fund: judged on how closely it tracks, not on beating the index. {rel['relative_pp']:+.1f} pts "
                "against a price index; dividends account for part of any gap."
            ),
        }
    return {
        "scheme_code": row["scheme_code"],
        "scheme_name": row["scheme_name"],
        "scheme_category": row["scheme_category"],
        "value": row["value"],
        "invested": invested,
        "period": metrics.period_between(first, end),
        "first_purchase": first.isoformat(),
        "days_held": (end - first).days,
        "weighted_age_days": round(weighted_age),
        "purchases": len(buys),
        "fund_return_pct": own,
        "xirr": metrics.xirr_result(flows),
        "benchmark": bench,
        "relative_pp": rel["relative_pp"],
        "verdict": rel["verdict"],
        "verdict_text": rel["text"],
    }


def _nav_entry_gaps(lots: list[Lot], details: dict[int, dict], names: dict[int, str]) -> list[dict]:
    gaps = []
    for lot in lots:
        if lot.units <= 0 or lot.source == "aggregated":
            continue
        found = metrics.nav_on_date(details[lot.scheme_code]["nav_history"], lot.date)
        if found is None:
            continue
        diff = (lot.nav / found[1] - 1) * 100
        if abs(diff) > NAV_ENTRY_TOLERANCE_PCT:
            gaps.append({
                "scheme_name": names.get(lot.scheme_code, str(lot.scheme_code)), "date": lot.date.isoformat(),
                "entered": lot.nav, "published": found[1], "diff_pct": diff,
            })
    return gaps


def analysis_view(holdings, transactions=None, *, today: dt.date | None = None) -> dict:
    today = today or dt.date.today()
    rows = enrich(holdings, transactions)
    available = [row for row in rows if row["data_available"]]
    empty = {
        "ready": False,
        "as_of": None,
        "period": None,
        "portfolio": None,
        "benchmarks": [],
        "funds": [],
        "checks": [],
        "data_quality": [],
        "asset_allocation": [],
        "market_cap": [],
        "amc": [],
        "growth": [],
        "performance": [],
        "notes": [],
        "disclaimer": DISCLAIMER,
        "lookthrough": LOOKTHROUGH,
    }
    if not available:
        return empty

    lots_all = build_lots(holdings, transactions)
    details = {code: nav.get_scheme_detail(code) for code in {l.scheme_code for l in lots_all}}
    lots = [l for l in lots_all if details.get(l.scheme_code)]
    held_codes = {row["scheme_code"] for row in available}
    end = min(today, max(_date(row["nav_date"]) for row in available))
    lots = [l for l in lots if l.date <= end]
    if not lots:
        return empty
    start = min(l.date for l in lots)
    period = metrics.period_between(start, end)

    by_scheme: dict[int, list[Lot]] = defaultdict(list)
    for lot in lots:
        by_scheme[lot.scheme_code].append(lot)

    maps = {row["scheme_code"]: benchmarks.benchmark_for(row["scheme_category"], row["scheme_name"]) for row in available}
    keys = set(benchmarks.REFERENCE_BENCHMARKS) | {m["key"] for m in maps.values() if m["key"]}
    series = _fetch_index_series(keys)
    nav_series = {code: metrics.Series(detail["nav_history"]) for code, detail in details.items() if detail}

    # portfolio, measured from the first purchase to the latest NAV, on every purchase and redemption
    total_in = sum(l.amount for l in lots if l.units > 0)
    total_out = sum(l.amount for l in lots if l.units < 0)
    value = sum(row["value"] for row in available)
    flows = [(l.date, l.cash) for l in lots] + [(end, value)]
    dates = {l.date for l in lots}
    single_date = len(dates) == 1
    abs_pct = metrics.absolute_return_pct(total_in, value + total_out)
    names = {row["scheme_code"]: row["scheme_name"] for row in available}
    gaps = _nav_entry_gaps(lots, {c: d for c, d in details.items() if d}, names)

    growth, performance = _timeline(lots, nav_series, {k: series[k] for k in benchmarks.REFERENCE_BENCHMARKS}, start, end)
    twr = performance[-1]["portfolio"] - 100 if performance else None

    portfolio = {
        "value": value,
        "total_invested": total_in,
        "realised_proceeds": total_out,
        "gain": value + total_out - total_in,
        "absolute_return_pct": abs_pct,
        "xirr": metrics.xirr_result(flows),
        "cagr_pct": metrics.cagr_pct(total_in, value + total_out, period["days"]) if single_date else None,
        "twr_pct": twr,
        "single_date": single_date,
        "nav_entries_match": not gaps,
        "transactions": len(lots),
        "transactions_source": "aggregated" if all(l.source == "aggregated" for l in lots) else "recorded",
        "period": period,
    }

    bench_out = []
    for key in benchmarks.REFERENCE_BENCHMARKS:
        ticker, label = benchmarks.INDEX_TICKERS[key]
        replicas = [
            metrics.benchmark_replica(_signed_trades(group), end, series[key])
            for code, group in by_scheme.items()
        ]
        entry = {"key": key, "label": label, "ticker": ticker, "source": INDEX_SOURCE, "basis": benchmarks.PRICE_BASIS_NOTE,
                 "return_pct": None, "index_move_pct": None, "xirr": None, "period": period}
        if replicas and all(r is not None for r in replicas):
            invested = sum(r["invested"] for r in replicas)
            proceeds = sum(r["proceeds"] for r in replicas)
            terminal = sum(r["terminal"] for r in replicas)
            rflows = sorted([f for r in replicas for f in r["flows"]], key=lambda f: f[0]) + [(end, terminal)]
            entry["return_pct"] = metrics.absolute_return_pct(invested, terminal + proceeds)
            entry["xirr"] = metrics.xirr_result(rflows)
        rel = metrics.relative_performance(abs_pct, entry["return_pct"], days=period["days"])
        entry["relative_pp"] = rel["relative_pp"]
        entry["verdict"] = rel["verdict"]
        entry["verdict_text"] = rel["text"]
        move = metrics.index_return_pct(series[key], start, end)
        if move:
            entry["index_move_pct"] = move["pct"]
            entry["start_date_used"] = move["start_date_used"]
            entry["end_date_used"] = move["end_date_used"]
        bench_out.append(entry)

    funds = [_fund_result(row, by_scheme[row["scheme_code"]], end, series) for row in available if by_scheme.get(row["scheme_code"])]

    category_rows = [{"scheme_category": row["scheme_category"], "value": row["value"]} for row in available]
    asset_allocation = _sorted_breakdown(analysis.weighted_breakdown(category_rows, analysis.classify_asset_class))
    equity_rows = [r for r in category_rows if analysis.classify_asset_class(r["scheme_category"]) == "Equity"]
    market_cap = (
        _sorted_breakdown(analysis.weighted_breakdown(equity_rows, analysis.classify_market_cap)) if equity_rows else []
    )
    amc = _sorted_breakdown(analysis.amc_breakdown([{"fund_house": r["fund_house"], "value": r["value"]} for r in available]))

    report = {
        "ready": True,
        "as_of": end.isoformat(),
        "period": period,
        "portfolio": portfolio,
        "benchmarks": bench_out,
        "funds": funds,
        "growth": growth,
        "performance": performance,
        "asset_allocation": asset_allocation,
        "market_cap": market_cap,
        "amc": amc,
        "notes": [],
        "disclaimer": DISCLAIMER,
        "lookthrough": LOOKTHROUGH,
        "held_codes": sorted(held_codes),
    }
    checks = consistency.run_checks(report)
    if gaps:
        first = gaps[0]
        checks.append({
            "id": "purchase-nav", "status": "warn", "affects": [],
            "message": (
                f"{len(gaps)} purchase{'s' if len(gaps) != 1 else ''} used a NAV that differs from the published one by more than "
                f"{NAV_ENTRY_TOLERANCE_PCT:g}% (for example {first['scheme_name']} on {first['date']}: entered ₹{first['entered']:.2f}, "
                f"published ₹{first['published']:.2f}). Returns follow what was entered."
            ),
        })
    report["checks"] = checks
    report["blocked"] = sorted(consistency.blocked_metrics(checks))
    report["data_quality"] = _data_quality(report)
    report.pop("held_codes")
    return report


def _data_quality(report: dict) -> list[dict]:
    period = report["period"]
    portfolio = report["portfolio"]
    xirr = portfolio["xirr"]
    out = [
        {"metric": "NAVs and portfolio value", "status": "available", "source": NAV_SOURCE, "as_of": report["as_of"],
         "period": None, "note": "Units x the latest published NAV."},
        {"metric": "Annualized return (XIRR)", "status": "available" if xirr["annualized"] else "unavailable",
         "source": "Computed from your dated purchases", "as_of": report["as_of"], "period": period, "note": xirr["note"]},
    ]
    for b in report["benchmarks"]:
        ok = b["return_pct"] is not None
        out.append({
            "metric": b["label"], "status": "available" if ok else "unavailable", "source": INDEX_SOURCE,
            "as_of": b.get("end_date_used") or report["as_of"], "period": period,
            "note": b["basis"] if ok else "Index history does not cover this period.",
        })
    days = period["days"]
    out.append({
        "metric": "Risk metrics (volatility, Sharpe, beta, capture)",
        "status": "available" if days >= metrics.MIN_ANNUALIZE_DAYS else "unavailable",
        "source": "Computed from weekly time-weighted marks", "as_of": report["as_of"], "period": period,
        "note": f"Needs at least {metrics.MIN_ANNUALIZE_DAYS} days of history; this portfolio has {days}." if days < metrics.MIN_ANNUALIZE_DAYS else "Weekly marks.",
    })
    out.append({"metric": "Category average", "status": "unavailable", "source": "-", "as_of": None, "period": None,
                "note": "No source for category-average returns is connected."})
    out.append({"metric": "Fund holdings (overlap, sectors, top stocks)", "status": "unavailable", "source": "-", "as_of": None, "period": None,
                "note": "Needs each fund's monthly portfolio disclosure, which is not connected."})
    out.append({"metric": "Expense ratio", "status": "unavailable", "source": "-", "as_of": None, "period": None,
                "note": "No expense-ratio feed is connected. Direct vs regular is read from the scheme name only."})
    return out
