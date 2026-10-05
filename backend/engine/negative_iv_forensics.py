"""System-wide negative-IV forensics.

A negative residual equity value is mathematically allowed. This module does not
floor it, lower WACC, raise growth, or calibrate to the market quote. It checks
identities, units, the equity bridge, and whether the forecast/WACC/bridge is
fit to display a precise intrinsic value.
"""
from __future__ import annotations

from typing import Any

from .forecast import ForecastResult
from .models import Company, HistoricalFinancials
from .valuation import DCFValuationResult
from .wacc import WaccResult

IDENTITY_TOLERANCE = 1.0  # engine millions (~₹0.1 Cr)
WACC_REVIEW = 0.18
WACC_HIGH = 0.20
WACC_EXTREME = 0.25

NEGATIVE_CLASSES = (
    "GENUINE_NEGATIVE_EQUITY",
    "MODEL_ERROR",
    "DATA_INCOMPLETE",
    "FORECAST_UNCERTAIN",
    "METHODOLOGY_BLOCKED",
)

SITUATIONS = {
    "A": "Genuine economic residual: EV is below net debt and other claims after a complete bridge.",
    "B": "Operating forecast: FCFF is depressed by margins, capex, tax, or working capital.",
    "C": "Capital structure / WACC: discount rate is unusually high for the cash-flow path.",
    "D": "Equity bridge: cash, investments, debt, leases, or NCI are missing or misclassified.",
}


def fcff_from_components(ebit: float, tax_rate: float, da: float, capex: float, change_in_nwc: float) -> dict[str, float]:
    """Canonical FCFF. Negative EBIT does not create a tax credit."""
    taxes_on_ebit = max(ebit, 0.0) * tax_rate
    nopat = ebit - taxes_on_ebit
    fcff = nopat + da - capex - change_in_nwc
    return {"nopat": nopat, "taxes_on_ebit": taxes_on_ebit, "fcff": fcff}


def crore_to_millions(crore: float) -> float:
    return crore * 10.0


def millions_to_crore(millions: float) -> float:
    return millions / 10.0


def equity_bridge_difference(
    *,
    enterprise_value: float,
    cash: float,
    non_operating_assets: float,
    debt: float,
    lease_liabilities: float,
    nci: float,
    other_claims: float,
    equity_value: float,
) -> float:
    return (
        enterprise_value
        + cash
        + non_operating_assets
        - debt
        - lease_liabilities
        - nci
        - other_claims
        - equity_value
    )


def verify_valuation_identities(valuation: DCFValuationResult) -> dict[str, Any]:
    bridge = valuation.equity_bridge
    ev_lhs = valuation.enterprise_value
    ev_rhs = valuation.pv_of_explicit_fcf + valuation.pv_of_terminal_value
    ev_diff = ev_lhs - ev_rhs
    bridge_diff = equity_bridge_difference(
        enterprise_value=bridge.enterprise_value,
        cash=bridge.plus_cash_and_investments,
        non_operating_assets=bridge.plus_non_operating_investments,
        debt=bridge.less_total_debt,
        lease_liabilities=bridge.less_lease_liabilities,
        nci=bridge.less_minority_interest,
        other_claims=bridge.less_preferred_stock,
        equity_value=bridge.equity_value,
    )
    shares = bridge.diluted_shares_outstanding
    per_share = None
    per_share_ok = True
    if shares:
        per_share = bridge.equity_value / shares
        if bridge.equity_value_per_share is not None and bridge.bridge_complete:
            per_share_ok = abs(per_share - bridge.equity_value_per_share) <= 1e-6
    ev_ok = abs(ev_diff) <= IDENTITY_TOLERANCE
    bridge_ok = abs(bridge_diff) <= IDENTITY_TOLERANCE
    blocked = not (ev_ok and bridge_ok)
    return {
        "ev_identity_ok": ev_ok,
        "ev_difference": ev_diff,
        "bridge_difference": bridge_diff,
        "bridge_identity_ok": bridge_ok,
        "per_share": per_share,
        "per_share_ok": per_share_ok,
        "blocked": blocked,
        "block_reason": (
            None
            if not blocked
            else (
                f"Identity failed: EV difference {ev_diff:,.4f}, "
                f"bridge difference {bridge_diff:,.4f}. Intrinsic value is blocked."
            )
        ),
    }


