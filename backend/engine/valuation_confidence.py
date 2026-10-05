"""Valuation confidence is not the model-quality score.

Model quality asks whether the arithmetic and sources are internally consistent.
Valuation confidence asks whether the intrinsic value is economically supported.
"""
from __future__ import annotations


def assess_valuation_confidence(
    *,
    integrity_status: str,
    residual_unknown: float,
    enterprise_value: float,
    volume_price_available: bool,
    cycle_confidence: str,
    tv_pct: float,
    high_sensitivity: bool,
    primary_statements: bool,
    complex_group: bool,
    cyclical: bool,
) -> dict:
    deductions: list[str] = []
    score = 80
    if not primary_statements:
        score -= 15
        deductions.append("Audited annual-report PDF extraction is not implemented.")
    if enterprise_value and abs(residual_unknown) / abs(enterprise_value) > 0.10:
        score -= 20
        deductions.append("Unclassified residual assets are material versus enterprise value.")
    elif abs(residual_unknown) > 1:
        score -= 8
        deductions.append("A residual other-assets plug remains after mapped Yahoo lines.")
    if cyclical and not volume_price_available:
        score -= 18
        deductions.append("Volume × realised-price drivers are unavailable.")
    if cyclical and cycle_confidence.lower() == "low":
        score -= 10
        deductions.append("Cycle state is provisional (margins only).")
    if tv_pct > 0.70:
        score -= 8
        deductions.append(f"Terminal value is {tv_pct:.0%} of EV.")
    if high_sensitivity:
        score -= 12
        deductions.append("Nearby WACC/margin cells change the sign of residual equity.")
    if complex_group:
        score -= 15
        deductions.append("Complex group structure / possible SOTP.")
    if integrity_status == "BLOCKED":
        score = min(score, 20)
        deductions.append("Equity bridge is blocked.")
    score = max(0, min(100, score))
    if score >= 70:
        band = "MEDIUM"
    elif score >= 50:
        band = "MEDIUM-LOW"
    else:
        band = "LOW"
    status_cap = None
    if integrity_status != "BLOCKED":
        if (enterprise_value and abs(residual_unknown) / abs(enterprise_value) > 0.10) or complex_group:
            status_cap = "REVIEW_REQUIRED"
        elif (not primary_statements) or (cyclical and not volume_price_available) or high_sensitivity:
            status_cap = "ACCEPTABLE_WITH_LIMITATIONS"
    return {
        "score": score,
        "band": band,
        "deductions": deductions,
        "status_cap": status_cap,
        "note": "A high model-quality score does not mean the intrinsic value is highly reliable.",
    }
