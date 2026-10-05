"""Orchestrates the reliability layer into one payload section.

Everything here reads finished engine objects. Nothing in this module can change
an assumption, a discount rate, or a cash flow.
"""
from __future__ import annotations

from typing import Any

from .company_profile import CompanyProfile
from .forecast import ForecastAssumptions, ForecastResult
from .growth_evidence import GrowthEvidence
from .historical import HistoricalSummary
from .models import Company, HistoricalFinancials
from .reliability import (
    Methodology,
    assess_data_quality,
    assess_forecast_quality,
    assess_historical_quality,
    assess_platform_trajectory,
    assess_terminal_value_quality,
    assess_wacc_quality,
    build_model_health,
    classify_capital_intensity,
    classify_required_category,
    confidence_band,
    explain_valuation,
    is_regulated_industry,
    select_methodology,
)
from .sensitivity import ValuationContext
from .stability import StabilityReport, run_stability_analysis
from .valuation import DCFValuationResult
from .wacc import WaccResult


def build_reliability(
    *,
    company: Company,
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    profile: CompanyProfile,
    forecast: ForecastResult,
    assumptions: ForecastAssumptions,
    evidence: GrowthEvidence,
    wacc_result: WaccResult,
    valuation: DCFValuationResult | None,
    terminal_growth: float,
    ctx: ValuationContext | None,
    cash_value: float | None,
    rf_source: str,
    erp_source: str,
    kd_source: str,
    beta_source: str,
    beta_method: str,
    source_date: str,
    sotp_required: bool = False,
    complex_group: bool = False,
    bridge_blocked: bool = False,
    bridge_block_reason: str | None = None,
    identity_failure: bool = False,
    negative_class: str | None = None,
    run_stability: bool = True,
) -> dict[str, Any]:
    data = assess_data_quality(hist, company, cash_used=cash_value)
    historical = assess_historical_quality(hist, summary)
    regulated = is_regulated_industry(company.industry or "")
    intensity = classify_capital_intensity(hist, summary, regulated=regulated)
    methodology = select_methodology(
        company,
        profile,
        intensity,
        summary,
        sotp_required=sotp_required,
        complex_group=complex_group,
    )
    forecast_quality = assess_forecast_quality(
        hist,
        summary,
        forecast,
        assumptions,
        evidence,
        profile,
        intensity,
        terminal_growth=terminal_growth,
    )
    wacc_quality = assess_wacc_quality(
        wacc_result,
        country=company.country or "",
        currency=company.currency or "",
        rf_source=rf_source,
        erp_source=erp_source,
        kd_source=kd_source,
        beta_source=beta_source,
        beta_method=beta_method,
        source_date=source_date,
    )
    terminal = assess_terminal_value_quality(
        valuation, forecast, wacc=wacc_result.wacc, terminal_growth=terminal_growth
    )

    stability: StabilityReport | None = None
    if run_stability and valuation is not None and ctx is not None and wacc_result.wacc > terminal_growth:
        stability = run_stability_analysis(
            hist=hist,
            assumptions=assumptions,
            wacc_result=wacc_result,
            terminal_growth=terminal_growth,
            company=company,
            ctx=ctx,
        )
    stability_score = stability.score if stability else 0
    stability_warnings = list(stability.warnings) if stability else [
        "Valuation stability was not measured because no valuation was produced."
    ]

    negative_equity = bool(valuation and valuation.equity_bridge.equity_value < 0)
    health = build_model_health(
        data=data,
        historical=historical,
        forecast_quality=forecast_quality,
        methodology=methodology,
        intensity=intensity,
        wacc_quality=wacc_quality,
        terminal=terminal,
        stability_score=stability_score,
        stability_warnings=stability_warnings,
        bridge_blocked=bridge_blocked,
        bridge_block_reason=bridge_block_reason,
        identity_failure=identity_failure,
        negative_equity=negative_equity,
        negative_class=negative_class,
    )
    if stability and stability.failures:
        health.critical_warnings.extend(f"MODEL_ERROR — {f}" for f in stability.failures)
        health.can_show_precise_value = False
        health.overall_status = "BLOCKED"
        health.valuation_status = "Valuation blocked: a sensitivity property failed."

    payload: dict[str, Any] = {
        "health": health.model_dump(),
        "confidence_band": confidence_band(health.overall_score),
        "required_category": classify_required_category(company, profile),
        "methodology": methodology.model_dump(),
        "data_quality": data.model_dump(),
        "historical_quality": historical.model_dump(),
        "forecast_quality": forecast_quality.model_dump(),
        "capital_intensity": intensity.model_dump(),
        "wacc_quality": wacc_quality.model_dump(),
        "terminal_value_quality": terminal.model_dump(),
        "stability": stability.model_dump() if stability else None,
        "value_explanation": explain_valuation(
            forecast, valuation, wacc=wacc_result.wacc, terminal_growth=terminal_growth
        ),
        "regulated": regulated,
    }
    if methodology.methodology == Methodology.PLATFORM_HIGH_GROWTH:
        payload["platform_trajectory"] = assess_platform_trajectory(forecast, valuation)
    if methodology.methodology == Methodology.REGULATED_UTILITY:
        payload["regulated_review"] = _regulated_review(hist, summary, intensity)
    return payload


def _regulated_review(hist, summary, intensity) -> dict[str, Any]:
    """What a regulated-asset valuation would need, and what the feed actually has."""
    latest = hist.balance_sheets[-1]
    requirements = [
        {
            "item": "Regulated asset base (RAB)",
            "status": "UNAVAILABLE",
            "note": "Gross/net regulated block is disclosed in tariff filings, not in the statement feed.",
        },
        {
            "item": "Allowed return on equity",
            "status": "UNAVAILABLE",
            "note": "Set by the regulator; not derivable from published financials.",
        },
        {
            "item": "Approved capital expenditure plan",
            "status": "UNAVAILABLE",
            "note": "Capex is observed historically but the approved forward plan is not available.",
        },
        {
            "item": "Net block / PP&E",
            "status": "AVAILABLE",
            "value": latest.ppe,
            "note": "Balance-sheet PP&E is a proxy for the asset base but is not the regulated block.",
        },
        {
            "item": "Depreciation",
            "status": "AVAILABLE",
            "value": summary.avg_da_pct_revenue,
            "note": "Historical D&A as a share of revenue.",
        },
        {
            "item": "Financing structure",
            "status": "AVAILABLE",
            "value": latest.total_debt_and_leases,
            "note": "Debt-funded asset growth is visible, but the regulated gearing norm is not.",
        },
    ]
    return {
        "requirements": requirements,
        "capex_policy_note": (
            "Capex is not faded merely to produce a positive valuation. A regulated builder that keeps "
            "investing keeps consuming free cash flow, and the model reports that."
        ),
        "conclusion": (
            "Regulated-asset inputs are unavailable, so the unlevered FCFF result is reported as "
            "FORECAST_UNCERTAIN rather than as a precise intrinsic value."
        ),
        "capital_intensity": intensity.category.value,
    }