def audit_cash_bridge(bs, cash_used: float) -> dict[str, Any]:
    reported = float(bs.cash or 0.0) + float(bs.marketable_securities or 0.0)
    status = (bs.cash_status or "unavailable").lower()
    difference = reported - cash_used
    missing = status in {"unavailable", "not_applicable"} or (not bs.cash_reported and status != "available")
    critical = missing and abs(cash_used) < IDENTITY_TOLERANCE
    silent_zero = critical
    return {
        "reported_cash": reported,
        "cash_used_in_dcf": cash_used,
        "difference": difference,
        "status": status,
        "source": bs.cash_source or "",
        "critical_data_bridge_error": silent_zero,
        "note": (
            "CRITICAL DATA BRIDGE ERROR: reported cash is unavailable and DCF cash is a silent zero."
            if silent_zero
            else "Cash used in the equity bridge matches the latest classified cash and cash-like line."
            if abs(difference) <= IDENTITY_TOLERANCE
            else f"Cash used ({cash_used:,.1f}) differs from reported cash-like ({reported:,.1f})."
        ),
    }


def classify_investment_lines(bs) -> list[dict[str, Any]]:
    overlay = dict(bs.source_overlay or {})
    rows = [
        ("Cash", bs.cash, "cash", "non_operating", False, True, bs.cash_source or "latest cash line", "High"),
        (
            "Cash equivalents / short-term investments",
            bs.marketable_securities,
            "cash_equivalent",
            "non_operating",
            False,
            True,
            "Yahoo short-term investments" if overlay else "marketable securities",
            "High",
        ),
        (
            "Long-term investments",
            overlay.get("long_term_investments"),
            "long_term_investments",
            "mixed",
            False,
            True,
            "Yahoo long-term investments / investments and advances",
            "Medium",
        ),
        (
            "Marketable / available-for-sale securities",
            overlay.get("available_for_sale"),
            "marketable_securities",
            "non_operating",
            False,
            True,
            "Yahoo available-for-sale / other investments",
            "Medium",
        ),
        (
            "Associates / joint ventures / equity method",
            overlay.get("associate_investments"),
            "associates",
            "non_operating",
            False,
            True,
            "Yahoo long-term equity investment",
            "Medium",
        ),
        (
            "Other financial assets",
            overlay.get("other_financial_assets"),
            "other_financial_assets",
            "mixed",
            False,
            True,
            "Yahoo financial assets",
            "Low",
        ),
        (
            "Screener compact Investments (unclassified)",
            getattr(bs, "screener_investments", None),
            "screener_investments",
            "unknown",
            False,
            False,
            "Screener Investments line — not treated as cash and not auto-added",
            "Low",
        ),
    ]
    out = []
    for name, amount, kind, operating, in_ev, in_bridge, source, confidence in rows:
        if amount is None:
            continue
        out.append(
            {
                "name": name,
                "amount": float(amount),
                "classification": kind,
                "operating": operating,
                "included_in_ev": in_ev,
                "added_in_equity_bridge": in_bridge and operating != "unknown",
                "reason": source,
                "source": source,
                "confidence": confidence,
            }
        )
    return out


def classify_other_assets(bs) -> list[dict[str, Any]]:
    overlay = dict(bs.source_overlay or {})
    residual = float(bs.other_assets or 0.0)
    plug = bs.screener_other_assets_plug
    return [
        {
            "name": "screener_other_assets_plug",
            "amount": plug,
            "classification": "balance_sheet_plug",
            "operating": "unknown",
            "included_in_ev": False,
            "added_in_equity_bridge": False,
            "reason": "Screener Other Assets = Total Assets − Fixed Assets − CWIP. Not a real line.",
            "source": "Screener compact balance sheet",
        },
        {
            "name": "other_assets (latest residual after overlay)",
            "amount": residual,
            "classification": "residual_unknown",
            "operating": "unknown",
            "included_in_ev": False,
            "added_in_equity_bridge": False,
            "reason": "Yahoo Total Assets minus mapped lines. Not auto-added.",
            "source": overlay.get("period") or bs.period,
        },
        {
            "name": "other_current_assets",
            "amount": bs.other_current_assets,
            "classification": "operating_or_prepaid",
            "operating": "operating",
            "included_in_ev": True,
            "added_in_equity_bridge": False,
            "reason": "Working-capital / prepaid. Already in FCFF via ΔNWC when complete.",
            "source": "Yahoo prepaid/hedging or other current assets",
        },
        {
            "name": "other_financial_assets",
            "amount": overlay.get("other_financial_assets"),
            "classification": "financial_asset",
            "operating": "mixed",
            "included_in_ev": False,
            "added_in_equity_bridge": overlay.get("other_financial_assets") is not None,
            "reason": "Added only when Yahoo labels the line as financial assets.",
            "source": "Yahoo Financial Assets",
        },
    ]


