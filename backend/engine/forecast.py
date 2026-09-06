"""
Forecast engine: builds explicit-period projections of revenue, margins,
opex, D&A, capex, and NWC, each backed by a labeled, sourced `Assumption`.

Phase 1 implements Method A (Historical Trend) as the default methodology:
revenue growth glides linearly from the recent historical run-rate toward a
user-set long-run growth rate, and operating margins glide from the
historical average toward a user-set target margin. Every generated
assumption carries a plain-language rationale (spec section 6/7) and can be
overridden per year without touching the engine.
"""
from __future__ import annotations

from pydantic import BaseModel

from .historical import HistoricalSummary
from .models import AssumptionSource, Assumption, Confidence, HistoricalFinancials, IncomeStatement


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
    # Expect labels like "FY2026"; if that pattern isn't found, fall back to generic labels.
    try:
        prefix = "".join(ch for ch in last_historical_period if not ch.isdigit())
        year = int("".join(ch for ch in last_historical_period if ch.isdigit()))
        return [f"{prefix}{year + i}" for i in range(1, n + 1)]
    except ValueError:
        return [f"Forecast Year {i}" for i in range(1, n + 1)]


def build_default_assumptions(
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    forecast_years: int = 5,
    long_term_growth_rate: float = 0.04,
    target_ebitda_margin: float | None = None,
    source_date: str = "",
) -> ForecastAssumptions:
    """
    Method A - Historical Trend. Revenue growth glides from the recent
    historical run-rate toward `long_term_growth_rate`; margins glide from
    the historical average toward `target_ebitda_margin` (defaults to the
    best historical year, i.e. modest operating-leverage improvement).
    """
    periods = _next_periods(hist.income_statements[-1].period, forecast_years)

    raw_start_growth = summary.recent_2y_avg_growth if summary.recent_2y_avg_growth is not None else (
        summary.revenue_cagr_3y or summary.revenue_cagr_5y or 0.05
    )
    # Cap the auto-populated starting growth rate. A 2-year-average "recent run-rate" is a lagging
    # figure - for a company coming off a low base (e.g. a one-off disruption like a platform migration,
    # a depressed prior year, or a land-banking/expansion phase), it can sit well above even that
    # company's own most recent quarterly trend, let alone anything sustainable for a 5-year explicit
    # forecast. Sustained organic revenue growth above this ceiling is rare for any established company
    # regardless of industry, so silently defaulting to it (rather than requiring the user to
    # deliberately dial in a very bullish number) risks presenting an extreme, transient rebound rate as
    # if it were an ordinary base case. The cap only affects the untouched default - a user who has
    # genuine conviction a company will keep growing this fast can still override it via the slider.
    MAX_DEFAULT_START_GROWTH = 0.40
    start_growth = min(raw_start_growth, MAX_DEFAULT_START_GROWTH)
    capped = start_growth < raw_start_growth
    growth_path = glide_path(start_growth, long_term_growth_rate, forecast_years)

    revenue_growth: list[Assumption] = []
    for period, g in zip(periods, growth_path):
        hist_ref = summary.revenue_cagr_5y or summary.revenue_cagr_3y or start_growth
        cap_note = (
            f" The actual recent 2-year-average run-rate was {raw_start_growth:.1%}, capped to {MAX_DEFAULT_START_GROWTH:.0%} "
            "for this default since sustained growth above that level is rarely representative of an "
            "ordinary base case (often a rebound from a depressed prior year or a one-off event) - "
            "override with a higher number in the sidebar if you have specific reason to expect it to continue."
            if capped else ""
        )
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
                    f"{period} revenue growth is assumed at {g:.1%}, glided from the recent "
                    f"{start_growth:.1%} run-rate toward a {long_term_growth_rate:.1%} long-term normalized "
                    f"rate over the {forecast_years}-year forecast horizon (vs. {hist_ref:.1%} historical "
                    f"5-year CAGR), reflecting expected growth normalization.{cap_note}"
                ),
            )
        )

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

    target_margin = target_ebitda_margin if target_ebitda_margin is not None else max(
        y.ebitda_margin for y in summary.years
    )
    last_revenue = hist.income_statements[-1].revenue

    # Derive opex-as-%-revenue glide paths so that (gross_margin - total_opex_pct) reaches target_margin.
    # Guard against a zero-revenue base year (e.g. a pre-revenue or data-gap period): fall back to the
    # historical average opex ratios rather than dividing by zero.
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
                        f"({hist.income_statements[-1].period} actual) toward {end:.1%} as the model assumes "
                        f"operating leverage improves EBITDA margin toward {target_margin:.1%} by "
                        f"{periods[-1]}."
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

    # Capex glides from the recent historical average toward the D&A % of revenue by the final
    # forecast year, rather than being held flat at the historical average forever. A company mid
    # expansion (e.g. building out new capacity) can run capex well above D&A for years - but holding
    # that elevated ratio flat all the way through the terminal year means the Gordon Growth perpetuity
    # (which assumes the business has settled into its stable, long-run state) is built on a permanently
    # over-investing company, which mechanically depresses FCFF and understates the valuation. In
    # steady state, capex approximately tracks D&A (reinvesting to maintain/modestly grow the asset
    # base at the stable growth rate) - this is the standard treatment in DCF practice (see Damodaran on
    # reinvestment normalizing toward stable growth), not a special case for any one company.
    capex_start = summary.avg_capex_pct_revenue
    capex_end = summary.avg_da_pct_revenue
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
                f"Capex modeled at {v:.1%} of revenue in {p}, gliding from the {capex_start:.1%} recent "
                f"historical average (vs. {summary.years[-1].capex_pct_revenue:.1%} in the most recent year) "
                f"toward {capex_end:.1%} - the historical D&A % of revenue - by {periods[-1]}, reflecting the "
                "standard DCF assumption that reinvestment normalizes to roughly track depreciation once the "
                "business settles into the stable long-run growth priced into the terminal value."
            ),
        )
        for p, v in zip(periods, capex_path)
    ]

    nwc_pct = [
        Assumption(
            name="NWC % of Revenue",
            value=summary.avg_nwc_pct_revenue,
            unit="% of revenue",
            period=p,
            source=AssumptionSource.CALCULATED,
            source_date=source_date,
            confidence=Confidence.MEDIUM,
            rationale=(
                f"Net working capital modeled at the {summary.avg_nwc_pct_revenue:.1%} historical average of "
                f"revenue, held constant given no evidence of a structural change in payment terms."
            ),
        )
        for p in periods
    ]

    tax_rate = [
        Assumption(
            name="Tax Rate",
            value=summary.avg_tax_rate,
            unit="%",
            period=p,
            source=AssumptionSource.CALCULATED,
            source_date=source_date,
            confidence=Confidence.MEDIUM,
            rationale=f"Tax rate held at the {summary.avg_tax_rate:.1%} historical average effective rate.",
        )
        for p in periods
    ]

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
    )


