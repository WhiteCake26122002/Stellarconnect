"""Mid-cycle economics for cyclical (commodity / volume) businesses.

Current-year margins are a cycle observation, not the forecast. This module
never uses market price to choose a margin.
"""
from __future__ import annotations

from enum import Enum
from statistics import median as _median

from pydantic import BaseModel, Field

from .historical import HistoricalSummary


class CycleState(str, Enum):
    PEAK = "peak_cycle"
    MID = "mid_cycle"
    DOWN = "down_cycle"
    RECOVERY = "recovery"
    PROVISIONAL_RECOVERY = "provisional_recovery"
    UNKNOWN = "unknown"


class CyclicalNormalization(BaseModel):
    latest_ebitda_margin: float | None
    latest_ebit_margin: float | None
    peak_ebitda_margin: float | None
    trough_ebitda_margin: float | None
    median_ebitda_all: float | None
    median_ebitda_5y: float | None
    median_ebitda_7y: float | None
    median_ebit_all: float | None
    median_ebit_5y: float | None
    median_ebit_7y: float | None
    winsorized_median_ebitda: float | None
    normalized_ebitda_margin: float
    normalized_ebit_margin: float
    cycle_state: CycleState
    structural_decline: bool
    confidence: str  # High | Medium | Low
    uncertain: bool
    rationale: str
    year_ebitda: list[float] = Field(default_factory=list)
    year_ebit: list[float] = Field(default_factory=list)
    p25_ebitda: float | None = None
    p75_ebitda: float | None = None
    forecast_confidence: dict = Field(default_factory=dict)


def _pctile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    idx = q * (len(s) - 1)
    lo = int(idx)
    hi = min(lo + 1, len(s) - 1)
    w = idx - lo
    return s[lo] * (1 - w) + s[hi] * w


def _winsorized(values: list[float]) -> list[float]:
    if len(values) < 5:
        return list(values)
    s = sorted(values)
    if len(s) >= 7:
        return s[1:-1]
    lo, hi = s[0], s[-1]
    span = hi - lo
    if span <= 0:
        return s
    floor, ceil = lo + 0.10 * span, hi - 0.10 * span
    return [min(max(v, floor), ceil) for v in values]


def classify_cycle_state(
    latest: float,
    mid: float,
    peak: float,
    trough: float,
    series: list[float],
) -> CycleState:
    span = peak - trough
    if span < 0.05 or len(series) < 4:
        return CycleState.UNKNOWN
    if latest >= mid + 0.40 * (peak - mid):
        return CycleState.PEAK
    if latest <= mid - 0.40 * (mid - trough):
        return CycleState.DOWN
    if len(series) >= 3 and series[-1] > series[-2] > series[-3] and series[-3] < mid:
        return CycleState.PROVISIONAL_RECOVERY
    return CycleState.MID