def audit_debt(bs, debt_used: float, leases_used: float) -> dict[str, Any]:
    overlay = dict(bs.source_overlay or {})
    source_debt = float(bs.short_term_debt or 0.0) + float(bs.long_term_debt or 0.0)
    screener_borrowings = getattr(bs, "screener_borrowings", None)
    total_liabilities = bs.total_liabilities
    debt_is_total_liabilities = (
        total_liabilities > IDENTITY_TOLERANCE
        and abs(debt_used - total_liabilities) <= IDENTITY_TOLERANCE
        and (bs.other_liabilities or 0.0) > IDENTITY_TOLERANCE
    )
    yahoo_combined = (overlay.get("current_debt_and_leases") or 0.0) + (
        overlay.get("long_term_debt_and_leases") or 0.0
    )
    yahoo_leases = (overlay.get("current_leases") or 0.0) + (overlay.get("long_term_leases") or 0.0)
    double_count = False
    if yahoo_combined > IDENTITY_TOLERANCE and yahoo_leases > IDENTITY_TOLERANCE:
        if abs((debt_used + leases_used) - yahoo_combined) <= IDENTITY_TOLERANCE * 5:
            double_count = abs(debt_used - yahoo_combined) <= IDENTITY_TOLERANCE * 5
    operating_liab = (bs.accounts_payable or 0.0) + (bs.accrued_liabilities or 0.0) + (bs.other_liabilities or 0.0)
    return {
        "source_debt": source_debt,
        "dcf_debt": debt_used,
        "difference": source_debt - debt_used,
        "current_borrowings": bs.short_term_debt,
        "long_term_borrowings": bs.long_term_debt,
        "lease_liabilities": leases_used,
        "screener_borrowings": screener_borrowings,
        "yahoo_debt_and_leases": yahoo_combined or None,
        "yahoo_leases": yahoo_leases or None,
        "other_liabilities": bs.other_liabilities,
        "total_liabilities": total_liabilities,
        "debt_equals_total_liabilities": debt_is_total_liabilities,
        "operating_liabilities_excluded": operating_liab,
        "lease_double_count": double_count,
        "ok": (not debt_is_total_liabilities) and (not double_count),
    }


def audit_fcff_units(forecast: ForecastResult) -> dict[str, Any]:
    issues: list[str] = []
    for y in forecast.years:
        expected = fcff_from_components(y.ebit, y.tax_rate, y.da, y.capex, y.change_in_nwc)
        if abs(expected["fcff"] - y.fcff) > IDENTITY_TOLERANCE:
            issues.append(f"{y.period}: stored FCFF {y.fcff:,.2f} != formula {expected['fcff']:,.2f}")
        if abs(expected["nopat"] - y.nopat) > IDENTITY_TOLERANCE:
            issues.append(f"{y.period}: stored NOPAT {y.nopat:,.2f} != formula {expected['nopat']:,.2f}")
        if y.ebit < 0 and y.taxes_on_ebit < -IDENTITY_TOLERANCE:
            issues.append(f"{y.period}: negative tax expense on negative EBIT inflated FCFF")
        magnitudes = [abs(y.revenue), abs(y.ebit), abs(y.nopat), abs(y.da), abs(y.capex), abs(y.change_in_nwc), abs(y.fcff)]
        nonzero = [m for m in magnitudes if m > 1.0]
        if nonzero and max(nonzero) / max(min(nonzero), 1e-9) > 1e7:
            issues.append(f"{y.period}: component magnitudes differ by >1e7 — possible unit mix")
    return {"ok": not issues, "issues": issues}