def project_financials(
    hist: HistoricalFinancials,
    assumptions: ForecastAssumptions,
) -> ForecastResult:
    """Rolls the assumption set forward into a full forecast, year by year."""
    n = len(assumptions.forecast_years)
    base_revenue = hist.income_statements[-1].revenue
    prior_nwc = hist.balance_sheets[-1].net_working_capital

    years: list[ForecastYear] = []
    revenue = base_revenue
    for i in range(n):
        g = assumptions.revenue_growth[i].effective_value
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
        nwc = revenue * assumptions.nwc_pct_revenue[i].effective_value
        change_in_nwc = nwc - prior_nwc
        prior_nwc = nwc

        # Reinvestment-rate guard rail (Damodaran: g = ROIC x Reinvestment Rate - no company's working
        # capital build should structurally consume most of its profit forever). This matters for
        # companies where net working capital is a large multiple of revenue (e.g. real-estate
        # developers, whose land/WIP "inventory" can otherwise single-handedly overwhelm FCFF every
        # forecast year); it does not bind for ordinary operating companies, whose working-capital
        # swings are already small relative to NOPAT. Deliberately scoped to the NWC drag alone (not
        # combined with capex) so an intentionally large capex assumption elsewhere can't get silently
        # offset by forcing working capital the other way.
        MAX_NWC_DRAG_OF_NOPAT = 0.75
        if nopat > 0 and change_in_nwc > MAX_NWC_DRAG_OF_NOPAT * nopat:
            change_in_nwc = MAX_NWC_DRAG_OF_NOPAT * nopat

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
