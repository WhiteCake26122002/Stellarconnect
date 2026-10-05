"""Economic validation and reliability layer.

This module does not value anything. It reads the existing forecast, WACC, and
valuation objects and answers a separate question: how reliable is that value?

Rules enforced here:
  * "unavailable" is never rewritten as 0.
  * A high or low intrinsic value never changes the confidence score.
  * No ticker is referenced anywhere. Behaviour comes from sector, industry,
    capital intensity, regulation, and financial characteristics.
"""
from __future__ import annotations

import re
from enum import Enum
from statistics import median, pstdev
from typing import Any

from pydantic import BaseModel, Field

from .company_profile import BusinessTemplate, CompanyProfile
from .forecast import ForecastAssumptions, ForecastResult
from .growth_evidence import GrowthEvidence
from .historical import HistoricalSummary
from .models import Company, HistoricalFinancials
from .valuation import DCFValuationResult
from .wacc import WaccResult

AVAILABLE = "AVAILABLE"
PARTIAL = "PARTIAL"
ESTIMATED = "ESTIMATED"
UNAVAILABLE = "UNAVAILABLE"

_COVERAGE_POINTS = {AVAILABLE: 1.0, PARTIAL: 0.6, ESTIMATED: 0.45, UNAVAILABLE: 0.0}

CONFIDENCE_WEIGHTS = {
    "data_quality": 0.15,
    "historical_quality": 0.10,
    "forecast_quality": 0.20,
    "business_model_fit": 0.15,
    "capital_intensity": 0.10,
    "wacc_quality": 0.10,
    "terminal_value": 0.10,
    "valuation_stability": 0.10,
}

_REGULATED = re.compile(
    r"\b(power generation|power -|power transmission|transmission|distribution|"
    r"electric utilit|utilities|regulated)\b",
    re.I,
)
# "Utility Vehicles" is an automotive product line, not an electricity utility.
_AUTOMOTIVE = re.compile(
    r"\b(auto|automobile|automotive|passenger cars?|utility vehicles?|two.?wheel|"
    r"four.?wheel|motorcycle|scooter|tractor|commercial vehicles?|auto components?)\b",
    re.I,
)

# The 15 product-level categories required of the reliability layer. These sit on
# top of the engine's forecast templates and never feed back into the forecast.
REQUIRED_CATEGORIES = [
    "PLATFORM",
    "IT_SERVICES",
    "CONSUMER",
    "TELECOM",
    "INFRASTRUCTURE",
    "ENERGY",
    "UTILITY",
    "PHARMA",
    "MANUFACTURING",
    "CYCLICAL",
    "AUTOMOTIVE",
    "FINANCIAL",
    "CONGLOMERATE",
    "REAL_ESTATE",
    "OTHER",
]

_TEMPLATE_TO_CATEGORY = {
    BusinessTemplate.PLATFORM: "PLATFORM",
    BusinessTemplate.IT_SERVICES: "IT_SERVICES",
    BusinessTemplate.TECHNOLOGY: "IT_SERVICES",
    BusinessTemplate.CONSUMER: "CONSUMER",
    BusinessTemplate.TELECOM: "TELECOM",
    BusinessTemplate.INFRASTRUCTURE: "INFRASTRUCTURE",
    BusinessTemplate.ENERGY: "ENERGY",
    BusinessTemplate.PHARMA: "PHARMA",
    BusinessTemplate.MANUFACTURING: "MANUFACTURING",
    BusinessTemplate.INDUSTRIAL: "MANUFACTURING",
    BusinessTemplate.ASSET_HEAVY: "MANUFACTURING",
    BusinessTemplate.CYCLICAL: "CYCLICAL",
    BusinessTemplate.COMMODITY: "CYCLICAL",
    BusinessTemplate.FINANCIAL: "FINANCIAL",
    BusinessTemplate.CONGLOMERATE: "CONGLOMERATE",
    BusinessTemplate.REAL_ESTATE: "REAL_ESTATE",
    BusinessTemplate.ASSET_LIGHT: "OTHER",
    BusinessTemplate.OTHER: "OTHER",
}


def is_regulated_industry(industry: str) -> bool:
    """True only for regulated network/generation utilities, not for 'utility vehicles'."""
    text = industry or ""
    if _AUTOMOTIVE.search(text):
        return False
    return bool(_REGULATED.search(text))


def is_automotive_industry(industry: str) -> bool:
    return bool(_AUTOMOTIVE.search(industry or ""))


def classify_required_category(company: Company, profile: CompanyProfile) -> str:
    """Map the engine template plus industry text onto the required category list."""
    industry = company.industry or ""
    if profile.template == BusinessTemplate.FINANCIAL:
        return "FINANCIAL"
    if is_regulated_industry(industry):
        return "UTILITY"
    if is_automotive_industry(industry):
        return "AUTOMOTIVE"
    return _TEMPLATE_TO_CATEGORY.get(profile.template, "OTHER")


class Methodology(str, Enum):
    STANDARD_FCFF = "STANDARD_FCFF"
    CYCLICAL_FCFF = "CYCLICAL_FCFF"
    EXPANSION_CAPEX_FCFF = "EXPANSION_CAPEX_FCFF"
    PLATFORM_HIGH_GROWTH = "PLATFORM_HIGH_GROWTH"
    REGULATED_UTILITY = "REGULATED_UTILITY"
    SOTP = "SOTP"
    NAV_REVIEW = "NAV_REVIEW"
    EXCESS_RETURN = "EXCESS_RETURN"
    FCFE = "FCFE"
    FINANCIAL_BLOCKED = "FINANCIAL_BLOCKED"
    OTHER = "OTHER"


class CapitalIntensity(str, Enum):
    ASSET_LIGHT = "ASSET_LIGHT"
    MODERATE = "MODERATE"
    ASSET_HEAVY = "ASSET_HEAVY"
    EXPANSION_HEAVY = "EXPANSION_HEAVY"
    REGULATED_ASSET_HEAVY = "REGULATED_ASSET_HEAVY"


class FieldCoverage(BaseModel):
    field: str
    status: str
    source: str = ""
    as_of: str = ""
    value: float | None = None
    note: str = ""
    material: bool = True


class DataQualityReport(BaseModel):
    score: int
    fields: list[FieldCoverage] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    critical_warnings: list[str] = Field(default_factory=list)
    unavailable_fields: list[str] = Field(default_factory=list)


class HistoricalQualityReport(BaseModel):
    score: int
    years_available: int
    span: str
    has_3y: bool
    has_5y: bool
    has_10y: bool
    revenue_cagr_3y: float | None = None
    revenue_cagr_5y: float | None = None
    ebit_cagr_3y: float | None = None
    ebit_margin_series: list[float] = Field(default_factory=list)
    fcff_series: list[float] = Field(default_factory=list)
    capex_pct_series: list[float] = Field(default_factory=list)
    da_pct_series: list[float] = Field(default_factory=list)
    dnwc_pct_series: list[float] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    note: str = (
        "Historical values are evidence for the forecast. They are not automatically "
        "used as forecast assumptions."
    )


class CapitalIntensityProfile(BaseModel):
    category: CapitalIntensity
    score: int
    capex_pct_revenue: float | None = None
    capex_to_da: float | None = None
    ppe_growth: float | None = None
    revenue_growth: float | None = None
    asset_growth: float | None = None
    maintenance_capex_pct: float | None = None
    growth_capex_pct: float | None = None
    split_available: bool = False
    split_method: str = ""
    evidence: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class MethodologySelection(BaseModel):
    methodology: Methodology
    classification: str
    fcff_appropriate: bool
    requires_review: bool = False
    block_reason: str | None = None
    review_reason: str | None = None
    rationale: str = ""
    evidence: list[str] = Field(default_factory=list)
    fit_score: int = 100