def audit_terminal_value(valuation: DCFValuationResult, wacc: float) -> dict[str, Any]:
    g = valuation.terminal_growth
    n = len(valuation.discounted_years)
    last_fcff = valuation.discounted_years[-1].fcff if valuation.discounted_years else 0.0
    wacc_gt_g = wacc > g
    expected_terminal_fcff = last_fcff * (1 + g)
    expected_tv = expected_terminal_fcff / (wacc - g) if wacc_gt_g else None
    tv_ok = expected_tv is not None and abs(expected_tv - valuation.terminal_value_gordon) <= max(
        IDENTITY_TOLERANCE, 1e-6 * abs(expected_tv)
    )
    expected_factor = 1 / (1 + wacc) ** n if n else 1.0
    expected_pv = valuation.terminal_value_gordon * expected_factor
    discount_ok = abs(expected_pv - valuation.pv_of_terminal_value) <= max(
        IDENTITY_TOLERANCE, 1e-6 * abs(expected_pv)
    )
    double_discounted = False
    if n:
        twice = valuation.terminal_value_gordon * expected_factor * expected_factor
        double_discounted = abs(twice - valuation.pv_of_terminal_value) <= max(
            IDENTITY_TOLERANCE, 1e-6 * abs(twice)
        ) and not discount_ok
    return {
        "wacc_gt_g": wacc_gt_g,
        "blocked_wacc_le_g": not wacc_gt_g,
        "terminal_fcff_ok": tv_ok,
        "expected_terminal_fcff": expected_terminal_fcff,
        "expected_tv": expected_tv,
        "discounted_once": discount_ok,
        "discounted_twice": double_discounted,
        "tv_pct_ev": valuation.terminal_value_pct_of_ev,
    }


def dcf_plausibility_checks(
    *,
    forecast: ForecastResult,
    valuation: DCFValuationResult | None,
    wacc: float,
    terminal_growth: float,
    cash_audit: dict[str, Any],
    debt_audit: dict[str, Any],
    identities: dict[str, Any] | None,
    shares: float | None,
    fcff_appropriate: bool,
    units_ok: bool,
) -> list[dict[str, Any]]:
    y1 = forecast.years[0] if forecast.years else None
    y5 = forecast.years[-1] if forecast.years else None
    fcffs = [y.fcff for y in forecast.years]
    ev = valuation.enterprise_value if valuation else None
    net_debt = None
    if valuation:
        net_debt = (
            valuation.equity_bridge.less_total_debt
            + valuation.equity_bridge.less_lease_liabilities
            - valuation.equity_bridge.plus_cash_and_investments
        )
    checks = [
        {"id": 1, "name": "Is FCFF positive?", "ok": bool(fcffs) and fcffs[0] > 0, "detail": f"Y1 FCFF {fcffs[0]:,.1f}." if fcffs else "no forecast"},
        {
            "id": 2,
            "name": "Is FCFF growing reasonably?",
            "ok": bool(y1 and y5) and (y5.fcff >= y1.fcff * 0.5),
            "detail": f"Y1 {y1.fcff:,.1f} → Y5 {y5.fcff:,.1f}." if y1 and y5 else "n/a",
        },
        {
            "id": 3,
            "name": "Is WACC reasonable?",
            "ok": 0.05 < wacc < WACC_REVIEW,
            "detail": f"WACC {wacc:.2%}. Review if above {WACC_REVIEW:.0%}.",
        },
        {
            "id": 4,
            "name": "Is terminal growth reasonable?",
            "ok": 0 <= terminal_growth < wacc - 0.01 and terminal_growth <= 0.06,
            "detail": f"g {terminal_growth:.2%} vs WACC {wacc:.2%}.",
        },
        {
            "id": 5,
            "name": "Is TV/EV reasonable?",
            "ok": valuation is not None and 0.20 <= valuation.terminal_value_pct_of_ev <= 0.90,
            "detail": f"TV/EV {valuation.terminal_value_pct_of_ev:.0%}." if valuation else "no valuation",
        },
        {
            "id": 6,
            "name": "Is EV reasonable relative to revenue/EBITDA?",
            "ok": y1 is not None and ev is not None and ev > 0 and (ev / y1.revenue if y1.revenue else 0) < 40,
            "detail": f"EV/Y1 sales {(ev / y1.revenue):.1f}x." if y1 and ev and y1.revenue else "n/a",
        },
        {
            "id": 7,
            "name": "Is EV below net debt?",
            "ok": not (ev is not None and net_debt is not None and ev < net_debt and ev > 0),
            "detail": f"EV {ev:,.1f} vs net debt {net_debt:,.1f}." if ev is not None and net_debt is not None else "n/a",
        },
        {
            "id": 8,
            "name": "Is the equity bridge complete?",
            "ok": bool(valuation and valuation.equity_bridge.bridge_complete and identities and not identities["blocked"]),
            "detail": (valuation.equity_bridge.block_reason if valuation else None) or (identities or {}).get("block_reason") or "complete",
        },
        {
            "id": 9,
            "name": "Are cash/investments available?",
            "ok": not cash_audit.get("critical_data_bridge_error"),
            "detail": cash_audit.get("note"),
        },
        {
            "id": 10,
            "name": "Are debt and leases correctly classified?",
            "ok": bool(debt_audit.get("ok")),
            "detail": (
                "Debt equals total liabilities."
                if debt_audit.get("debt_equals_total_liabilities")
                else "Leases appear double-counted."
                if debt_audit.get("lease_double_count")
                else "Borrowings used as debt; operating liabilities excluded."
            ),
        },
        {"id": 11, "name": "Are shares correct?", "ok": bool(shares and shares > 0), "detail": f"Diluted shares {shares}." if shares else "missing"},
        {"id": 12, "name": "Are units correct?", "ok": units_ok, "detail": "Revenue/EBIT/NOPAT/DA/capex/ΔNWC/FCFF share one unit."},
        {"id": 13, "name": "Is the company type appropriate for FCFF?", "ok": fcff_appropriate, "detail": "Standard FCFF/WACC DCF." if fcff_appropriate else "FCFF DCF is blocked for this company type."},
    ]
    return checks


