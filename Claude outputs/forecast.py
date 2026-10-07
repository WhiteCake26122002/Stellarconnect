"""
Forecast engine: builds explicit-period projections of revenue, margins,
opex, D&A, capex, and NWC, each backed by a labeled, sourced `Assumption`.
"""
from __future__ import annotations

from pydantic import BaseModel

from .company_profile import BusinessTemplate, CompanyProfile, classify_company
from .growth_evidence import (
    GrowthEvidence,
    build_growth_evidence,
    confidence_for,
    year_rationale,
)
from .historical import HistoricalSummary
from .models import Assumption, AssumptionSource, Company, Confidence, HistoricalFinancials

INDIA_STATUTORY_TAX = 0.2517  # 22% + 10% surcharge + 4% cess
MAX_DEFAULT_START_GROWTH = 0.40


def glide_path(start: float, end: float, n: int) -> list[float]:
    """n evenly-spaced steps from `start` toward `end`, inclusive of the final value."""
    if n <= 0:
        return []
    if n == 1:
        return [end]
    return [start + (end - start) * (i / (n - 1)) for i in range(n)]


class ForecastAssumptions(BaseModel):
    forecast_years: list[str]
    revenue_growth: list[Assumption]
    gross_margin: list[Assumption]
    rnd_pct_revenue: list[Assumption]
    sm_pct_revenue: list[Assumption]
    ga_pct_revenue: list[Assumption]
    da_pct_revenue: list[Assumption]
    capex_pct_revenue: list[Assumption]
    nwc_pct_revenue: list[Assumption]
    tax_rate: list[Assumption]
    nwc_method: str = "balance_sheet"
    nwc_delta_pct_of_delta_revenue: float | None = None
    growth_regime: str = "moderate"
    year1_method: str = "statistical_blend"
    fade_target: float = 0.025


class ForecastYear(BaseModel):
    period: str
    revenue: float
    revenue_growth: float
    gross_profit: float
    gross_margin: float
    total_opex_ex_da: float
    ebitda: float
    ebitda_margin: float
    da: float
    ebit: float
    ebit_margin: float
    tax_rate: float
    taxes_on_ebit: float
    nopat: float
    capex: float
    nwc: float
    change_in_nwc: float
    fcff: float


class ForecastResult(BaseModel):
    years: list[ForecastYear]
    assumptions: ForecastAssumptions


def _next_periods(last_historical_period: str, n: int) -> list[str]:
    try:
        prefix = "".join(ch for ch in last_historical_period if not ch.isdigit())
        year = int("".join(ch for ch in last_historical_period if ch.isdigit()))
        return [f"{prefix}{year + i}" for i in range(1, n + 1)]
    except ValueError:
        return [f"Forecast Year {i}" for i in range(1, n + 1)]


def _capex_end(
    summary: HistoricalSummary,
    profile: CompanyProfile,
    fade_to: float = 0.04,
) -> tuple[float, str]:
    start = summary.median_capex_pct_3y
    da = summary.avg_da_pct_revenue
    policy = profile.capex_policy
    if policy == "fade_growth_with_revenue":
        maintenance = da
        excess = max(0.0, start - maintenance)
        hist_g = summary.last_1y_growth if summary.last_1y_growth is not None else summary.revenue_cagr_3y
        if hist_g is None or hist_g <= 0.02:
            end = start
            note = (
                "Growth vs maintenance capex: historical growth is too low to treat excess capex as "
                "expansion, so the last-3-year median is held."
            )
        else:
            scale = min(1.0, max(fade_to, 0.0) / hist_g)
            end = maintenance + excess * scale
            note = (
                f"Maintenance capex ≈ D&A ({da:.1%} of sales). Excess {excess:.1%} is treated as growth "
                f"capex and scaled by terminal g {fade_to:.1%} / historical growth {hist_g:.1%}. "
                "Negative current FCF is not assumed to persist after expansion slows."
            )
    elif policy == "maintain_with_da_floor":
        end = max(da, start * 0.90)
        note = (
            "Asset-heavy / manufacturing: capex stays near the last-3-year median, floored at D&A, "
            "because growth still requires reinvestment."
        )
    elif policy == "maintain_historical":
        end = start
        note = "Capex held at the last-3-year median of revenue (no automatic glide to D&A)."
    elif policy == "partial_normalize":
        end = (start + da) / 2
        note = "Mixed intensity: capex glides halfway from the last-3-year median toward D&A."
    else:
        end = da
        note = "Asset-light: capex glides toward D&A (maintenance) by the last explicit year."
    return end, note


