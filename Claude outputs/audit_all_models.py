"""
Re-run every saved DCF model through the fixed engine and report which
implied share prices moved, and by how much.

This does NOT touch the database - it only reads existing saved models,
recomputes with the current (patched) code, and prints a comparison.
Run it AFTER dropping in the patched forecast.py / growth_intelligence.py
and restarting the server (or just run this script directly - it imports
the engine code the same way the server does, so no server restart is
needed to get the audit itself).

Usage (from the repo root, same place you'd run the FastAPI app from):
    python audit_all_models.py
    python audit_all_models.py --min-change-pct 5     # only show meaningful moves
    python audit_all_models.py --ticker NTPC.NS        # just one company
"""
from __future__ import annotations

import argparse
import sys

from backend.api.db import get_db
from backend.api.orm import ValuationModel
from backend.api.valuation_service import Drivers, load_company, load_historicals, run_model


def _per_share(run_json: dict | None) -> float | None:
    if not run_json:
        return None
    val = run_json.get("valuation") or {}
    bridge = val.get("equity_bridge") or {}
    return bridge.get("equity_value_per_share")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-change-pct", type=float, default=0.0,
                         help="Only print rows where the implied share price moved by at least this %% (abs).")
    parser.add_argument("--ticker", type=str, default=None,
                         help="Only re-run this one ticker.")
    args = parser.parse_args()

    db = next(get_db())
    query = db.query(ValuationModel)
    if args.ticker:
        query = query.filter(ValuationModel.ticker == args.ticker)
    rows = query.all()

    if not rows:
        print("No saved models found (empty DB, or wrong working directory / DB path).")
        sys.exit(0)

    results = []
    errors = []
    for row in rows:
        label = row.ticker or row.name or row.id
        old_price = _per_share(row.run_json)
        try:
            company = load_company(row.company_json)
            hist = load_historicals(row.historicals_json)
            drivers = Drivers.model_validate(row.drivers_json)
            new_run = run_model(company, hist, drivers)
        except Exception as exc:  # noqa: BLE001 - this is an audit tool, keep going
            errors.append((label, repr(exc)))
            continue
        new_price = _per_share(new_run)
        results.append((label, old_price, new_price))

    print(f"{'Ticker':<20}{'Old price':>15}{'New price':>15}{'Change':>12}")
    print("-" * 62)
    flagged = 0
    for label, old, new in sorted(
        results,
        key=lambda r: abs((r[2] - r[1]) / r[1]) if r[1] not in (None, 0) and r[2] is not None else -1,
        reverse=True,
    ):
        if old is None or new is None:
            change_str = "n/a"
            pct = None
        elif old == 0:
            change_str = "n/a (old=0)"
            pct = None
        else:
            pct = (new - old) / abs(old) * 100
            change_str = f"{pct:+.1f}%"
        if args.min_change_pct and (pct is None or abs(pct) < args.min_change_pct):
            continue
        flagged += 1
        old_str = f"{old:,.2f}" if old is not None else "n/a"
        new_str = f"{new:,.2f}" if new is not None else "n/a"
        print(f"{label:<20}{old_str:>15}{new_str:>15}{change_str:>12}")

    print(f"\n{flagged} of {len(results)} shown (filtered by --min-change-pct={args.min_change_pct}).")
    if errors:
        print(f"\n{len(errors)} model(s) failed to re-run:")
        for label, err in errors:
            print(f"  {label}: {err}")


if __name__ == "__main__":
    main()