def model_health_gate(
    *,
    units_ok: bool,
    fcff_formula_ok: bool,
    wacc: float,
    terminal_growth: float,
    tv_audit: dict[str, Any] | None,
    cash_audit: dict[str, Any],
    debt_audit: dict[str, Any],
    identities: dict[str, Any] | None,
    shares: float | None,
    nci_ok: bool,
    investments_status: str,
    fcff_appropriate: bool,
) -> dict[str, Any]:
    items = [
        {"id": "units", "ok": units_ok, "critical": True, "label": "Units"},
        {"id": "fcff_formula", "ok": fcff_formula_ok, "critical": True, "label": "FCFF formula"},
        {"id": "wacc", "ok": wacc > terminal_growth + 0.005, "critical": True, "label": "WACC"},
        {
            "id": "terminal_value",
            "ok": bool(tv_audit and tv_audit.get("wacc_gt_g") and tv_audit.get("discounted_once") and not tv_audit.get("discounted_twice")),
            "critical": True,
            "label": "Terminal value",
        },
        {"id": "cash", "ok": not cash_audit.get("critical_data_bridge_error"), "critical": True, "label": "Cash"},
        {"id": "debt", "ok": bool(debt_audit.get("ok")), "critical": True, "label": "Debt"},
        {
            "id": "investments",
            "ok": investments_status in {"available", "none_material", "classified"},
            "critical": investments_status == "silent_zero_material",
            "label": "Investments",
        },
        {"id": "nci", "ok": nci_ok, "critical": False, "label": "NCI"},
        {"id": "shares", "ok": bool(shares and shares > 0), "critical": True, "label": "Shares"},
        {
            "id": "equity_bridge",
            "ok": bool(identities and not identities.get("blocked")),
            "critical": True,
            "label": "Equity bridge",
        },
        {"id": "methodology", "ok": fcff_appropriate, "critical": True, "label": "Company type"},
    ]
    critical_fail = [i for i in items if i["critical"] and not i["ok"]]
    passed = not critical_fail
    return {
        "passed": passed,
        "items": items,
        "critical_failures": [i["id"] for i in critical_fail],
        "intrinsic_value": "shown" if passed else "BLOCKED",
        "block_reason": None if passed else "Model health failed: " + ", ".join(i["label"] for i in critical_fail),
    }