def _tax_assumption(summary: HistoricalSummary, currency: str, period: str, source_date: str) -> Assumption:
    effective = summary.avg_tax_rate
    if (currency or "").upper() == "INR":
        value = INDIA_STATUTORY_TAX
        rationale = (
            f"Indian statutory corporate tax of {INDIA_STATUTORY_TAX:.2%} "
            "(22% + 10% surcharge + 4% cess) used for NOPAT. "
            f"Historical effective rate was {effective:.1%} — shown as a cross-check, not the forecast tax."
        )
        confidence = Confidence.HIGH
    else:
        value = effective
        rationale = f"Tax rate held at the {effective:.1%} historical average effective rate."
        confidence = Confidence.MEDIUM
    return Assumption(
        name="Tax Rate",
        value=value,
        unit="%",
        period=period,
        source=AssumptionSource.CALCULATED,
        source_date=source_date,
        confidence=confidence,
        rationale=rationale,
    )


def build_default_assumptions(
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    forecast_years: int = 5,
    long_term_growth_rate: float = 0.04,
    target_ebitda_margin: float | None = None,
    source_date: str = "",
    *,
    terminal_growth: float | None = None,
    company: Company | None = None,
    methodology: str = "evidence",
    growth_evidence: GrowthEvidence | None = None,
    profile: CompanyProfile | None = None,
) -> ForecastAssumptions:
    """
    Default operating model.

    `methodology=evidence` (default): Year-1 from the growth-evidence hierarchy, fade to
    terminal growth. `methodology=historical`: legacy 2-year run-rate glide, kept for
    comparison, still fades to terminal growth rather than a separate 4% knob.
    Target EBITDA defaults to the last-3-year median, not the historical maximum.
    """
    periods = _next_periods(hist.income_statements[-1].period, forecast_years)
    fade_to = terminal_growth if terminal_growth is not None else long_term_growth_rate
    currency = company.currency if company else ""
    profile = profile or (
        classify_company(company, summary)
        if company is not None
        else CompanyProfile(
            template=BusinessTemplate.OTHER,
            asset_intensity="mixed",
            fcff_appropriate=True,
            capex_policy="partial_normalize",
            rationale="No company profile supplied.",
        )
    )

    evidence = growth_evidence
    if methodology != "historical":
        if evidence is None:
            evidence = build_growth_evidence(
                summary,
                forecast_years=forecast_years,
                terminal_growth=fade_to,
            )
        growth_path = list(evidence.path)
        growth_conf = confidence_for(evidence)
        revenue_growth = []
        for i, (period, g) in enumerate(zip(periods, growth_path)):
            revenue_growth.append(
                Assumption(
                    name="Revenue Growth",
                    value=g,
                    unit="%",
                    period=period,
                    source=evidence.year1_source,
                    source_date=source_date,
                    confidence=growth_conf,
                    rationale=year_rationale(evidence, period, i, g),
                )
            )
        regime = evidence.regime.value
        year1_method = evidence.year1_method
    else:
        raw_start = summary.recent_2y_avg_growth if summary.recent_2y_avg_growth is not None else (
            summary.revenue_cagr_3y or summary.revenue_cagr_5y or 0.05
        )
        start_growth = min(raw_start, MAX_DEFAULT_START_GROWTH)
        capped = start_growth < raw_start
        growth_path = glide_path(start_growth, fade_to, forecast_years)
        hist_ref = summary.revenue_cagr_5y or summary.revenue_cagr_3y or start_growth
        cap_note = (
            f" The actual recent 2-year-average run-rate was {raw_start:.1%}, capped to {MAX_DEFAULT_START_GROWTH:.0%}."
            if capped
            else ""
        )
        revenue_growth = []
        for period, g in zip(periods, growth_path):
            revenue_growth.append(
                Assumption(
                    name="Revenue Growth",
                    value=g,
                    unit="%",
                    period=period,
                    source=AssumptionSource.CALCULATED,
                    source_date=source_date,
                    confidence=Confidence.MEDIUM,
                    rationale=(
                        f"{period} revenue growth is {g:.1%}, using the legacy 2-year run-rate glide "
                        f"from {start_growth:.1%} toward terminal growth {fade_to:.1%} "
                        f"(vs {hist_ref:.1%} historical 5-year CAGR).{cap_note}"
                    ),
                )
            )
        regime = "historical_glide"
        year1_method = "recent_2y_avg"

    last_gm = hist.income_statements[-1].gross_margin
    gross_margin = [
        Assumption(
            name="Gross Margin",
            value=v,
            unit="%",
            period=p,
            source=AssumptionSource.CALCULATED,
            source_date=source_date,
            confidence=Confidence.MEDIUM,
            rationale=(
                f"{p} gross margin held at the last actual level of {last_gm:.1%} "
                f"({hist.income_statements[-1].period}), consistent with the historical average of "
                f"{summary.avg_gross_margin:.1%}."
            ),
        )
        for p, v in zip(periods, glide_path(last_gm, last_gm, forecast_years))
    ]

    # Peak historical margin is an upside case, not the base default.
    default_target = summary.median_ebitda_margin_3y
    target_margin = target_ebitda_margin if target_ebitda_margin is not None else default_target
    if (target_margin - summary.avg_da_pct_revenue) < 0:
        # Do not compound operating losses into perpetuity. This must apply regardless
        # of whether the caller passed an explicit target (e.g. api/valuation_service.py's
        # default_drivers always supplies a float) or we fell back to the historical
        # default — gating only on "no target was given" made this guard unreachable from
        # the API and left loss-making forecasts pinned at a negative EBIT margin for the
        # whole explicit period. EBIT breakeven (target margin = D&A) is a going-concern
        # placeholder, not a mature-margin assumption.
        target_margin = max(0.0, summary.avg_da_pct_revenue)
    last_revenue = hist.income_statements[-1].revenue

    if last_revenue:
        last_rnd_pct = hist.income_statements[-1].rnd / last_revenue
        last_sm_pct = hist.income_statements[-1].sm / last_revenue
        last_ga_pct = hist.income_statements[-1].ga / last_revenue
    else:
        last_rnd_pct = last_sm_pct = last_ga_pct = 0.0
    last_opex_total_pct = last_rnd_pct + last_sm_pct + last_ga_pct
    implied_target_opex_pct = last_gm - target_margin
    opex_scale = (implied_target_opex_pct / last_opex_total_pct) if last_opex_total_pct else 1.0
    end_rnd_pct = last_rnd_pct * opex_scale
    end_sm_pct = last_sm_pct * opex_scale
    end_ga_pct = last_ga_pct * opex_scale

    def _opex_assumptions(name: str, start: float, end: float) -> list[Assumption]:
        path = glide_path(start, end, forecast_years)
        out = []
        for p, v in zip(periods, path):
            out.append(
                Assumption(
                    name=name,
                    value=v,
                    unit="% of revenue",
                    period=p,
                    source=AssumptionSource.CALCULATED,
                    source_date=source_date,
                    confidence=Confidence.MEDIUM,
                    rationale=(
                        f"{name} modeled at {v:.1%} of revenue in {p}, gliding from {start:.1%} "
                        f"({hist.income_statements[-1].period} actual) toward {end:.1%} so EBITDA "
                        f"approaches the mid-cycle target of {target_margin:.1%} by {periods[-1]} "
                        f"(not the latest year and not the peak)."
                        if profile.template.value == "cyclical"
                        else (
                            f"{name} modeled at {v:.1%} of revenue in {p}, gliding from {start:.1%} "
                            f"({hist.income_statements[-1].period} actual) toward {end:.1%} so EBITDA "
                            f"approaches the last-3-year median target of {target_margin:.1%} by {periods[-1]} "
                            f"(not the historical peak)."
                        )
                    ),
                )
            )
        return out

    rnd_pct = _opex_assumptions("R&D % of Revenue", last_rnd_pct, end_rnd_pct)
    sm_pct = _opex_assumptions("S&M % of Revenue", last_sm_pct, end_sm_pct)
    ga_pct = _opex_assumptions("G&A % of Revenue", last_ga_pct, end_ga_pct)

    da_pct = [
        Assumption(
            name="D&A % of Revenue",
            value=summary.avg_da_pct_revenue,
            unit="% of revenue",
            period=p,
            source=AssumptionSource.CALCULATED,
            source_date=source_date,
            confidence=Confidence.MEDIUM,
            rationale=(
                f"D&A modeled at the {summary.avg_da_pct_revenue:.1%} historical average of revenue, held "
                f"flat given no disclosed capex step-change."
            ),
        )
        for p in periods
    ]

    capex_start = summary.median_capex_pct_3y
    capex_end, capex_note = _capex_end(summary, profile, fade_to=fade_to)
    capex_path = glide_path(capex_start, capex_end, forecast_years)
    capex_pct = [
        Assumption(
            name="Capex % of Revenue",
            value=v,
            unit="% of revenue",
            period=p,
            source=AssumptionSource.CALCULATED,
            source_date=source_date,
            confidence=Confidence.MEDIUM,
            rationale=(
                f"Capex modeled at {v:.1%} of revenue in {p}, from last-3-year median {capex_start:.1%} "
                f"toward {capex_end:.1%}. {capex_note} {profile.rationale}"
            ),
        )
        for p, v in zip(periods, capex_path)
    ]

    if summary.nwc_method == "cash_flow_derived":
        if summary.nwc_delta_pct_of_delta_revenue is None:
            nwc_value = 0.0
            nwc_rationale = (
                "Balance-sheet operating working capital is unavailable, and cash-flow ΔNWC / Δrevenue "
                "history is also unavailable. ΔNWC is not fabricated from a silent zero intensity; "
                "FCFF includes no working-capital charge and is flagged as a substitute with missing data."
            )
        else:
            nwc_value = summary.nwc_delta_pct_of_delta_revenue
            nwc_rationale = (
                "Balance-sheet operating working capital is unavailable (missing AR/inventory/AP). "
                f"ΔNWC is forecast as {nwc_value:.1%} of the change in revenue, the historical median of "
                "cash-flow ΔNWC / Δrevenue. This is an explicit substitute, not a silent zero."
            )
    else:
        nwc_value = summary.avg_nwc_pct_revenue
        nwc_rationale = (
            f"Net working capital modeled at the {nwc_value:.1%} historical average of revenue "
            "(operating current assets minus operating current liabilities)."
        )
    nwc_pct = [
        Assumption(
            name="NWC % of Revenue" if summary.nwc_method == "balance_sheet" else "ΔNWC / ΔRevenue",
            value=nwc_value,
            unit="% of revenue" if summary.nwc_method == "balance_sheet" else "% of Δrevenue",
            period=p,
            source=AssumptionSource.CALCULATED,
            source_date=source_date,
            confidence=Confidence.MEDIUM if summary.nwc_method == "balance_sheet" else Confidence.LOW,
            rationale=nwc_rationale,
        )
        for p in periods
    ]

    tax_rate = [_tax_assumption(summary, currency, p, source_date) for p in periods]

    return ForecastAssumptions(
        forecast_years=periods,
        revenue_growth=revenue_growth,
        gross_margin=gross_margin,
        rnd_pct_revenue=rnd_pct,
        sm_pct_revenue=sm_pct,
        ga_pct_revenue=ga_pct,
        da_pct_revenue=da_pct,
        capex_pct_revenue=capex_pct,
        nwc_pct_revenue=nwc_pct,
        tax_rate=tax_rate,
        nwc_method=summary.nwc_method,
        nwc_delta_pct_of_delta_revenue=summary.nwc_delta_pct_of_delta_revenue,
        growth_regime=regime,
        year1_method=year1_method,
        fade_target=fade_to,
    )


