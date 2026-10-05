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

PROVENANCE_FIELDS = (
    "operating_wc_complete",
    "cash_reported",
    "cash_status",
    "cash_source",
    "nwc_status",
    "debt_status",
    "debt_source",
    "source_overlay",
    "shares_status",
    "shares_source",
    "minority_interest_reported",
    "non_operating_investments",
    "non_operating_investments_status",
    "non_operating_investments_source",
    "screener_other_assets_plug",
    "screener_investments",
    "screener_borrowings",
)


def _classify_error(exc: BaseException) -> str:
    """stale_schema | other. Stale-schema is AttributeError on a provenance field."""
    if isinstance(exc, AttributeError):
        msg = str(exc)
        if any(name in msg for name in PROVENANCE_FIELDS):
            return "stale_schema"
    return "other"


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
    stale_schema: list[tuple[str, str, str, str]] = []
    other_errors: list[tuple[str, str, str, str]] = []
    for row in rows:
        label = row.ticker or row.name or row.id
        old_price = _per_share(row.run_json)
        try:
            company = load_company(row.company_json)
            hist = load_historicals(row.historicals_json)
            drivers = Drivers.model_validate(row.drivers_json)
            new_run = run_model(company, hist, drivers)
        except Exception as exc:  # noqa: BLE001 - this is an audit tool, keep going
            kind = _classify_error(exc)
            entry = (row.id, label, type(exc).__name__, repr(exc))
            if kind == "stale_schema":
                stale_schema.append(entry)
            else:
                other_errors.append(entry)
            continue
        new_price = _per_share(new_run)
        results.append((row.id, label, old_price, new_price))

    print(f"{'Ticker':<20}{'Old price':>15}{'New price':>15}{'Change':>12}")
    print("-" * 62)
    flagged = 0
    for _mid, label, old, new in sorted(
        results,
        key=lambda r: abs((r[3] - r[2]) / r[2]) if r[2] not in (None, 0) and r[3] is not None else -1,
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
    scanned = len(rows)
    succeeded = len(results)
    print("\n=== AUDIT SUMMARY ===")
    print(f"Total models scanned: {scanned}")
    print(f"Succeeded cleanly:    {succeeded}")
    print(f"Stale-schema AttributeError (provenance fields): {len(stale_schema)}")
    print(f"Other failures:       {len(other_errors)}")
    if stale_schema:
        print("\nStale-schema failures (AttributeError on operating_wc_complete / cash_reported / other provenance fields):")
        for mid, label, etype, err in stale_schema:
            print(f"  {mid}  {label}  {etype}: {err}")
    if other_errors:
        print("\nOther failures (not the stale-schema class):")
        for mid, label, etype, err in other_errors:
            print(f"  {mid}  {label}  {etype}: {err}")
    if not stale_schema and not other_errors:
        print("\nNo failures.")


if __name__ == "__main__":
    main()