def _primary_driver(
    *,
    valuation: DCFValuationResult,
    forecast: ForecastResult,
    wacc: float,
    cash_audit: dict[str, Any],
    debt_audit: dict[str, Any],
    identities: dict[str, Any],
    health: dict[str, Any],
) -> tuple[str, str, str]:
    """Return (situation A-D, primary driver sentence, class)."""
    bridge = valuation.equity_bridge
    ev = valuation.enterprise_value
    claims = bridge.less_total_debt + bridge.less_lease_liabilities + bridge.less_minority_interest + bridge.less_preferred_stock
    assets = bridge.plus_cash_and_investments + bridge.plus_non_operating_investments
    net_debt = bridge.less_total_debt + bridge.less_lease_liabilities - bridge.plus_cash_and_investments
    y1 = forecast.years[0] if forecast.years else None
    y5 = forecast.years[-1] if forecast.years else None
    capex_heavy = bool(y5 and y5.revenue and y5.capex > 1.4 * max(y5.da, 1.0))
    fcff_low = bool(y1 and y1.fcff <= 0) or bool(y5 and y5.fcff <= 0)

    if not health["passed"] and any(x in health["critical_failures"] for x in ("units", "fcff_formula", "terminal_value", "debt")):
        return "D", "Primary driver: Model identity or debt classification error.", "MODEL_ERROR"
    if cash_audit.get("critical_data_bridge_error") or identities.get("blocked"):
        return "D", "Primary driver: Equity bridge is incomplete.", "DATA_INCOMPLETE"
    if debt_audit.get("debt_equals_total_liabilities") or debt_audit.get("lease_double_count"):
        return "D", "Primary driver: Debt is misclassified.", "MODEL_ERROR"
    # Leverage is a mechanical bridge fact (debt+leases exceed EV+cash) and
    # should take priority over softer forecast-quality heuristics like capex ratios.
    if ev < net_debt:
        return "A", "Primary driver: High debt relative to enterprise value.", "GENUINE_NEGATIVE_EQUITY"
    if claims - assets > ev:
        return "A", "Primary driver: High debt relative to enterprise value.", "GENUINE_NEGATIVE_EQUITY"
    if wacc >= WACC_HIGH:
        return "C", "Primary driver: WACC is unusually high.", "FORECAST_UNCERTAIN"
    if fcff_low or capex_heavy:
        return "B", "Primary driver: FCFF forecast is too low.", "FORECAST_UNCERTAIN"
    return "D", "Primary driver: Data quality insufficient.", "DATA_INCOMPLETE"


def classify_negative_result(
    *,
    equity_value: float,
    fcff_appropriate: bool,
    health: dict[str, Any],
    situation: str,
    proposed: str,
    cash_audit: dict[str, Any],
    investments_status: str,
    forecast_uncertain: bool,
) -> str:
    if not fcff_appropriate:
        return "METHODOLOGY_BLOCKED"
    if equity_value >= 0:
        return "POSITIVE"
    if health["critical_failures"] and any(
        x in health["critical_failures"] for x in ("units", "fcff_formula", "terminal_value", "debt", "equity_bridge")
    ):
        if "cash" in health["critical_failures"] or investments_status == "silent_zero_material":
            return "DATA_INCOMPLETE"
        return "MODEL_ERROR"
    if cash_audit.get("critical_data_bridge_error") or investments_status == "silent_zero_material":
        return "DATA_INCOMPLETE"
    if proposed in NEGATIVE_CLASSES:
        if proposed == "GENUINE_NEGATIVE_EQUITY" and situation in {"B", "C"}:
            return "FORECAST_UNCERTAIN"
        return proposed
    return "FORECAST_UNCERTAIN"


