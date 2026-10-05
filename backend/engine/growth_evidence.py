"""
Growth evidence engine.

Historical growth is evidence for a forecast, never the forecast itself.
Year-1 is chosen from a hierarchy. Explicit years then fade to the same
terminal growth used in Gordon TV. No stacked premiums.
"""
from __future__ import annotations

from enum import Enum
from statistics import median as _py_median
from statistics import pstdev

from pydantic import BaseModel

from .historical import HistoricalSummary
from .models import AssumptionSource, Confidence


HIGH_GROWTH_THRESHOLD = 0.20
MIN_YEAR_GROWTH = -0.80
MAX_YEAR_GROWTH = 0.80
# Recovery CAGRs are a low-base rebound, not a durable growth rate. Until a
# real guidance/TAM feed exists, do not let Year-1 ride the 80% extreme rail
# on those same trailing statistics.
RECOVERY_YEAR1_CAP = HIGH_GROWTH_THRESHOLD
MIN_USABLE_ROIC = 0.03
# No caller currently supplies management guidance (no filings / earnings-call
# / consensus feed). Do not phrase that as a per-company "data unavailable".
GUIDANCE_NOT_WIRED = (
    "This engine has no company-guidance feed "
    "(filings, earnings-call transcripts, and consensus estimates are not wired), "
    "so Year-1 is never sourced from management guidance."
)


class GrowthRegime(str, Enum):
    HIGH_GROWTH = "high_growth"
    MODERATE = "moderate"
    MATURE = "mature"
    CYCLICAL = "cyclical"
    DECLINING = "declining"
    RECOVERY = "recovery"


class GrowthEvidence(BaseModel):
    last_1y: float | None
    cagr_2y: float | None
    cagr_3y: float | None
    cagr_5y: float | None
    cagr_7y: float | None
    median_annual: float | None
    mean_annual: float | None
    volatility: float | None
    min_annual: float | None
    max_annual: float | None
    implied_fundamental_g: float | None
    roic: float | None
    reinvestment_rate: float | None
    regime: GrowthRegime
    year1: float
    year1_method: str
    year1_source: AssumptionSource
    year1_rationale: str
    path: list[float]
    fade_target: float
    high_growth_evidence_ok: bool
    high_growth_evidence_note: str
    guidance_available: bool = False
    year1_uncertain: bool = False


def _median(values: list[float]) -> float:
    return float(_py_median(values))