def project_financials(
    hist: HistoricalFinancials,
    assumptions: ForecastAssumptions,
) -> ForecastResult:
    """Rolls the assumption set forward into a full forecast, year by year."""
    n = len(assumptions.forecast_years)
    base_revenue = hist.income_statements[-1].revenue
    prior_nwc = hist.balance_sheets[-1].net_working_capital if assumptions.nwc_method == "balance_sheet" else 0.0
    cf_ratio = assumptions.nwc_delta_pct_of_delta_revenue or 0.0

    years: list[ForecastYear] = []
    revenue = base_revenue
    for i in range(n):
        g = assumptions.revenue_growth[i].effective_value
        prior_revenue = revenue
        revenue = revenue * (1 + g)

        gm = assumptions.gross_margin[i].effective_value
        gross_profit = revenue * gm

        rnd = revenue * assumptions.rnd_pct_revenue[i].effective_value
        sm = revenue * assumptions.sm_pct_revenue[i].effective_value
        ga = revenue * assumptions.ga_pct_revenue[i].effective_value
        total_opex = rnd + sm + ga
        ebitda = gross_profit - total_opex
        ebitda_margin = ebitda / revenue if revenue else 0.0

        da = revenue * assumptions.da_pct_revenue[i].effective_value
        ebit = ebitda - da
        ebit_margin = ebit / revenue if revenue else 0.0

        tax_rate = assumptions.tax_rate[i].effective_value
        taxes_on_ebit = max(ebit, 0) * tax_rate
        nopat = ebit - taxes_on_ebit

        capex = revenue * assumptions.capex_pct_revenue[i].effective_value
        if assumptions.nwc_method == "cash_flow_derived":
            change_in_nwc = cf_ratio * (revenue - prior_revenue)
            nwc = prior_nwc + change_in_nwc
        else:
            nwc = revenue * assumptions.nwc_pct_revenue[i].effective_value
            change_in_nwc = nwc - prior_nwc
        prior_nwc = nwc

        fcff = nopat + da - capex - change_in_nwc

        years.append(
            ForecastYear(
                period=assumptions.forecast_years[i],
                revenue=revenue,
                revenue_growth=g,
                gross_profit=gross_profit,
                gross_margin=gm,
                total_opex_ex_da=total_opex,
                ebitda=ebitda,
                ebitda_margin=ebitda_margin,
                da=da,
                ebit=ebit,
                ebit_margin=ebit_margin,
                tax_rate=tax_rate,
                taxes_on_ebit=taxes_on_ebit,
                nopat=nopat,
                capex=capex,
                nwc=nwc,
                change_in_nwc=change_in_nwc,
                fcff=fcff,
            )
        )

    return ForecastResult(years=years, assumptions=assumptions)