def run_negative_iv_diagnostics(
    company: Company,
    hist: HistoricalFinancials,
    forecast: ForecastResult,
    valuation: DCFValuationResult | None,
    wacc_result: WaccResult | None,
    *,
    fcff_appropriate: bool = True,
    fcff_block_reason: str | None = None,
    profile_template: str = "",
    terminal_growth: float | None = None,
) -> dict[str, Any]:
    latest = hist.balance_sheets[-1]
    overlay = dict(latest.source_overlay or {})
    y1 = forecast.years[0] if forecast.years else None
    y5 = forecast.years[-1] if forecast.years else None
    wacc = wacc_result.wacc if wacc_result else 0.0
    g = terminal_growth if terminal_growth is not None else (valuation.terminal_growth if valuation else 0.0)

    identities = verify_valuation_identities(valuation) if valuation else None
    cash_used = valuation.equity_bridge.plus_cash_and_investments if valuation else 0.0
    cash_audit = audit_cash_bridge(latest, cash_used)
    debt_used = valuation.equity_bridge.less_total_debt if valuation else latest.total_debt
    leases_used = valuation.equity_bridge.less_lease_liabilities if valuation else latest.lease_liabilities
    debt_audit = audit_debt(latest, debt_used, leases_used)
    units = audit_fcff_units(forecast)
    tv_audit = audit_terminal_value(valuation, wacc) if valuation else None
    investments = classify_investment_lines(latest)
    other_assets = classify_other_assets(latest)
    screener_inv = float(getattr(latest, "screener_investments", 0.0) or 0.0)
    noi = float(latest.non_operating_investments or 0.0)
    noi_status = (latest.non_operating_investments_status or "unavailable").lower()
    ev = valuation.enterprise_value if valuation else 0.0
    investments_status = "classified" if noi_status == "available" else "unavailable"
    if noi_status != "available" and screener_inv > max(0.05 * abs(ev), 1000.0):
        investments_status = "silent_zero_material"
    elif noi_status != "available" and screener_inv <= IDENTITY_TOLERANCE:
        investments_status = "none_material"
    screener_noi_gap = (
        noi_status == "available"
        and screener_inv > max(noi * 2.5, 5000.0)
        and screener_inv - noi > max(0.05 * abs(ev), 1000.0)
    )

    nci = company.minority_interest
    nci_ok = True
    if nci > 0 and ev > 0 and nci > ev:
        nci_ok = False
    shares = company.diluted_shares_outstanding
    health = model_health_gate(
        units_ok=units["ok"],
        fcff_formula_ok=units["ok"],
        wacc=wacc,
        terminal_growth=g,
        tv_audit=tv_audit,
        cash_audit=cash_audit,
        debt_audit=debt_audit,
        identities=identities,
        shares=shares,
        nci_ok=nci_ok,
        investments_status=investments_status,
        fcff_appropriate=fcff_appropriate,
    )
    plausibility = dcf_plausibility_checks(
        forecast=forecast,
        valuation=valuation,
        wacc=wacc,
        terminal_growth=g,
        cash_audit=cash_audit,
        debt_audit=debt_audit,
        identities=identities,
        shares=shares,
        fcff_appropriate=fcff_appropriate,
        units_ok=units["ok"],
    )

    lines = {
        "revenue_y1": y1.revenue if y1 else None,
        "ebit_y1": y1.ebit if y1 else None,
        "nopat_y1": y1.nopat if y1 else None,
        "da_y1": y1.da if y1 else None,
        "capex_y1": y1.capex if y1 else None,
        "dnwc_y1": y1.change_in_nwc if y1 else None,
        "fcff_y1": y1.fcff if y1 else None,
        "fcff_y5": y5.fcff if y5 else None,
        "wacc": wacc,
        "terminal_growth": g,
        "terminal_value": valuation.terminal_value_gordon if valuation else None,
        "enterprise_value": ev if valuation else None,
        "cash": cash_used,
        "investments": noi,
        "debt": debt_used,
        "lease_liabilities": leases_used,
        "nci": nci,
        "other_non_operating_assets": float(overlay.get("assets_held_for_sale") or 0.0),
        "share_count": shares,
    }

    data_issues: list[str] = []
    method_issues: list[str] = []
    accounting_issues: list[str] = []
    secondary: list[str] = []
    if cash_audit.get("critical_data_bridge_error"):
        data_issues.append("Cash is unavailable and must not be treated as zero.")
    if investments_status == "silent_zero_material":
        data_issues.append(
            f"Screener Investments {screener_inv:,.1f} is material and was not classified; DCF investments are not a silent zero add, but the omission is flagged."
        )
    if screener_noi_gap:
        data_issues.append(
            f"Screener Investments {screener_inv:,.1f} is much larger than classified non-operating investments {noi:,.1f}. "
            "The difference is not auto-added."
        )
    if (latest.screener_other_assets_plug or 0) > max(0.1 * abs(ev), 1.0) and (latest.other_assets or 0) > max(0.1 * abs(ev), 1.0):
        data_issues.append("Residual other_assets remains material after overlay and is not auto-added.")
    if not company.minority_interest_reported:
        data_issues.append("NCI is not reported on the compact source.")
    if debt_audit.get("debt_equals_total_liabilities"):
        accounting_issues.append("DCF debt equals total liabilities — operating liabilities must not be treated as debt.")
    if debt_audit.get("lease_double_count"):
        accounting_issues.append("Lease liabilities appear to be included in debt and deducted again.")
    if wacc >= WACC_REVIEW:
        method_issues.append(f"WACC {wacc:.1%} is above the {WACC_REVIEW:.0%} review threshold.")
    if y1 and y5 and y1.fcff <= 0 and y5.fcff <= 0:
        method_issues.append("FCFF is negative throughout the explicit period.")
    if y5 and y5.revenue and y5.capex > 1.4 * max(y5.da, 1.0):
        method_issues.append("Capex remains well above D&A in the last explicit year (growth vs maintenance).")
    if units["issues"]:
        accounting_issues.extend(units["issues"])
    if tv_audit and tv_audit.get("blocked_wacc_le_g"):
        method_issues.append("WACC ≤ g — Gordon TV is blocked, not a negative IV.")
    if tv_audit and tv_audit.get("discounted_twice"):
        accounting_issues.append("Terminal value appears discounted twice.")

    situation = "A"
    primary = "Primary driver: High debt relative to enterprise value."
    proposed_class = "GENUINE_NEGATIVE_EQUITY"
    if valuation is not None:
        situation, primary, proposed_class = _primary_driver(
            valuation=valuation,
            forecast=forecast,
            wacc=wacc,
            cash_audit=cash_audit,
            debt_audit=debt_audit,
            identities=identities or {},
            health=health,
        )
    if not fcff_appropriate:
        situation, primary, proposed_class = "D", "Primary driver: Data quality insufficient.", "METHODOLOGY_BLOCKED"
        method_issues.append(fcff_block_reason or "Standard FCFF DCF is not the right methodology.")

    forecast_uncertain = any("Capex remains" in x or "FCFF is negative" in x for x in method_issues) or wacc >= WACC_HIGH
    result_class = classify_negative_result(
        equity_value=valuation.equity_bridge.equity_value if valuation else 0.0,
        fcff_appropriate=fcff_appropriate,
        health=health,
        situation=situation,
        proposed=proposed_class,
        cash_audit=cash_audit,
        investments_status=investments_status,
        forecast_uncertain=forecast_uncertain,
    )
    if valuation and valuation.equity_bridge.equity_value >= 0 and fcff_appropriate:
        result_class = "POSITIVE"
        primary = "Residual equity is positive."
        situation = "A"

    if cash_audit.get("critical_data_bridge_error"):
        secondary.append("Missing cash.")
    if investments_status == "silent_zero_material":
        secondary.append("Unclassified investments.")
    if wacc >= WACC_REVIEW:
        secondary.append(f"WACC {wacc:.1%}.")
    if y1 and y1.fcff <= 0:
        secondary.append("Y1 FCFF ≤ 0.")

    confidence = "HIGH" if result_class == "POSITIVE" and health["passed"] else "MEDIUM"
    if result_class in {"MODEL_ERROR", "DATA_INCOMPLETE", "METHODOLOGY_BLOCKED"}:
        confidence = "LOW"
    if result_class == "FORECAST_UNCERTAIN":
        confidence = "LOW"
    if result_class == "GENUINE_NEGATIVE_EQUITY" and health["passed"]:
        confidence = "MEDIUM"

    return {
        "lines": lines,
        "primary_cause": primary,
        "situation": situation,
        "situation_meaning": SITUATIONS[situation],
        "secondary_causes": secondary,
        "data_quality_issues": data_issues,
        "methodology_issues": method_issues,
        "accounting_issues": accounting_issues,
        "confidence": confidence,
        "result_class": result_class,
        "distressed": False,
        "label": result_class.replace("_", " "),
        "identities": identities,
        "cash_audit": cash_audit,
        "debt_audit": debt_audit,
        "investments": investments,
        "other_assets": other_assets,
        "investments_status": investments_status,
        "screener_investments": screener_inv,
        "plausibility": plausibility,
        "model_health": health,
        "tv_audit": tv_audit,
        "units": units,
        "share_count": {
            "diluted_current": shares,
            "source": company.shares_source or "",
            "status": company.shares_status,
            "methodology": "Current diluted / shares outstanding for a spot per-share value. Weighted-average shares are not used.",
        },
        "nci": {
            "amount": nci,
            "reported": company.minority_interest_reported,
            "consistent_with_consolidated_fcff": nci_ok and company.minority_interest_reported,
            "note": (
                "NCI is deducted once from consolidated EV. It is not deducted if unreported."
                if company.minority_interest_reported
                else "NCI unavailable on the compact statement."
            ),
        },
        "profile_template": profile_template,
        "why": primary,
        "enterprise_value": lines["enterprise_value"],
        "cash": cash_used,
        "non_operating_investments": noi,
        "debt": debt_used,
        "leases": leases_used,
        "minority_interest": nci,
        "preferred": valuation.equity_bridge.less_preferred_stock if valuation else 0.0,
        "equity_value": valuation.equity_bridge.equity_value if valuation else None,
        "unreliable": not health["passed"],
        "high_valuation_sensitivity": False,
        "causes": [primary] + secondary,
    }