def _structural_decline(ebitda: list[float]) -> bool:
    if len(ebitda) < 8:
        return False
    first = ebitda[: len(ebitda) // 2]
    last = ebitda[-5:]
    first_med = _median(first)
    last_med = _median(last)
    if last_med > first_med - 0.03:
        return False
    # last 3 not rebounding vs the prior 3
    if len(ebitda) >= 6 and _median(ebitda[-3:]) > _median(ebitda[-6:-3]) + 0.01:
        return False
    return True


def cyclical_forecast_confidence(result: CyclicalNormalization, *, volume_price_available: bool = False) -> dict:
    """Penalty only when cycle visibility is weak — not because the template is cyclical."""
    cycle_visibility = 0.35 if result.cycle_state in {CycleState.UNKNOWN, CycleState.PROVISIONAL_RECOVERY} or result.uncertain else 0.75
    if result.structural_decline:
        margin_conf = 0.50
    elif result.uncertain:
        margin_conf = 0.40
    else:
        margin_conf = 0.80
    revenue_conf = 0.70 if volume_price_available else 0.35
    capex_conf = 0.55
    nwc_conf = 0.55
    overall = (cycle_visibility + margin_conf + revenue_conf + capex_conf + nwc_conf) / 5
    band = "High" if overall >= 0.70 else "Medium" if overall >= 0.45 else "Low"
    return {
        "cycle_visibility": cycle_visibility,
        "margin_normalization": margin_conf,
        "revenue_normalization": revenue_conf,
        "capex_normalization": capex_conf,
        "nwc_normalization": nwc_conf,
        "overall": overall,
        "band": band,
        "volume_price_split": "available" if volume_price_available else "unavailable",
        "note": (
            "Volume × realised-price split is unavailable from the statement feed; "
            "revenue is not treated as SaaS-like compounding."
            if not volume_price_available
            else "Volume and price evidence used in the revenue path."
        ),
    }


def normalize_from_series(ebitda: list[float], ebit: list[float] | None = None) -> CyclicalNormalization:
    ebit = list(ebit) if ebit is not None else [m - 0.04 for m in ebitda]
    if not ebitda:
        return CyclicalNormalization(
            latest_ebitda_margin=None,
            latest_ebit_margin=None,
            peak_ebitda_margin=None,
            trough_ebitda_margin=None,
            median_ebitda_all=None,
            median_ebitda_5y=None,
            median_ebitda_7y=None,
            median_ebit_all=None,
            median_ebit_5y=None,
            median_ebit_7y=None,
            winsorized_median_ebitda=None,
            normalized_ebitda_margin=0.10,
            normalized_ebit_margin=0.06,
            cycle_state=CycleState.UNKNOWN,
            structural_decline=False,
            confidence="Low",
            uncertain=True,
            rationale="No historical margins available. CYCLICAL NORMALIZATION UNCERTAIN.",
        )

    latest_e = ebitda[-1]
    peak = max(ebitda)
    trough = min(ebitda)
    med_all = _median(ebitda)
    med_5 = _median(ebitda[-5:]) if len(ebitda) >= 5 else med_all
    med_7 = _median(ebitda[-7:]) if len(ebitda) >= 7 else med_all
    robust = _median(_winsorized(ebitda))
    mid_ebitda = _median([robust, med_5, med_7])
    med_ebit_all = _median(ebit)
    med_ebit_5 = _median(ebit[-5:]) if len(ebit) >= 5 else med_ebit_all
    med_ebit_7 = _median(ebit[-7:]) if len(ebit) >= 7 else med_ebit_all
    mid_ebit = _median([med_ebit_all, med_ebit_5, med_ebit_7])

    structural = _structural_decline(ebitda)
    if structural:
        # Do not treat a permanent downshift as a trough that mean-reverts to the old peak era.
        mid_ebitda = med_5
        mid_ebit = med_ebit_5

    state = classify_cycle_state(latest_e, mid_ebitda, peak, trough, ebitda)
    span = peak - trough
    uncertain = span < 0.05 or len(ebitda) < 5
    if uncertain:
        confidence = "Low"
        extra = " CYCLICAL NORMALIZATION UNCERTAIN — cycle amplitude is small or history is short."
    elif structural:
        confidence = "Medium"
        extra = " Last five years sit below the earlier-period median; treated as a possible structural downshift, not a temporary trough."
    elif state == CycleState.PROVISIONAL_RECOVERY:
        confidence = "Low"
        extra = (
            " Cycle state = PROVISIONAL RECOVERY from reported margins only "
            "(no volume, utilisation, capacity, or commodity-price feed). Confidence is Low."
        )
    elif state == CycleState.UNKNOWN:
        confidence = "Low"
        extra = " Commodity prices, utilization, and capacity are unavailable; cycle state UNKNOWN."
    else:
        confidence = "Medium"
        extra = " Cycle state is inferred from reported margins only (no commodity-price feed). Volume × price is unavailable."

    rationale = (
        f"Mid-cycle EBITDA margin {mid_ebitda:.1%} is the median of winsorized history "
        f"({robust:.1%}), 5-year median ({med_5:.1%}), and 7-year median ({med_7:.1%}). "
        f"Latest {latest_e:.1%}; peak {peak:.1%}; trough {trough:.1%}. "
        f"Not the latest year and not the peak.{extra}"
    )
    result = CyclicalNormalization(
        latest_ebitda_margin=latest_e,
        latest_ebit_margin=ebit[-1],
        peak_ebitda_margin=peak,
        trough_ebitda_margin=trough,
        median_ebitda_all=med_all,
        median_ebitda_5y=med_5,
        median_ebitda_7y=med_7,
        median_ebit_all=med_ebit_all,
        median_ebit_5y=med_ebit_5,
        median_ebit_7y=med_ebit_7,
        winsorized_median_ebitda=robust,
        normalized_ebitda_margin=mid_ebitda,
        normalized_ebit_margin=mid_ebit,
        cycle_state=state,
        structural_decline=structural,
        confidence=confidence,
        uncertain=uncertain,
        rationale=rationale,
        year_ebitda=ebitda,
        year_ebit=ebit,
        p25_ebitda=_pctile(ebitda, 0.25),
        p75_ebitda=_pctile(ebitda, 0.75),
    )
    result.forecast_confidence = cyclical_forecast_confidence(result)
    return result


def normalize_cyclical_margins(summary: HistoricalSummary) -> CyclicalNormalization:
    return normalize_from_series(
        [y.ebitda_margin for y in summary.years],
        [y.ebit_margin for y in summary.years],
    )


def diagnose_negative_equity(
    *,
    enterprise_value: float,
    cash: float,
    non_operating: float,
    debt: float,
    leases: float,
    nci: float,
    preferred: float,
    equity_value: float,
    wacc: float,
    terminal_ebit_margin: float,
    normalized_ebit_margin: float | None,
    tv_pct: float,
    pv_explicit: float | None = None,
    pv_terminal: float | None = None,
    last_fcff: float | None = None,
    shares: float | None = None,
    market_cap: float | None = None,
    bridge_complete: bool = True,
) -> dict:
    assets = cash + non_operating
    claims = debt + leases + nci + preferred
    net_debt = debt + leases - cash
    residual = enterprise_value + assets - claims
    drivers: list[tuple[str, float]] = [
        ("gross debt", debt),
        ("lease liabilities", leases),
        ("minority interest", nci),
        ("preferred", preferred),
    ]
    primary_claim = max(drivers, key=lambda x: x[1])[0] if claims else "none"
    identity_ok = abs(residual - equity_value) < 1.0
    trough_terminal = (
        normalized_ebit_margin is not None and terminal_ebit_margin + 0.01 < normalized_ebit_margin
    )
    ev_identity_ok = True
    if pv_explicit is not None and pv_terminal is not None:
        ev_identity_ok = abs(enterprise_value - (pv_explicit + pv_terminal)) < 1.0

    checks = [
        {
            "id": "A",
            "name": "Is EV correct?",
            "ok": ev_identity_ok,
            "detail": (
                f"EV {enterprise_value:,.1f} = PV explicit {pv_explicit:,.1f} + PV TV {pv_terminal:,.1f}."
                if pv_explicit is not None and pv_terminal is not None
                else "PV split not supplied; EV taken from the DCF object."
            ),
        },
        {"id": "B", "name": "Is debt correct?", "ok": debt >= 0, "detail": f"Gross debt {debt:,.1f} (leases shown separately)."},
        {"id": "C", "name": "Is cash correct?", "ok": cash >= 0, "detail": f"Cash and cash-like {cash:,.1f}."},
        {"id": "D", "name": "Is NCI correct?", "ok": nci >= 0, "detail": f"Minority interest {nci:,.1f}."},
        {
            "id": "E",
            "name": "Is WACC reasonable?",
            "ok": 0.05 < wacc < 0.22,
            "detail": f"WACC {wacc:.1%}. Flagged if outside 5–22%.",
        },
        {
            "id": "F",
            "name": "Is normalized EBIT reasonable?",
            "ok": not trough_terminal,
            "detail": (
                f"Terminal EBIT {terminal_ebit_margin:.1%} vs mid-cycle {normalized_ebit_margin:.1%}."
                if normalized_ebit_margin is not None
                else f"Terminal EBIT {terminal_ebit_margin:.1%} (no mid-cycle reference)."
            ),
        },
        {
            "id": "G",
            "name": "Is normalized FCFF reasonable?",
            "ok": last_fcff is None or last_fcff > -abs(enterprise_value) * 0.5,
            "detail": f"Terminal-year FCFF {last_fcff:,.1f}." if last_fcff is not None else "FCFF not supplied.",
        },
        {
            "id": "H",
            "name": "Is terminal value reasonable?",
            "ok": 0.0 < tv_pct < 0.95,
            "detail": f"TV is {tv_pct:.0%} of EV.",
        },
        {
            "id": "I",
            "name": "Is the company economically distressed?",
            "ok": identity_ok and ev_identity_ok and not trough_terminal and bridge_complete,
            "detail": (
                "EV is below net debt after mid-cycle economics and a completed bridge. "
                "This is a residual-equity conclusion, not a legal insolvency filing."
                if enterprise_value < net_debt
                else "EV covers net debt; other claims (NCI/preferred) create the residual."
            ),
        },
    ]
    unreliable = (not bridge_complete) or (not identity_ok) or (not ev_identity_ok)
    causes: list[str] = []
    if enterprise_value < net_debt:
        causes.append(
            f"Enterprise value ({enterprise_value:,.1f}) is below net debt ({net_debt:,.1f}), so operating assets do not cover financial claims."
        )
    if wacc >= 0.15:
        causes.append(f"WACC {wacc:.1%} is high, which compresses both explicit PV and terminal value.")
    if trough_terminal:
        causes.append(
            f"Terminal EBIT margin {terminal_ebit_margin:.1%} is below the mid-cycle EBIT {normalized_ebit_margin:.1%} — trough economics in perpetuity."
        )
    if tv_pct > 0.70:
        causes.append(f"Terminal value is {tv_pct:.0%} of EV, so long-term assumptions dominate.")
    if nci > enterprise_value > 0:
        causes.append(
            f"Minority interest ({nci:,.1f}) exceeds enterprise value ({enterprise_value:,.1f}); confirm NCI is consistent with consolidated FCFF."
        )
    if not causes:
        causes.append(f"The largest claim is {primary_claim}.")
    per_share = (equity_value / shares) if shares else None
    return {
        "enterprise_value": enterprise_value,
        "cash": cash,
        "non_operating_investments": non_operating,
        "debt": debt,
        "leases": leases,
        "minority_interest": nci,
        "preferred": preferred,
        "net_debt": net_debt,
        "equity_value": equity_value,
        "reconciled_residual": residual,
        "identity_ok": identity_ok,
        "primary_claim": primary_claim,
        "primary_cause": causes[0],
        "causes": causes,
        "checks": checks,
        "unreliable": unreliable,
        "distressed": equity_value < 0 and enterprise_value < net_debt and not unreliable,
        "label": (
            "Equity bridge requires review."
            if unreliable
            else "NEGATIVE RESIDUAL EQUITY"
            if equity_value < 0
            else "POSITIVE"
        ),
        "per_share_residual": per_share,
        "shares": shares,
        "market_cap": market_cap,
        "why": (
            f"The negative residual is primarily caused by {primary_claim} "
            f"relative to enterprise value {enterprise_value:,.1f}."
        ),
    }
