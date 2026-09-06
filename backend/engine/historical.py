"""
Historical financial analysis: growth rates, margins, CAGRs, trends.

Pure functions over `HistoricalFinancials`. Nothing here forecasts anything -
this module only describes what already happened, which is the evidentiary
basis every forecast assumption must cite (spec section 5).
"""
from __future__ import annotations

from pydantic import BaseModel

from .models import HistoricalFinancials


class YearMetrics(BaseModel):
    period: str
    revenue: float
    revenue_growth: float | None  # None for the first historical year (no prior-year base)
    gross_margin: float
    ebitda_margin: float
    ebit_margin: float
    net_margin: float
    tax_rate: float
    capex_pct_revenue: float
    da_pct_revenue: float
    nwc_pct_revenue: float
    fcf_margin: float
    unlevered_fcf: float


class HistoricalSummary(BaseModel):
    years: list[YearMetrics]
    revenue_cagr_3y: float | None
    revenue_cagr_5y: float | None
    avg_gross_margin: float
    avg_ebitda_margin: float
    avg_ebit_margin: float
    median_ebitda_margin: float
    avg_tax_rate: float
    avg_capex_pct_revenue: float
    avg_da_pct_revenue: float
    avg_nwc_pct_revenue: float
    recent_2y_avg_growth: float | None
    trend_commentary: list[str]


def cagr(start: float, end: float, years: int) -> float | None:
    if start <= 0 or years <= 0:
        return None
    return (end / start) ** (1 / years) - 1


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2


def analyze_historicals(hist: HistoricalFinancials) -> HistoricalSummary:
    n = len(hist.income_statements)
    if n == 0:
        raise ValueError("No historical periods provided.")

    years: list[YearMetrics] = []
    for i in range(n):
        inc = hist.income_statements[i]
        bs = hist.balance_sheets[i]
        cf = hist.cash_flows[i]

        prev_revenue = hist.income_statements[i - 1].revenue if i > 0 else None
        growth = (inc.revenue / prev_revenue - 1) if prev_revenue and prev_revenue != 0 else None

        nopat = inc.ebit * (1 - inc.tax_rate) if inc.tax_rate else inc.ebit
        ufcf = nopat + inc.da - cf.capex - cf.change_in_nwc

        years.append(
            YearMetrics(
                period=inc.period,
                revenue=inc.revenue,
                revenue_growth=growth,
                gross_margin=inc.gross_margin,
                ebitda_margin=inc.ebitda_margin,
                ebit_margin=inc.ebit_margin,
                net_margin=(inc.net_income / inc.revenue) if inc.revenue else 0.0,
                tax_rate=inc.tax_rate,
                capex_pct_revenue=(cf.capex / inc.revenue) if inc.revenue else 0.0,
                da_pct_revenue=(inc.da / inc.revenue) if inc.revenue else 0.0,
                nwc_pct_revenue=(bs.net_working_capital / inc.revenue) if inc.revenue else 0.0,
                fcf_margin=(ufcf / inc.revenue) if inc.revenue else 0.0,
                unlevered_fcf=ufcf,
            )
        )

    revenue_cagr_3y = (
        cagr(hist.income_statements[-4].revenue, hist.income_statements[-1].revenue, 3) if n >= 4 else None
    )
    revenue_cagr_5y = (
        cagr(hist.income_statements[-6].revenue, hist.income_statements[-1].revenue, 5) if n >= 6 else None
    )

    growth_values = [y.revenue_growth for y in years if y.revenue_growth is not None]
    recent_2y = growth_values[-2:] if len(growth_values) >= 2 else growth_values
    recent_2y_avg = sum(recent_2y) / len(recent_2y) if recent_2y else None

    avg_gross = sum(y.gross_margin for y in years) / n
    avg_ebitda = sum(y.ebitda_margin for y in years) / n
    avg_ebit = sum(y.ebit_margin for y in years) / n
    med_ebitda = _median([y.ebitda_margin for y in years])
    avg_tax = sum(y.tax_rate for y in years) / n
    avg_capex = sum(y.capex_pct_revenue for y in years) / n
    avg_da = sum(y.da_pct_revenue for y in years) / n
    avg_nwc = sum(y.nwc_pct_revenue for y in years) / n

    commentary: list[str] = []
    if revenue_cagr_5y is not None and recent_2y_avg is not None:
        commentary.append(
            f"Revenue grew at a {revenue_cagr_5y:.1%} 5-year CAGR ({hist.income_statements[-6].period}-"
            f"{hist.income_statements[-1].period}), versus a {recent_2y_avg:.1%} average over the most recent "
            f"two years, indicating {'deceleration' if recent_2y_avg < revenue_cagr_5y else 'acceleration'}."
        )
    first_ebitda, last_ebitda = years[0].ebitda_margin, years[-1].ebitda_margin
    direction = "expanded" if last_ebitda > first_ebitda else "contracted"
    commentary.append(
        f"EBITDA margin {direction} from {first_ebitda:.1%} in {years[0].period} to {last_ebitda:.1%} in "
        f"{years[-1].period}."
    )
    commentary.append(
        f"Average Capex was {avg_capex:.1%} of revenue and average D&A was {avg_da:.1%} of revenue over the "
        f"historical period."
    )

    return HistoricalSummary(
        years=years,
        revenue_cagr_3y=revenue_cagr_3y,
        revenue_cagr_5y=revenue_cagr_5y,
        avg_gross_margin=avg_gross,
        avg_ebitda_margin=avg_ebitda,
        avg_ebit_margin=avg_ebit,
        median_ebitda_margin=med_ebitda,
        avg_tax_rate=avg_tax,
        avg_capex_pct_revenue=avg_capex,
        avg_da_pct_revenue=avg_da,
        avg_nwc_pct_revenue=avg_nwc,
        recent_2y_avg_growth=recent_2y_avg,
        trend_commentary=commentary,
    )