class RegimeConfidence(BaseModel):
    regime: str
    confidence: int
    supporting_factors: list[str] = Field(default_factory=list)
    contradictory_factors: list[str] = Field(default_factory=list)


class DriverQuality(BaseModel):
    driver: str
    value: float | None
    unit: str
    method: str
    evidence_strength: int
    historical_consistency: int
    economic_justification: str
    confidence: str
    rationale: str


class ForecastQualityReport(BaseModel):
    score: int
    regime: RegimeConfidence
    drivers: list[DriverQuality] = Field(default_factory=list)
    historical_cagr: float | None = None
    forecast_cagr: float | None = None
    growth_gap_pp: float | None = None
    growth_gap_statement: str = ""
    growth_gap_supported: str = "unassessed"
    margin_stability_score: int = 0
    margin_stats: dict[str, float | None] = Field(default_factory=dict)
    margin_pattern: str = ""
    margin_method: str = ""
    revenue_path: list[dict[str, Any]] = Field(default_factory=list)
    guidance_available: bool = False
    warnings: list[str] = Field(default_factory=list)


class WaccQualityReport(BaseModel):
    score: int
    inputs: list[dict[str, Any]] = Field(default_factory=list)
    wacc: float
    warnings: list[str] = Field(default_factory=list)
    stale_inputs: list[str] = Field(default_factory=list)
    double_relever_detected: bool = False