def classify_growth_regime(yoy: list[float]) -> GrowthRegime:
    """Quantitative regime. Not an LLM judgment."""
    usable = [v for v in yoy if v is not None]
    if len(usable) < 2:
        return GrowthRegime.MATURE
    med = _median(usable)
    vol = pstdev(usable) if len(usable) >= 2 else 0.0
    last = usable[-1]
    last3 = usable[-3:] if len(usable) >= 3 else usable
    mn, mx = min(usable), max(usable)

    if (len(last3) >= 2 and all(v < 0 for v in last3)) or (med < -0.02 and last < 0):
        return GrowthRegime.DECLINING

    first_half = usable[: max(1, len(usable) // 2)]
    if min(first_half) < -0.05 and last > 0.08 and last > med + 0.05:
        return GrowthRegime.RECOVERY

    if vol > 0.12 and (mx - mn) > 0.25:
        return GrowthRegime.CYCLICAL

    if med >= 0.15 and min(usable) >= 0.04:
        return GrowthRegime.HIGH_GROWTH

    if abs(med) <= 0.08 and vol <= 0.08:
        return GrowthRegime.MATURE

    return GrowthRegime.MODERATE


def fade_growth_path(year1: float, terminal: float, n: int, regime: GrowthRegime) -> list[float]:
    """
    Stage-wise fade: high → moderating → mature → terminal.
    Last explicit year is always `terminal` so Gordon g matches the path.
    """
    if n <= 0:
        return []
    if n == 1:
        return [terminal]

    end = terminal
    if regime == GrowthRegime.DECLINING and year1 < 0:
        # Do not bounce a shrinking company to emerging-market GDP without evidence.
        end = min(terminal, 0.0)

    if regime == GrowthRegime.CYCLICAL and year1 < end:
        # Gordon identity requires the last explicit year = g. Do not glide Year-1
        # *up* toward g as if that were a volume recovery path.
        path = [year1] * (n - 1) + [end]
        return path

    if regime == GrowthRegime.HIGH_GROWTH:
        exponent = 1.55
    elif regime in {GrowthRegime.RECOVERY, GrowthRegime.CYCLICAL}:
        exponent = 0.75
    elif regime == GrowthRegime.MATURE:
        exponent = 0.55
    else:
        exponent = 1.0

    path: list[float] = []
    denom = n - 1
    for i in range(n):
        t = i / denom
        remaining = (1.0 - t) ** exponent
        path.append(end + (year1 - end) * remaining)
    path[-1] = end
    return path


def _statistical_blend(
    cagr_3y: float | None,
    cagr_5y: float | None,
    median_annual: float | None,
    last_1y: float | None,
) -> tuple[float, list[str]]:
    parts: list[tuple[str, float]] = []
    if cagr_3y is not None:
        parts.append(("3y CAGR", cagr_3y))
    if cagr_5y is not None:
        parts.append(("5y CAGR", cagr_5y))
    if median_annual is not None:
        parts.append(("median annual growth", median_annual))
    if not parts and last_1y is not None:
        parts.append(("latest year (only available statistic)", last_1y))
    if not parts:
        return 0.04, ["no historical growth statistics"]
    value = _median([v for _, v in parts])
    return value, [name for name, _ in parts]


def _guidance_clause(guidance: float | None) -> str:
    if guidance is not None:
        return f"Company guidance: {guidance:.1%}."
    return GUIDANCE_NOT_WIRED


def select_year1_growth(
    *,
    user_override: float | None = None,
    guidance: float | None = None,
    implied_fundamental_g: float | None,
    roic: float | None,
    cagr_3y: float | None,
    cagr_5y: float | None,
    median_annual: float | None,
    last_1y: float | None,
    regime: GrowthRegime,
) -> tuple[float, str, AssumptionSource, str]:
    if user_override is not None:
        return (
            user_override,
            "user",
            AssumptionSource.USER_ASSUMPTION,
            "Year 1 is the user-provided growth assumption.",
        )
    if guidance is not None:
        return (
            guidance,
            "guidance",
            AssumptionSource.COMPANY_GUIDANCE,
            f"Year 1 uses verified company guidance of {guidance:.1%}.",
        )

    blend, blend_names = _statistical_blend(cagr_3y, cagr_5y, median_annual, last_1y)
    blend_txt = ", ".join(blend_names)
    last_txt = "data unavailable" if last_1y is None else f"{last_1y:.1%}"

    identity_ok = (
        implied_fundamental_g is not None
        and roic is not None
        and roic >= MIN_USABLE_ROIC
        and MIN_YEAR_GROWTH <= implied_fundamental_g <= MAX_YEAR_GROWTH
    )

    # Cyclical / recovery / mature: latest year and one-year identity are the most misleading.
    if regime in {GrowthRegime.CYCLICAL, GrowthRegime.RECOVERY, GrowthRegime.MATURE}:
        return (
            blend,
            "statistical_blend",
            AssumptionSource.CALCULATED,
            (
                f"{regime.value.replace('_', ' ').title()} regime: Year 1 is the median of {blend_txt} "
                f"= {blend:.1%}. Latest-year growth ({last_txt}) and identity g = ROIC × reinvestment "
                f"are treated as evidence, not the forecast. {_guidance_clause(guidance)}"
            ),
        )

    if identity_ok:
        implied = implied_fundamental_g or 0.0
        if abs(implied - blend) > 0.05:
            # One-directional: keep the blend only as a ceiling on a reinvestment
            # spike. A more conservative identity is grounded in trailing ROIC × RR
            # and must not be discarded in favor of extrapolated CAGR.
            if implied < blend:
                return (
                    implied,
                    "identity",
                    AssumptionSource.CALCULATED,
                    (
                        f"Identity g = ROIC × reinvestment ({implied:.1%}) is more than 5pp below the "
                        f"statistical blend of {blend_txt} ({blend:.1%}). Using the identity because it "
                        "is the more conservative of the two and is grounded in trailing ROIC and "
                        f"reinvestment, not extrapolated CAGR. Latest year {last_txt}. "
                        f"{_guidance_clause(guidance)}"
                    ),
                )
            return (
                blend,
                "statistical_blend",
                AssumptionSource.CALCULATED,
                (
                    f"Identity g = ROIC × reinvestment ({implied:.1%}) is more than 5pp above the "
                    f"statistical blend of {blend_txt} ({blend:.1%}). Using the blend so a single-year "
                    f"reinvestment spike is not the forecast. Latest year {last_txt}. "
                    f"{_guidance_clause(guidance)}"
                ),
            )
        return (
            implied,
            "identity",
            AssumptionSource.CALCULATED,
            (
                f"Year 1 from the fundamental identity g = ROIC × reinvestment rate = {implied:.1%} "
                f"(ROIC {roic:.1%}). Statistical blend of {blend_txt} was {blend:.1%}; latest year {last_txt}. "
                f"These are alternatives, not stacked premiums. {_guidance_clause(guidance)}"
            ),
        )

    return (
        blend,
        "statistical_blend",
        AssumptionSource.CALCULATED,
        (
            f"Year 1 is the median of {blend_txt} = {blend:.1%}. Latest-year growth ({last_txt}) is not "
            "copied into the forecast. Identity g = ROIC × RR: data unavailable or not usable. "
            f"{_guidance_clause(guidance)} Industry/TAM/AI premiums are not added on top."
        ),
    )


def high_growth_evidence(
    year1: float,
    *,
    cagr_3y: float | None,
    cagr_5y: float | None,
    implied_fundamental_g: float | None,
    regime: GrowthRegime,
    guidance: float | None = None,
) -> tuple[bool, str]:
    if year1 <= HIGH_GROWTH_THRESHOLD + 1e-12:
        return True, "Year-1 growth is at or below the 20% high-growth screen, so extra evidence is not required."
    hits: list[str] = []
    # Recovery CAGRs / identity are the same series that produced the Year-1
    # blend. Counting them as "corroboration" is circular.
    if regime != GrowthRegime.RECOVERY:
        if cagr_3y is not None and cagr_3y >= 0.12:
            hits.append(f"3y CAGR {cagr_3y:.1%}")
        if cagr_5y is not None and cagr_5y >= 0.10:
            hits.append(f"5y CAGR {cagr_5y:.1%}")
        if implied_fundamental_g is not None and implied_fundamental_g >= 0.15:
            hits.append(f"identity g {implied_fundamental_g:.1%}")
        if regime == GrowthRegime.HIGH_GROWTH:
            hits.append("historical pattern classified as consistently high growth")
    if guidance is not None:
        hits.append(f"company guidance {guidance:.1%}")
    if len(hits) >= 2:
        return True, "High-growth Year 1 is supported by: " + "; ".join(hits) + "."
    if regime == GrowthRegime.RECOVERY:
        return (
            False,
            (
                "HIGH GROWTH NOT SUFFICIENTLY SUPPORTED "
                f"(Year 1 {year1:.1%}; recovery regime). "
                "3y/5y CAGR and identity g are the same statistics that produced the Year-1 blend, "
                "so they are not independent corroboration. "
                f"{GUIDANCE_NOT_WIRED}"
            ),
        )
    detail = "; ".join(hits) if hits else "no verified supporting series"
    return (
        False,
        (
            "HIGH GROWTH NOT SUFFICIENTLY SUPPORTED "
            f"(Year 1 {year1:.1%}; available support: {detail}). "
            "This engine has no company-guidance, TAM, volume, pricing, or market-share feed."
        ),
    )


def build_growth_evidence(
    summary: HistoricalSummary,
    *,
    forecast_years: int,
    terminal_growth: float,
    implied_fundamental_g: float | None = None,
    roic: float | None = None,
    reinvestment_rate: float | None = None,
    user_year1: float | None = None,
    guidance: float | None = None,
) -> GrowthEvidence:
    yoy = [y.revenue_growth for y in summary.years if y.revenue_growth is not None]
    regime = classify_growth_regime(yoy)
    cagr_5y = summary.revenue_cagr_5y
    if regime == GrowthRegime.CYCLICAL and (summary.growth_volatility or 0) > 0.12:
        cagr_5y = None
    year1, method, source, rationale = select_year1_growth(
        user_override=user_year1,
        guidance=guidance,
        implied_fundamental_g=implied_fundamental_g,
        roic=roic,
        cagr_3y=summary.revenue_cagr_3y,
        cagr_5y=cagr_5y,
        median_annual=summary.median_annual_growth,
        last_1y=summary.last_1y_growth,
        regime=regime,
    )
    if regime == GrowthRegime.CYCLICAL:
        rationale += (
            " Volume, realised price/tonne, acquisition, and currency splits are unavailable; "
            "Year-1 is not a SaaS-like CAGR extrapolation."
        )
        if (summary.growth_volatility or 0) > 0.12:
            rationale += (
                " 5-year CAGR omitted from the blend because growth volatility is high; "
                "a commodity-price spike would otherwise dominate Year 1."
            )
    raw_year1 = year1
    recovery_unverified = (
        regime == GrowthRegime.RECOVERY and user_year1 is None and guidance is None
    )
    upper = RECOVERY_YEAR1_CAP if recovery_unverified else MAX_YEAR_GROWTH
    year1 = min(max(year1, MIN_YEAR_GROWTH), upper)
    if abs(year1 - raw_year1) > 1e-12:
        if recovery_unverified:
            rationale += (
                f" Recovery Year-1 capped from {raw_year1:.1%} to {year1:.1%} "
                f"(the {RECOVERY_YEAR1_CAP:.0%} high-growth screen). Trailing CAGRs that "
                "classify a recovery are not independent evidence for the 80% extreme rail."
            )
        else:
            rationale += f" Clamped from {raw_year1:.1%} to {year1:.1%} by extreme-value rails (−80% / +80%)."

    ok, note = high_growth_evidence(
        year1,
        cagr_3y=summary.revenue_cagr_3y,
        cagr_5y=summary.revenue_cagr_5y,
        implied_fundamental_g=implied_fundamental_g,
        regime=regime,
        guidance=guidance,
    )
    if year1 > HIGH_GROWTH_THRESHOLD + 1e-12 and not ok and user_year1 is None:
        blend, _names = _statistical_blend(
            summary.revenue_cagr_3y, summary.revenue_cagr_5y, summary.median_annual_growth, summary.last_1y_growth
        )
        blend = min(max(blend, MIN_YEAR_GROWTH), HIGH_GROWTH_THRESHOLD)
        rationale += (
            f" High-growth Year 1 of {year1:.1%} lacked sufficient supporting evidence, so the forecast "
            f"uses {blend:.1%} (statistical blend, capped at the 20% high-growth screen). {note}"
        )
        year1 = blend
        method = "statistical_blend"
        ok, note = high_growth_evidence(
            year1,
            cagr_3y=summary.revenue_cagr_3y,
            cagr_5y=summary.revenue_cagr_5y,
            implied_fundamental_g=implied_fundamental_g,
            regime=regime,
            guidance=guidance,
        )
    path = fade_growth_path(year1, terminal_growth, forecast_years, regime)
    return GrowthEvidence(
        last_1y=summary.last_1y_growth,
        cagr_2y=summary.revenue_cagr_2y,
        cagr_3y=summary.revenue_cagr_3y,
        cagr_5y=summary.revenue_cagr_5y,
        cagr_7y=summary.revenue_cagr_7y,
        median_annual=summary.median_annual_growth,
        mean_annual=summary.mean_annual_growth,
        volatility=summary.growth_volatility,
        min_annual=summary.min_annual_growth,
        max_annual=summary.max_annual_growth,
        implied_fundamental_g=implied_fundamental_g,
        roic=roic,
        reinvestment_rate=reinvestment_rate,
        regime=regime,
        year1=year1,
        year1_method=method,
        year1_source=source,
        year1_rationale=rationale,
        path=path,
        fade_target=path[-1] if path else terminal_growth,
        high_growth_evidence_ok=ok,
        high_growth_evidence_note=note,
        guidance_available=guidance is not None,
        year1_uncertain="more than 5pp" in rationale,
    )


def year_rationale(evidence: GrowthEvidence, period: str, year_index: int, g: float) -> str:
    n = max(len(evidence.path), 1)
    if evidence.regime == GrowthRegime.CYCLICAL:
        if year_index >= n - 1:
            stage = "terminal (Gordon g pinned; not a recovery ramp)"
        else:
            stage = "historical normalized growth (held, not interpolated to g)"
    elif year_index == 0:
        stage = "high-growth / Year 1"
    elif year_index >= n - 1:
        stage = "terminal (last explicit year = Gordon g)"
    elif year_index < n / 3:
        stage = "high-growth"
    elif year_index < 2 * n / 3:
        stage = "moderating"
    else:
        stage = "mature"
    return (
        f"{period} revenue growth is {g:.1%} ({stage}). {evidence.year1_rationale} "
        f"Regime {evidence.regime.value.replace('_', ' ')}. Fade target {evidence.fade_target:.1%} "
        f"equals the terminal growth used in Gordon TV. {evidence.high_growth_evidence_note}"
    )


def confidence_for(evidence: GrowthEvidence) -> Confidence:
    if evidence.year1_method == "user":
        return Confidence.HIGH
    if evidence.regime == GrowthRegime.CYCLICAL:
        return Confidence.LOW
    if evidence.year1_uncertain:
        return Confidence.LOW
    if not evidence.high_growth_evidence_ok:
        return Confidence.LOW
    if evidence.year1_method == "identity":
        return Confidence.MEDIUM
    return Confidence.MEDIUM