class TerminalValueQualityReport(BaseModel):
    score: int
    tv_pct_of_ev: float | None = None
    terminal_growth: float | None = None
    wacc: float | None = None
    spread: float | None = None
    severity: str = "ok"
    terminal_fcff_positive: bool | None = None
    tv_sensitivity_wacc: list[dict[str, float | None]] = Field(default_factory=list)
    tv_sensitivity_growth: list[dict[str, float | None]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ModelHealth(BaseModel):
    overall_status: str
    overall_score: int
    data_quality_score: int
    historical_quality_score: int
    forecast_quality_score: int
    business_model_fit_score: int
    capital_intensity_score: int
    wacc_quality_score: int
    terminal_value_score: int
    valuation_stability_score: int
    weights: dict[str, float] = Field(default_factory=lambda: dict(CONFIDENCE_WEIGHTS))
    components: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    critical_warnings: list[str] = Field(default_factory=list)
    primary_risk: str = ""
    secondary_risks: list[str] = Field(default_factory=list)
    valuation_status: str = ""
    can_show_precise_value: bool = True
    methodology: Methodology = Methodology.STANDARD_FCFF
    note: str = (
        "Confidence measures model quality, not investment attractiveness. "
        "A high valuation does not imply high confidence."
    )


def _clamp(value: float) -> int:
    return int(round(max(0.0, min(100.0, value))))


def _coverage(field: str, status: str, **kwargs: Any) -> FieldCoverage:
    return FieldCoverage(field=field, status=status, **kwargs)


def assess_data_quality(
    hist: HistoricalFinancials,
    company: Company,
    *,
    cash_used: float | None = None,
) -> DataQualityReport:
    """Per-field coverage. UNAVAILABLE stays UNAVAILABLE; it never becomes 0."""
    bs = hist.balance_sheets[-1]
    overlay = dict(bs.source_overlay or {})
    period = bs.period
    yahoo = f"Yahoo Finance latest annual balance sheet ({overlay.get('period') or period})"
    fields: list[FieldCoverage] = []

    revenue_years = [i.revenue for i in hist.income_statements if i.revenue]
    fields.append(
        _coverage(
            "Historical revenue",
            AVAILABLE if len(revenue_years) >= 3 else PARTIAL if revenue_years else UNAVAILABLE,
            source="Screener.in consolidated statements",
            as_of=hist.income_statements[-1].period,
            note=f"{len(revenue_years)} annual periods.",
        )
    )
    ebit_ok = all(abs(i.ebitda) > 0 for i in hist.income_statements)
    fields.append(
        _coverage(
            "Historical EBIT / EBITDA",
            AVAILABLE if ebit_ok else PARTIAL,
            source="Operating profit less depreciation",
            as_of=hist.income_statements[-1].period,
        )
    )
    da_ok = all(i.da > 0 for i in hist.income_statements)
    fields.append(
        _coverage(
            "Historical D&A",
            AVAILABLE if da_ok else PARTIAL,
            source="Income statement depreciation",
            as_of=hist.income_statements[-1].period,
        )
    )
    capex_years = [cf.capex for cf in hist.cash_flows if cf.capex]
    fields.append(
        _coverage(
            "Historical capex",
            AVAILABLE if len(capex_years) >= 3 else PARTIAL if capex_years else UNAVAILABLE,
            source="CFO minus published free cash flow",
            as_of=hist.cash_flows[-1].period,
            note="Inferred from the cash-flow statement, not a capex disclosure line.",
        )
    )
    nwc_status = AVAILABLE if bs.operating_wc_complete else ESTIMATED
    fields.append(
        _coverage(
            "Working capital (ΔNWC)",
            nwc_status,
            source=(
                "Balance-sheet operating working capital"
                if bs.operating_wc_complete
                else "Cash-flow-derived ΔNWC / Δrevenue history"
            ),
            as_of=period,
            note="" if bs.operating_wc_complete else "Substitute ratio, flagged rather than set to zero.",
        )
    )
    cash_status = (bs.cash_status or "unavailable").lower()
    cash_cov = (
        AVAILABLE
        if cash_status == "available" and bs.cash_reported
        else ESTIMATED
        if cash_status in {"derived", "estimated"}
        else UNAVAILABLE
    )
    fields.append(
        _coverage(
            "Cash and cash equivalents",
            cash_cov,
            source=bs.cash_source or ("unavailable" if cash_cov == UNAVAILABLE else yahoo),
            as_of=period,
            value=None if cash_cov == UNAVAILABLE else bs.cash + bs.marketable_securities,
            note=(
                "Cash is unavailable and is not treated as zero in the bridge."
                if cash_cov == UNAVAILABLE
                else f"Cash used in the bridge: {cash_used:,.1f}" if cash_used is not None else ""
            ),
        )
    )
    debt_status = (bs.debt_status or "unavailable").lower()
    fields.append(
        _coverage(
            "Debt (borrowings)",
            AVAILABLE if debt_status == "available" else PARTIAL if debt_status else UNAVAILABLE,
            source=bs.debt_source or "Screener borrowings",
            as_of=period,
            value=bs.total_debt,
        )
    )
    lease_known = overlay.get("current_leases") is not None or overlay.get("long_term_leases") is not None
    fields.append(
        _coverage(
            "Lease liabilities",
            AVAILABLE if lease_known else PARTIAL if bs.lease_liabilities else UNAVAILABLE,
            source=yahoo if lease_known else "not separated by the source",
            as_of=period,
            value=bs.lease_liabilities,
            note="Leases are excluded from borrowings and deducted once in the bridge.",
        )
    )
    fields.append(
        _coverage(
            "Non-controlling interest",
            AVAILABLE if company.minority_interest_reported else UNAVAILABLE,
            source=yahoo if company.minority_interest_reported else "unavailable",
            as_of=period,
            value=company.minority_interest if company.minority_interest_reported else None,
            note="" if company.minority_interest_reported else "NCI is unknown, not assumed to be zero.",
        )
    )
    shares_status = (company.shares_status or "unavailable").lower()
    fields.append(
        _coverage(
            "Diluted share count",
            AVAILABLE if shares_status == "available" else ESTIMATED if shares_status == "estimated" else UNAVAILABLE,
            source=company.shares_source or "unavailable",
            as_of=period,
            value=company.diluted_shares_outstanding,
            note="Current shares outstanding, not weighted-average shares.",
        )
    )
    noi_status = (bs.non_operating_investments_status or "unavailable").lower()
    screener_inv = float(getattr(bs, "screener_investments", 0.0) or 0.0)
    fields.append(
        _coverage(
            "Investments (non-operating)",
            AVAILABLE if noi_status == "available" else PARTIAL if screener_inv else UNAVAILABLE,
            source=bs.non_operating_investments_source or "Screener Investments (unclassified)",
            as_of=period,
            value=bs.non_operating_investments if noi_status == "available" else None,
            note=(
                f"Screener reports an undifferentiated Investments line of {screener_inv:,.1f}; "
                "it is not treated as cash and is not auto-added."
                if screener_inv
                else ""
            ),
        )
    )
    residual = float(bs.other_assets or 0.0)
    fields.append(
        _coverage(
            "Other non-operating assets",
            PARTIAL if abs(residual) > 1 else AVAILABLE,
            source="Total assets minus mapped lines",
            as_of=period,
            value=residual,
            note="Residual is flagged for classification and never auto-added to equity.",
            material=abs(residual) > 1,
        )
    )

    points = sum(_COVERAGE_POINTS.get(f.status, 0.0) for f in fields)
    score = _clamp(100.0 * points / max(len(fields), 1))
    warnings: list[str] = []
    critical: list[str] = []
    for f in fields:
        if f.status == UNAVAILABLE:
            msg = f"{f.field}: unavailable ({f.source or 'no source'})."
            if f.field.startswith("Cash") or f.field.startswith("Debt") or f.field.startswith("Diluted"):
                critical.append(msg)
            else:
                warnings.append(msg)
        elif f.status in {PARTIAL, ESTIMATED}:
            warnings.append(f"{f.field}: {f.status.lower()} — {f.source}.")
    return DataQualityReport(
        score=score,
        fields=fields,
        warnings=warnings,
        critical_warnings=critical,
        unavailable_fields=[f.field for f in fields if f.status == UNAVAILABLE],
    )


def assess_historical_quality(hist: HistoricalFinancials, summary: HistoricalSummary) -> HistoricalQualityReport:
    years = summary.years
    n = len(years)
    ebit_cagr_3y = None
    if n >= 4:
        start, end = years[-4].revenue * years[-4].ebit_margin, years[-1].revenue * years[-1].ebit_margin
        if start > 0 and end > 0:
            ebit_cagr_3y = (end / start) ** (1 / 3) - 1
    dnwc_pct = []
    for i in range(1, min(len(hist.cash_flows), len(hist.income_statements))):
        rev = hist.income_statements[i].revenue
        if rev:
            dnwc_pct.append(hist.cash_flows[i].change_in_nwc / rev)

    score = 40.0
    warnings: list[str] = []
    if n >= 3:
        score += 20
    if n >= 5:
        score += 20
    if n >= 10:
        score += 20
    else:
        warnings.append(f"{n} annual periods available; a full 10-year cycle view is not possible.")
    if summary.growth_volatility is not None and summary.growth_volatility > 0.25:
        score -= 10
        warnings.append(f"Revenue growth volatility is {summary.growth_volatility:.0%}; single-year evidence is weak.")
    if not summary.operating_wc_complete:
        score -= 8
        warnings.append("Balance-sheet working capital is incomplete across history.")

    return HistoricalQualityReport(
        score=_clamp(score),
        years_available=n,
        span=f"{years[0].period}–{years[-1].period}" if years else "none",
        has_3y=n >= 3,
        has_5y=n >= 5,
        has_10y=n >= 10,
        revenue_cagr_3y=summary.revenue_cagr_3y,
        revenue_cagr_5y=summary.revenue_cagr_5y,
        ebit_cagr_3y=ebit_cagr_3y,
        ebit_margin_series=[y.ebit_margin for y in years],
        fcff_series=[y.unlevered_fcf for y in years],
        capex_pct_series=[y.capex_pct_revenue for y in years],
        da_pct_series=[y.da_pct_revenue for y in years],
        dnwc_pct_series=dnwc_pct,
        warnings=warnings,
    )


def classify_capital_intensity(
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    *,
    regulated: bool = False,
) -> CapitalIntensityProfile:
    capex_pct = summary.avg_capex_pct_revenue
    da_pct = summary.avg_da_pct_revenue
    capex_to_da = (capex_pct / da_pct) if da_pct > 1e-9 else None
    ppe_growth = None
    asset_growth = None
    if len(hist.balance_sheets) >= 4:
        old, new = hist.balance_sheets[-4], hist.balance_sheets[-1]
        if old.ppe > 0 and new.ppe > 0:
            ppe_growth = (new.ppe / old.ppe) ** (1 / 3) - 1
        old_ta = old.reported_total_assets or old.total_assets
        new_ta = new.reported_total_assets or new.total_assets
        if old_ta and new_ta and old_ta > 0 and new_ta > 0:
            asset_growth = (new_ta / old_ta) ** (1 / 3) - 1
    rev_growth = summary.revenue_cagr_3y

    evidence = [
        f"Capex is {capex_pct:.1%} of revenue on average; D&A is {da_pct:.1%}.",
        f"Capex / D&A is {capex_to_da:.2f}×." if capex_to_da is not None else "Capex / D&A unavailable.",
    ]
    if ppe_growth is not None:
        evidence.append(f"Net PP&E compounded at {ppe_growth:.1%} over three years.")
    if rev_growth is not None:
        evidence.append(f"Revenue compounded at {rev_growth:.1%} over three years.")

    expansion = bool(
        capex_to_da is not None
        and capex_to_da >= 1.3
        and ((rev_growth or 0) > 0.08 or (ppe_growth or 0) > 0.10)
    )
    if regulated and capex_pct >= 0.08:
        category = CapitalIntensity.REGULATED_ASSET_HEAVY
    elif expansion:
        category = CapitalIntensity.EXPANSION_HEAVY
    elif capex_pct >= 0.08 or (capex_to_da is not None and capex_to_da >= 1.5):
        category = CapitalIntensity.ASSET_HEAVY
    elif capex_pct <= 0.04:
        category = CapitalIntensity.ASSET_LIGHT
    else:
        category = CapitalIntensity.MODERATE

    maintenance = min(capex_pct, da_pct)
    growth_capex = max(capex_pct - da_pct, 0.0)
    split_available = da_pct > 1e-9
    warnings: list[str] = []
    if not split_available:
        warnings.append("D&A is unavailable, so maintenance capex cannot be separated from growth capex.")
    if growth_capex > 0 and not expansion:
        warnings.append(
            "Capex exceeds D&A but growth evidence is weak; the excess is not automatically treated as expansion capex."
        )

    score = 85.0
    if category == CapitalIntensity.EXPANSION_HEAVY:
        score -= 20
    if category == CapitalIntensity.REGULATED_ASSET_HEAVY:
        score -= 25
        warnings.append(
            "Regulated asset base economics (allowed return on RAB) are not modeled by an unlevered FCFF DCF."
        )
    if not split_available:
        score -= 15
    if capex_to_da is not None and capex_to_da > 2.5:
        score -= 10
        warnings.append(f"Capex is {capex_to_da:.1f}× D&A; the maintenance/expansion split materially drives FCFF.")

    return CapitalIntensityProfile(
        category=category,
        score=_clamp(score),
        capex_pct_revenue=capex_pct,
        capex_to_da=capex_to_da,
        ppe_growth=ppe_growth,
        revenue_growth=rev_growth,
        asset_growth=asset_growth,
        maintenance_capex_pct=maintenance if split_available else None,
        growth_capex_pct=growth_capex if split_available else None,
        split_available=split_available,
        split_method=(
            "Maintenance capex ≈ D&A; the excess over D&A is the growth-capex candidate. "
            "Project-level capex disclosure is unavailable in the statement feed."
        ),
        evidence=evidence,
        warnings=warnings,
    )


def select_methodology(
    company: Company,
    profile: CompanyProfile,
    intensity: CapitalIntensityProfile,
    summary: HistoricalSummary,
    *,
    sotp_required: bool = False,
    complex_group: bool = False,
) -> MethodologySelection:
    industry = company.industry or ""
    template = profile.template
    category = classify_required_category(company, profile)
    evidence = [
        f"Industry label: {industry or 'unspecified'}.",
        f"Business template: {template.value}.",
        f"Required category: {category}.",
        f"Capital intensity: {intensity.category.value}.",
    ]

    if not profile.fcff_appropriate and template == BusinessTemplate.FINANCIAL:
        return MethodologySelection(
            methodology=Methodology.FINANCIAL_BLOCKED,
            classification="FINANCIAL",
            fcff_appropriate=False,
            block_reason=profile.fcff_block_reason
            or "Financial institutions require an excess-return, residual-income, or FCFE framework.",
            rationale="Balance-sheet-driven lender: interest income is operating revenue, so unlevered FCFF is undefined.",
            evidence=evidence,
            fit_score=0,
        )
    if not profile.fcff_appropriate and template == BusinessTemplate.REAL_ESTATE:
        return MethodologySelection(
            methodology=Methodology.NAV_REVIEW,
            classification="REAL_ESTATE",
            fcff_appropriate=False,
            block_reason=profile.fcff_block_reason or "Project-level NAV analysis is required.",
            rationale="Land-bank and project economics are not captured by a consolidated FCFF DCF.",
            evidence=evidence,
            fit_score=10,
        )

    if sotp_required:
        return MethodologySelection(
            methodology=Methodology.SOTP,
            classification=category,
            fcff_appropriate=True,
            requires_review=True,
            review_reason="Minority interest or non-operating assets are large relative to enterprise value.",
            rationale="Consolidated FCFF plus a single equity bridge cannot separate the segments or the minority stake.",
            evidence=evidence,
            fit_score=35,
        )

    regulated = is_regulated_industry(industry)
    if regulated and intensity.category in {
        CapitalIntensity.REGULATED_ASSET_HEAVY,
        CapitalIntensity.ASSET_HEAVY,
        CapitalIntensity.EXPANSION_HEAVY,
    }:
        return MethodologySelection(
            methodology=Methodology.REGULATED_UTILITY,
            classification="UTILITY",
            fcff_appropriate=True,
            requires_review=True,
            review_reason=(
                "Regulated asset base, allowed return, and tariff-true-up data are unavailable, so an unlevered "
                "FCFF DCF cannot represent the regulated economics."
            ),
            rationale=(
                "Returns are set on a regulated asset base rather than on competitive margins. Capex is not faded "
                "to manufacture a positive valuation."
            ),
            evidence=evidence + ["Industry label indicates a regulated power/transmission business."],
            fit_score=30,
        )

    if template == BusinessTemplate.PLATFORM:
        return MethodologySelection(
            methodology=Methodology.PLATFORM_HIGH_GROWTH,
            classification="PLATFORM",
            fcff_appropriate=True,
            requires_review=True,
            review_reason="High growth with unproven terminal profitability.",
            rationale=(
                "Terminal value dominates when current FCFF is negative. Mature margins are not assumed; the "
                "trajectory to positive EBIT and FCFF is measured explicitly."
            ),
            evidence=evidence,
            fit_score=45,
        )

    if template == BusinessTemplate.CYCLICAL:
        return MethodologySelection(
            methodology=Methodology.CYCLICAL_FCFF,
            classification=category,
            fcff_appropriate=True,
            rationale="Mid-cycle normalized margins are used instead of the latest or peak year.",
            evidence=evidence,
            fit_score=70,
        )

    if template in {BusinessTemplate.INFRASTRUCTURE, BusinessTemplate.TELECOM} or (
        intensity.category == CapitalIntensity.EXPANSION_HEAVY
    ):
        return MethodologySelection(
            methodology=Methodology.EXPANSION_CAPEX_FCFF,
            classification=category,
            fcff_appropriate=True,
            rationale=(
                "Maintenance and growth capex are separated so a build-out phase does not imply permanently "
                "negative free cash flow."
            ),
            evidence=evidence,
            fit_score=65,
        )

    if template == BusinessTemplate.CONGLOMERATE or complex_group:
        return MethodologySelection(
            methodology=Methodology.SOTP,
            classification="CONGLOMERATE",
            fcff_appropriate=True,
            requires_review=True,
            review_reason="Segment economics differ materially inside one consolidated forecast.",
            rationale="A single growth and margin path cannot represent unlike segments.",
            evidence=evidence,
            fit_score=40,
        )

    return MethodologySelection(
        methodology=Methodology.STANDARD_FCFF,
        classification=category,
        fcff_appropriate=True,
        rationale="Competitive, non-regulated operating company with a usable unlevered cash-flow profile.",
        evidence=evidence,
        fit_score=85,
    )


def assess_regime_confidence(summary: HistoricalSummary, evidence: GrowthEvidence) -> RegimeConfidence:
    regime = evidence.regime.value
    yoy = [y.revenue_growth for y in summary.years if y.revenue_growth is not None]
    supporting: list[str] = []
    contradictory: list[str] = []
    if not yoy:
        return RegimeConfidence(regime=regime.upper(), confidence=0, contradictory_factors=["No year-on-year history."])
    med = median(yoy)
    vol = pstdev(yoy) if len(yoy) >= 2 else 0.0
    last = yoy[-1]
    signals = 0
    total = 4

    def check(condition: bool, yes: str, no: str) -> None:
        nonlocal signals
        if condition:
            signals += 1
            supporting.append(yes)
        else:
            contradictory.append(no)

    if regime == "mature":
        check(abs(med) <= 0.08, f"Median growth {med:.1%} is within a mature band.", f"Median growth {med:.1%} is outside a mature band.")
        check(vol <= 0.08, f"Growth volatility {vol:.1%} is low.", f"Growth volatility {vol:.1%} is high for a mature label.")
        check(abs(last) <= 0.15, f"Latest year {last:.1%} is not an outlier.", f"Latest year {last:.1%} is far from the median.")
        check(len(yoy) >= 4, f"{len(yoy)} growth observations.", f"Only {len(yoy)} growth observations.")
    elif regime == "cyclical":
        check(vol > 0.12, f"Growth volatility {vol:.1%} exceeds the cyclical threshold.", f"Growth volatility {vol:.1%} is low for a cyclical label.")
        check(max(yoy) - min(yoy) > 0.25, f"Peak-to-trough growth spread is {max(yoy) - min(yoy):.1%}.", "Growth spread is narrow.")
        check(any(v < 0 for v in yoy), "At least one contraction year is present.", "No contraction year in the history.")
        check(len(yoy) >= 4, f"{len(yoy)} growth observations.", f"Only {len(yoy)} growth observations.")
    elif regime == "high_growth":
        check(med >= 0.15, f"Median growth {med:.1%} is high.", f"Median growth {med:.1%} is not high-growth.")
        check(min(yoy) >= 0.04, "No contraction year.", f"Minimum growth {min(yoy):.1%} breaks the high-growth pattern.")
        check(last >= 0.10, f"Latest year {last:.1%} is still strong.", f"Latest year {last:.1%} has decelerated.")
        check(len(yoy) >= 3, f"{len(yoy)} growth observations.", f"Only {len(yoy)} growth observations.")
    elif regime == "declining":
        check(med < 0.02, f"Median growth {med:.1%} is weak.", f"Median growth {med:.1%} is not declining.")
        check(last < 0.02, f"Latest year {last:.1%} is weak.", f"Latest year {last:.1%} contradicts decline.")
        check(sum(1 for v in yoy[-3:] if v < 0) >= 2, "Two of the last three years contracted.", "Recent years are not consistently negative.")
        check(len(yoy) >= 3, f"{len(yoy)} growth observations.", f"Only {len(yoy)} growth observations.")
    elif regime == "recovery":
        check(last > med, f"Latest year {last:.1%} is above the median {med:.1%}.", "Latest year is not above the median.")
        check(min(yoy) < 0, "History contains a contraction to recover from.", "No prior contraction supports a recovery label.")
        check(vol > 0.08, f"Growth volatility {vol:.1%} is consistent with a swing.", "Volatility is low for a recovery label.")
        check(len(yoy) >= 3, f"{len(yoy)} growth observations.", f"Only {len(yoy)} growth observations.")
    else:
        check(abs(med) <= 0.20, f"Median growth {med:.1%} is moderate.", f"Median growth {med:.1%} is not moderate.")
        check(vol <= 0.20, f"Growth volatility {vol:.1%} is contained.", f"Growth volatility {vol:.1%} is high.")
        check(len(yoy) >= 3, f"{len(yoy)} growth observations.", f"Only {len(yoy)} growth observations.")
        total = 3

    confidence = _clamp(100.0 * signals / total)
    return RegimeConfidence(
        regime=regime.upper(),
        confidence=confidence,
        supporting_factors=supporting,
        contradictory_factors=contradictory,
    )


def _margin_stats(summary: HistoricalSummary) -> dict[str, float | None]:
    series = [y.ebitda_margin for y in summary.years]
    if not series:
        return {}
    last3 = series[-3:]
    last5 = series[-5:]
    return {
        "latest": series[-1],
        "median_3y": float(median(last3)),
        "median_5y": float(median(last5)),
        "max": max(series),
        "min": min(series),
        "stdev": float(pstdev(series)) if len(series) >= 2 else 0.0,
    }


def assess_forecast_quality(
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    forecast: ForecastResult,
    assumptions: ForecastAssumptions,
    evidence: GrowthEvidence,
    profile: CompanyProfile,
    intensity: CapitalIntensityProfile,
    *,
    terminal_growth: float,
) -> ForecastQualityReport:
    regime = assess_regime_confidence(summary, evidence)
    years = forecast.years
    base_revenue = hist.income_statements[-1].revenue
    n = len(years)
    forecast_cagr = None
    if n and base_revenue > 0 and years[-1].revenue > 0:
        forecast_cagr = (years[-1].revenue / base_revenue) ** (1 / n) - 1
    historical_cagr = summary.revenue_cagr_5y or summary.revenue_cagr_3y
    gap = None
    statement = "Historical CAGR is unavailable, so no comparison is possible."
    supported = "unassessed"
    if forecast_cagr is not None and historical_cagr is not None:
        gap = (forecast_cagr - historical_cagr) * 100
        statement = (
            f"Forecast CAGR is {abs(gap):.1f} percentage points "
            f"{'below' if gap < 0 else 'above'} historical CAGR "
            f"({forecast_cagr:.1%} vs {historical_cagr:.1%})."
        )
        if abs(gap) <= 3:
            supported = "consistent"
        elif gap < 0:
            supported = (
                "supported_by_evidence"
                if regime.regime in {"CYCLICAL", "DECLINING", "MATURE"} or evidence.guidance_available
                else "evidence_limited"
            )
        else:
            supported = "evidence_limited" if not evidence.guidance_available else "supported_by_evidence"

    margin_stats = _margin_stats(summary)
    stdev = margin_stats.get("stdev") or 0.0
    spread = (margin_stats.get("max") or 0.0) - (margin_stats.get("min") or 0.0)
    if stdev <= 0.02:
        pattern, margin_score = "stable", 88
    elif spread > 0.15:
        pattern, margin_score = "cyclical", 45
    elif (margin_stats.get("latest") or 0) > (margin_stats.get("median_5y") or 0) + 0.04:
        pattern, margin_score = "rapid_expansion", 55
    elif (margin_stats.get("latest") or 0) < (margin_stats.get("median_5y") or 0) - 0.04:
        pattern, margin_score = "rapid_contraction", 50
    else:
        pattern, margin_score = "moderately_variable", 70
    if (margin_stats.get("latest") or 0) < 0:
        margin_score = min(margin_score, 35)

    margin_method = (
        "Mid-cycle normalized EBITDA margin (not the latest year and not the peak)."
        if profile.template == BusinessTemplate.CYCLICAL
        else "Last-3-year median EBITDA margin, with opex glided to that target."
    )
    if years and years[-1].ebit_margin < 0:
        margin_method += " Terminal EBIT is still negative; profitability is not assumed."

    drivers: list[DriverQuality] = []
    g1 = years[0].revenue_growth if years else None
    drivers.append(
        DriverQuality(
            driver="Revenue growth Y1",
            value=g1,
            unit="%",
            method=evidence.year1_method,
            evidence_strength=regime.confidence,
            historical_consistency=_clamp(100 - abs((g1 or 0) - (historical_cagr or g1 or 0)) * 300),
            economic_justification=(
                "Verified company guidance" if evidence.guidance_available else "Historical evidence blend; no verified guidance available"
            ),
            confidence="HIGH" if regime.confidence >= 75 and evidence.guidance_available else "MEDIUM" if regime.confidence >= 50 else "LOW",
            rationale=evidence.year1_rationale,
        )
    )
    drivers.append(
        DriverQuality(
            driver="Terminal EBIT margin",
            value=years[-1].ebit_margin if years else None,
            unit="%",
            method=margin_method,
            evidence_strength=margin_score,
            historical_consistency=margin_score,
            economic_justification="Historical margin distribution",
            confidence="MEDIUM" if margin_score >= 60 else "LOW",
            rationale=(
                f"Latest {margin_stats.get('latest', 0):.1%}, 3Y median {margin_stats.get('median_3y', 0):.1%}, "
                f"max {margin_stats.get('max', 0):.1%}, min {margin_stats.get('min', 0):.1%}."
            ),
        )
    )
    tax_value = assumptions.tax_rate[0].effective_value if assumptions.tax_rate else None
    drivers.append(
        DriverQuality(
            driver="Tax rate",
            value=tax_value,
            unit="%",
            method=assumptions.tax_rate[0].source.value if assumptions.tax_rate else "unavailable",
            evidence_strength=90 if tax_value else 0,
            historical_consistency=_clamp(100 - abs((tax_value or 0) - summary.avg_tax_rate) * 200),
            economic_justification="Statutory / marginal rate for NOPAT; historical effective rate is a cross-check.",
            confidence="HIGH" if tax_value else "LOW",
            rationale=assumptions.tax_rate[0].rationale if assumptions.tax_rate else "",
        )
    )
    capex_last = assumptions.capex_pct_revenue[-1].effective_value if assumptions.capex_pct_revenue else None
    drivers.append(
        DriverQuality(
            driver="Capex % revenue (terminal year)",
            value=capex_last,
            unit="% of revenue",
            method=profile.capex_policy,
            evidence_strength=intensity.score,
            historical_consistency=_clamp(100 - abs((capex_last or 0) - summary.median_capex_pct_3y) * 300),
            economic_justification=intensity.split_method,
            confidence="MEDIUM" if intensity.split_available else "LOW",
            rationale=assumptions.capex_pct_revenue[-1].rationale if assumptions.capex_pct_revenue else "",
        )
    )
    drivers.append(
        DriverQuality(
            driver="D&A % revenue",
            value=assumptions.da_pct_revenue[0].effective_value if assumptions.da_pct_revenue else None,
            unit="% of revenue",
            method="Historical average of revenue",
            evidence_strength=75,
            historical_consistency=85,
            economic_justification="Depreciation follows the existing asset base.",
            confidence="MEDIUM",
            rationale=assumptions.da_pct_revenue[0].rationale if assumptions.da_pct_revenue else "",
        )
    )
    drivers.append(
        DriverQuality(
            driver="ΔNWC",
            value=assumptions.nwc_pct_revenue[0].effective_value if assumptions.nwc_pct_revenue else None,
            unit="% of revenue" if assumptions.nwc_method == "balance_sheet" else "% of Δrevenue",
            method=assumptions.nwc_method,
            evidence_strength=80 if assumptions.nwc_method == "balance_sheet" else 50,
            historical_consistency=80 if assumptions.nwc_method == "balance_sheet" else 55,
            economic_justification="Working capital scales with revenue.",
            confidence="MEDIUM" if assumptions.nwc_method == "balance_sheet" else "LOW",
            rationale=assumptions.nwc_pct_revenue[0].rationale if assumptions.nwc_pct_revenue else "",
        )
    )
    drivers.append(
        DriverQuality(
            driver="Terminal growth",
            value=terminal_growth,
            unit="%",
            method="Long-run nominal growth norm for the country / business maturity",
            evidence_strength=80 if terminal_growth <= 0.05 else 45,
            historical_consistency=80,
            economic_justification="Terminal growth must not exceed long-run nominal economic growth.",
            confidence="MEDIUM" if terminal_growth <= 0.05 else "LOW",
            rationale=f"Terminal growth {terminal_growth:.1%} used in both the fade path and Gordon TV.",
        )
    )

    warnings: list[str] = []
    if not evidence.guidance_available:
        warnings.append("No verified management guidance is available; growth rests on historical evidence.")
    if gap is not None and abs(gap) > 5:
        warnings.append(statement)
    if regime.confidence < 50:
        warnings.append(f"Growth regime '{regime.regime}' is supported by only {regime.confidence}% of its signals.")
    if years and years[-1].ebit_margin < 0:
        warnings.append("Terminal EBIT margin is negative; the model does not assume eventual profitability.")

    revenue_path = [
        {"period": "Latest actual", "revenue": base_revenue, "growth": summary.last_1y_growth},
    ] + [{"period": y.period, "revenue": y.revenue, "growth": y.revenue_growth} for y in years]

    evidence_component = (
        0.40 * regime.confidence
        + 0.25 * margin_score
        + 0.20 * (90 if evidence.guidance_available else 45)
        + 0.15 * (intensity.score)
    )
    if gap is not None and abs(gap) > 10 and supported == "evidence_limited":
        evidence_component -= 10
    return ForecastQualityReport(
        score=_clamp(evidence_component),
        regime=regime,
        drivers=drivers,
        historical_cagr=historical_cagr,
        forecast_cagr=forecast_cagr,
        growth_gap_pp=gap,
        growth_gap_statement=statement,
        growth_gap_supported=supported,
        margin_stability_score=_clamp(margin_score),
        margin_stats=margin_stats,
        margin_pattern=pattern,
        margin_method=margin_method,
        revenue_path=revenue_path,
        guidance_available=evidence.guidance_available,
        warnings=warnings,
    )


def assess_wacc_quality(
    wacc_result: WaccResult,
    *,
    country: str,
    currency: str,
    rf_source: str,
    erp_source: str,
    kd_source: str,
    beta_source: str,
    beta_method: str,
    source_date: str,
    beta_already_levered: bool = False,
) -> WaccQualityReport:
    inp = wacc_result.inputs
    india = (currency or "").upper() == "INR" or (country or "").strip().lower() == "india"
    rows = [
        {
            "input": "Risk-free rate",
            "value": inp.risk_free_rate.effective_value,
            "source": rf_source,
            "as_of": inp.risk_free_rate.source_date or source_date,
            "method": "Local 10-year government bond yield",
            "confidence": inp.risk_free_rate.confidence.value,
        },
        {
            "input": "Equity risk premium",
            "value": inp.equity_risk_premium.effective_value,
            "source": erp_source,
            "as_of": inp.equity_risk_premium.source_date or source_date,
            "method": "Mature-market ERP plus country risk premium",
            "confidence": inp.equity_risk_premium.confidence.value,
        },
        {
            "input": "Beta",
            "value": inp.beta.effective_value,
            "source": beta_source,
            "as_of": inp.beta.source_date or source_date,
            "method": beta_method,
            "confidence": inp.beta.confidence.value,
        },
        {
            "input": "Pre-tax cost of debt",
            "value": inp.pretax_cost_of_debt.effective_value,
            "source": kd_source,
            "as_of": inp.pretax_cost_of_debt.source_date or source_date,
            "method": "Local risk-free rate plus a synthetic-rating default spread",
            "confidence": inp.pretax_cost_of_debt.confidence.value,
        },
        {
            "input": "Tax rate",
            "value": inp.tax_rate.effective_value,
            "source": "Statutory / marginal rate" if india else "Historical effective rate",
            "as_of": inp.tax_rate.source_date or source_date,
            "method": "Same marginal rate used for NOPAT and the debt tax shield",
            "confidence": inp.tax_rate.confidence.value,
        },
        {
            "input": "Cost of equity",
            "value": wacc_result.cost_of_equity,
            "source": "CAPM",
            "as_of": source_date,
            "method": "Rf + β × ERP + size premium",
            "confidence": "calculated",
        },
        {
            "input": "Equity weight",
            "value": wacc_result.equity_weight,
            "source": "Market capitalisation",
            "as_of": source_date,
            "method": "Market value of equity / (equity + debt)",
            "confidence": "calculated",
        },
        {
            "input": "Debt weight",
            "value": wacc_result.debt_weight,
            "source": "Borrowings plus leases",
            "as_of": source_date,
            "method": "Market value of debt / (equity + debt)",
            "confidence": "calculated",
        },
    ]

    warnings: list[str] = []
    stale: list[str] = []
    score = 90.0
    wacc = wacc_result.wacc
    rf = inp.risk_free_rate.effective_value
    erp = inp.equity_risk_premium.effective_value

    if india and rf < 0.05:
        warnings.append(f"Risk-free rate {rf:.2%} is low for an INR-denominated model; check the source.")
        score -= 15
    if india and erp < 0.05:
        warnings.append(
            f"Equity risk premium {erp:.2%} looks like a mature-market premium; India requires a country risk premium."
        )
        score -= 20
    if beta_already_levered:
        warnings.append("Beta appears to be relevered twice; verify the Hamada input.")
        score -= 30
    if wacc >= 0.20:
        warnings.append(f"WACC {wacc:.1%} is unusually high. The inputs are flagged for review, not capped.")
        score -= 20
    elif wacc >= 0.18:
        warnings.append(f"WACC {wacc:.1%} is above the 18% review threshold.")
        score -= 10
    if wacc <= 0.07:
        warnings.append(f"WACC {wacc:.1%} is unusually low for this market.")
        score -= 15
    sourced = {"Risk-free rate", "Equity risk premium", "Beta", "Pre-tax cost of debt", "Tax rate"}
    for row in rows:
        if row["input"] in sourced and not row["as_of"]:
            stale.append(str(row["input"]))
    if stale:
        score -= min(15.0, 4.0 * len(stale))
        warnings.append("Inputs without an as-of date: " + ", ".join(stale) + ".")

    return WaccQualityReport(
        score=_clamp(score),
        inputs=rows,
        wacc=wacc,
        warnings=warnings,
        stale_inputs=stale,
        double_relever_detected=beta_already_levered,
    )


def assess_terminal_value_quality(
    valuation: DCFValuationResult | None,
    forecast: ForecastResult,
    *,
    wacc: float,
    terminal_growth: float,
) -> TerminalValueQualityReport:
    if valuation is None:
        return TerminalValueQualityReport(
            score=0,
            wacc=wacc,
            terminal_growth=terminal_growth,
            severity="blocked",
            warnings=["No valuation object; terminal value cannot be assessed."],
        )
    tv_pct = valuation.terminal_value_pct_of_ev
    spread = wacc - terminal_growth
    last_fcff = forecast.years[-1].fcff if forecast.years else 0.0
    warnings: list[str] = []
    score = 85.0
    severity = "ok"

    if spread <= 0:
        return TerminalValueQualityReport(
            score=0,
            tv_pct_of_ev=tv_pct,
            terminal_growth=terminal_growth,
            wacc=wacc,
            spread=spread,
            severity="blocked",
            terminal_fcff_positive=last_fcff > 0,
            warnings=["WACC does not exceed terminal growth; Gordon terminal value is undefined."],
        )
    if spread < 0.03:
        score -= 20
        warnings.append(f"WACC exceeds terminal growth by only {spread:.2%}; terminal value is hypersensitive.")
    if tv_pct > 0.90:
        score -= 35
        severity = "severe"
        warnings.append(f"Terminal value is {tv_pct:.0%} of enterprise value. Almost all value sits beyond the forecast.")
    elif tv_pct > 0.70:
        score -= 15
        severity = "review"
        warnings.append(f"Terminal value is {tv_pct:.0%} of enterprise value.")
    if last_fcff <= 0:
        score -= 25
        warnings.append("Terminal-year FCFF is not positive, so the perpetuity capitalises a loss.")
    if terminal_growth > 0.06:
        score -= 20
        warnings.append(f"Terminal growth {terminal_growth:.1%} exceeds a plausible long-run nominal growth rate.")

    tv_w = []
    for delta in (-0.01, -0.005, 0.0, 0.005, 0.01):
        w = wacc + delta
        tv_w.append(
            {
                "wacc": w,
                "terminal_value": (last_fcff * (1 + terminal_growth) / (w - terminal_growth)) if w > terminal_growth else None,
            }
        )
    tv_g = []
    for delta in (-0.01, -0.005, 0.0, 0.005, 0.01):
        g = terminal_growth + delta
        tv_g.append(
            {
                "terminal_growth": g,
                "terminal_value": (last_fcff * (1 + g) / (wacc - g)) if wacc > g else None,
            }
        )

    return TerminalValueQualityReport(
        score=_clamp(score),
        tv_pct_of_ev=tv_pct,
        terminal_growth=terminal_growth,
        wacc=wacc,
        spread=spread,
        severity=severity,
        terminal_fcff_positive=last_fcff > 0,
        tv_sensitivity_wacc=tv_w,
        tv_sensitivity_growth=tv_g,
        warnings=warnings,
    )


def assess_platform_trajectory(forecast: ForecastResult, valuation: DCFValuationResult | None) -> dict[str, Any]:
    """Time to positive EBIT / FCFF for a loss-making high-growth business."""
    years = forecast.years
    to_ebit = next((i + 1 for i, y in enumerate(years) if y.ebit > 0), None)
    to_fcff = next((i + 1 for i, y in enumerate(years) if y.fcff > 0), None)
    warnings: list[str] = []
    if to_fcff is None:
        warnings.append("FCFF does not turn positive within the explicit forecast period.")
    elif to_fcff > 3:
        warnings.append(f"FCFF turns positive only in year {to_fcff} of the explicit period.")
    if to_ebit is None:
        warnings.append("EBIT does not turn positive within the explicit forecast period.")
    if valuation is not None and valuation.terminal_value_gordon < 0:
        warnings.append("Terminal value is negative because terminal FCFF is negative.")
    if valuation is not None and valuation.terminal_value_pct_of_ev > 0.70:
        warnings.append(f"Terminal value is {valuation.terminal_value_pct_of_ev:.0%} of enterprise value.")
    return {
        "years_to_positive_ebit": to_ebit,
        "years_to_positive_fcff": to_fcff,
        "terminal_ebit_margin": years[-1].ebit_margin if years else None,
        "terminal_fcff": years[-1].fcff if years else None,
        "terminal_value": valuation.terminal_value_gordon if valuation else None,
        "warnings": warnings,
        "note": (
            "Mature margins are not assumed. If the trajectory does not reach positive FCFF, the negative "
            "result is retained and classified as forecast uncertainty."
        ),
    }


def explain_valuation(
    forecast: ForecastResult,
    valuation: DCFValuationResult | None,
    *,
    wacc: float,
    terminal_growth: float,
) -> dict[str, Any]:
    """Deterministic 'why is the value what it is'. No LLM involvement."""
    if valuation is None or not forecast.years:
        return {"available": False, "note": "No valuation to explain."}
    bridge = valuation.equity_bridge
    y1, y5 = forecast.years[0], forecast.years[-1]
    ev = valuation.enterprise_value
    pv_explicit = valuation.pv_of_explicit_fcf
    pv_tv = valuation.pv_of_terminal_value
    net_debt = bridge.less_total_debt + bridge.less_lease_liabilities - bridge.plus_cash_and_investments
    share = (abs(pv_tv) / (abs(pv_explicit) + abs(pv_tv))) if (pv_explicit or pv_tv) else 0.0
    bridge_delta = (
        bridge.plus_cash_and_investments
        + bridge.plus_non_operating_investments
        - bridge.less_total_debt
        - bridge.less_lease_liabilities
        - bridge.less_minority_interest
        - bridge.less_preferred_stock
    )
    if ev and abs(bridge_delta) > abs(ev) * 0.5:
        primary = (
            "Most of the equity value comes from the balance sheet, not from operations: the bridge moves "
            f"enterprise value by {bridge_delta:,.0f} against an enterprise value of {ev:,.0f}."
        )
    elif share > 0.70:
        primary = (
            f"Most of the valuation is driven by the terminal value ({share:.0%} of the discounted total), "
            f"which capitalises year-{len(forecast.years)} FCFF at WACC {wacc:.2%} minus g {terminal_growth:.2%}."
        )
    else:
        primary = (
            f"Most of the valuation is driven by the explicit forecast period ({1 - share:.0%} of the discounted "
            "total), so near-term FCFF matters more than the perpetuity."
        )
    return {
        "available": True,
        "intrinsic_value_per_share": bridge.equity_value_per_share,
        "drivers": {
            "revenue_growth_y1": y1.revenue_growth,
            "revenue_growth_terminal": y5.revenue_growth,
            "terminal_ebit_margin": y5.ebit_margin,
            "wacc": wacc,
            "terminal_growth": terminal_growth,
            "fcff_y1": y1.fcff,
            "fcff_terminal": y5.fcff,
            "pv_explicit_fcff": pv_explicit,
            "pv_terminal_value": pv_tv,
            "terminal_value": valuation.terminal_value_gordon,
            "tv_pct_of_ev": valuation.terminal_value_pct_of_ev,
            "enterprise_value": ev,
            "cash": bridge.plus_cash_and_investments,
            "investments": bridge.plus_non_operating_investments,
            "debt": bridge.less_total_debt,
            "leases": bridge.less_lease_liabilities,
            "nci": bridge.less_minority_interest,
            "net_debt": net_debt,
            "equity_value": bridge.equity_value,
            "shares": bridge.diluted_shares_outstanding,
        },
        "primary_statement": primary,
        "method": "Computed from the valuation object. No language model contributes to these numbers.",
    }


def build_model_health(
    *,
    data: DataQualityReport,
    historical: HistoricalQualityReport,
    forecast_quality: ForecastQualityReport,
    methodology: MethodologySelection,
    intensity: CapitalIntensityProfile,
    wacc_quality: WaccQualityReport,
    terminal: TerminalValueQualityReport,
    stability_score: int,
    stability_warnings: list[str],
    bridge_blocked: bool,
    bridge_block_reason: str | None,
    identity_failure: bool,
    negative_equity: bool,
    negative_class: str | None,
) -> ModelHealth:
    scores = {
        "data_quality": data.score,
        "historical_quality": historical.score,
        "forecast_quality": forecast_quality.score,
        "business_model_fit": methodology.fit_score,
        "capital_intensity": intensity.score,
        "wacc_quality": wacc_quality.score,
        "terminal_value": terminal.score,
        "valuation_stability": stability_score,
    }
    labels = {
        "data_quality": "Data Quality",
        "historical_quality": "Historical Quality",
        "forecast_quality": "Forecast Evidence",
        "business_model_fit": "Business Model Fit",
        "capital_intensity": "Capital Intensity",
        "wacc_quality": "WACC Quality",
        "terminal_value": "Terminal Value Quality",
        "valuation_stability": "Valuation Stability",
    }
    overall = sum(scores[k] * CONFIDENCE_WEIGHTS[k] for k in scores)

    warnings: list[str] = []
    warnings.extend(data.warnings)
    warnings.extend(historical.warnings)
    warnings.extend(forecast_quality.warnings)
    warnings.extend(intensity.warnings)
    warnings.extend(wacc_quality.warnings)
    warnings.extend(terminal.warnings)
    warnings.extend(stability_warnings)
    critical: list[str] = list(data.critical_warnings)
    if methodology.review_reason:
        warnings.append(methodology.review_reason)

    can_show = True
    if not methodology.fcff_appropriate:
        critical.append(methodology.block_reason or "Methodology is inappropriate for this business model.")
        can_show = False
    if identity_failure:
        critical.append("A valuation identity failed. Intrinsic value is blocked.")
        can_show = False
    if bridge_blocked:
        critical.append(bridge_block_reason or "The equity bridge is incomplete.")
        can_show = False

    if not can_show:
        status = "BLOCKED"
        overall_score = min(_clamp(overall), 25)
    else:
        overall_score = _clamp(overall)
        # A precise value cannot be claimed when the methodology itself is under
        # review, when the perpetuity carries almost all the value, or when the
        # result is negative for forecast reasons. These cap the band; they never
        # change the valuation.
        caps: list[tuple[int, str]] = []
        if methodology.requires_review:
            caps.append((59, methodology.review_reason or "Methodology requires review."))
        if terminal.severity == "severe":
            caps.append((59, "Terminal value exceeds 90% of enterprise value."))
        if negative_equity and (negative_class or "FORECAST_UNCERTAIN") == "FORECAST_UNCERTAIN":
            caps.append((59, "Equity value is negative for forecast reasons."))
        if forecast_quality.score < 40:
            caps.append((59, "Forecast evidence is weak."))
        if data.critical_warnings:
            caps.append((39, "Material bridge data is unavailable."))
        for cap, reason in caps:
            if overall_score > cap:
                overall_score = cap
                warnings.append(f"Confidence capped at {cap}: {reason}")
        if overall_score >= 75:
            status = "HIGH_CONFIDENCE"
        elif overall_score >= 60:
            status = "MEDIUM_CONFIDENCE"
        elif overall_score >= 40:
            status = "MEDIUM_LOW_CONFIDENCE"
        else:
            status = "LOW_CONFIDENCE"

    # Rank by how much each dimension costs the overall score, not by raw score.
    # A 10-point gap on a 20%-weighted dimension matters more than on a 10% one.
    ranked = sorted(
        scores.items(),
        key=lambda kv: (100 - kv[1]) * CONFIDENCE_WEIGHTS[kv[0]],
        reverse=True,
    )
    primary_risk = {
        "data_quality": "Source data coverage is incomplete.",
        "historical_quality": "Historical depth is limited.",
        "forecast_quality": "Forecast evidence is limited.",
        "business_model_fit": "The business model does not fit a standard unlevered FCFF DCF.",
        "capital_intensity": "Capital intensity drives the result and the maintenance/growth split is uncertain.",
        "wacc_quality": "WACC inputs need review.",
        "terminal_value": "The valuation depends heavily on terminal assumptions.",
        "valuation_stability": "The valuation is unstable under small assumption changes.",
    }[ranked[0][0]]
    secondary = [
        {
            "data_quality": "Source data coverage is incomplete.",
            "historical_quality": "Historical depth is limited.",
            "forecast_quality": "Forecast evidence is limited.",
            "business_model_fit": "Business-model fit is imperfect.",
            "capital_intensity": "Capital-intensity treatment is uncertain.",
            "wacc_quality": "WACC inputs need review.",
            "terminal_value": "Terminal value dependence is high.",
            "valuation_stability": "Valuation stability is weak.",
        }[k]
        for k, _ in ranked[1:3]
    ]

    if not methodology.fcff_appropriate:
        valuation_status = "Valuation blocked because the methodology is inappropriate for this business model."
    elif bridge_blocked or identity_failure:
        valuation_status = "Valuation blocked until the equity bridge and identities are verified."
    elif negative_equity:
        valuation_status = (
            f"Negative residual equity, classified {negative_class or 'FORECAST_UNCERTAIN'}. "
            f"Available with {status.replace('_', ' ').lower()}."
        )
    else:
        valuation_status = f"Valuation available with {status.replace('_', ' ').lower()}."

    return ModelHealth(
        overall_status=status,
        overall_score=overall_score,
        data_quality_score=data.score,
        historical_quality_score=historical.score,
        forecast_quality_score=forecast_quality.score,
        business_model_fit_score=methodology.fit_score,
        capital_intensity_score=intensity.score,
        wacc_quality_score=wacc_quality.score,
        terminal_value_score=terminal.score,
        valuation_stability_score=stability_score,
        components=[
            {
                "id": k,
                "label": labels[k],
                "score": scores[k],
                "weight": CONFIDENCE_WEIGHTS[k],
                "contribution": round(scores[k] * CONFIDENCE_WEIGHTS[k], 1),
            }
            for k in CONFIDENCE_WEIGHTS
        ],
        warnings=warnings,
        critical_warnings=critical,
        primary_risk=primary_risk,
        secondary_risks=secondary,
        valuation_status=valuation_status,
        can_show_precise_value=can_show,
        methodology=methodology.methodology,
    )


def confidence_band(score: int) -> str:
    if score >= 90:
        return "VERY HIGH"
    if score >= 75:
        return "HIGH"
    if score >= 60:
        return "MEDIUM"
    if score >= 40:
        return "MEDIUM-LOW"
    return "LOW"
