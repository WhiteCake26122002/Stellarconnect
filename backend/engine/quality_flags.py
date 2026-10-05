"""Model-quality flags. These are not investment recommendations."""
from __future__ import annotations

from pydantic import BaseModel

from .forecast import ForecastResult
from .growth_evidence import GrowthEvidence
from .historical import HistoricalSummary
from .valuation import DCFValuationResult
from .wacc import WaccResult


class QualityFlag(BaseModel):
    code: str
    level: str  # reasonable | review | unrealistic
    category: str
    message: str


def _cagr(start: float, end: float, years: int) -> float | None:
    if start <= 0 or end <= 0 or years <= 0:
        return None
    return (end / start) ** (1 / years) - 1


def build_quality_flags(
    *,
    summary: HistoricalSummary,
    forecast: ForecastResult,
    evidence: GrowthEvidence | None,
    wacc_result: WaccResult,
    valuation: DCFValuationResult | None,
    market_price: float | None,
    industry_growth: float | None = None,
) -> list[QualityFlag]:
    flags: list[QualityFlag] = []
    if not forecast.years:
        return flags

    n = len(forecast.years)
    hist_cagr = summary.revenue_cagr_5y or summary.revenue_cagr_3y
    # base revenue is year0 / (1+g1) — undefined when g1 collapses to -100% (a total
    # wipeout year), so guard it the same way `multiple` below already does. Without
    # this guard, a Year-1 growth of -100% divides by zero here and crashes the whole
    # quality-flags pass (and therefore the model run) instead of just skipping a flag
    # that has no meaningful value to report.
    year1 = forecast.years[0].revenue_growth
    base_revenue_year0 = forecast.years[0].revenue / (1 + year1) if year1 > -0.999 else None
    fcast_cagr = _cagr(base_revenue_year0, forecast.years[-1].revenue, n) if base_revenue_year0 is not None else None
    last_g = forecast.years[-1].revenue_growth
    last_hist = summary.last_1y_growth
    multiple = forecast.years[-1].revenue / base_revenue_year0 if base_revenue_year0 is not None else None

    def add(code: str, level: str, category: str, message: str) -> None:
        flags.append(QualityFlag(code=code, level=level, category=category, message=message))

    if hist_cagr is not None and fcast_cagr is not None:
        gap = abs(fcast_cagr - hist_cagr)
        if gap > 0.12 or (hist_cagr >= 0 and fcast_cagr < -0.02) or (hist_cagr <= 0 and fcast_cagr > 0.08):
            level = "unrealistic" if gap > 0.12 else "review"
            add("growth_vs_hist_cagr", level, "growth",
                f"Forecast revenue CAGR {fcast_cagr:.1%} vs historical CAGR {hist_cagr:.1%}.")
        else:
            add("growth_vs_hist_cagr", "reasonable", "growth",
                f"Forecast CAGR {fcast_cagr:.1%} is within 12pp of historical CAGR {hist_cagr:.1%}.")

    if last_hist is not None:
        gap = abs(year1 - last_hist)
        if gap > 0.15:
            add("year1_vs_last", "unrealistic", "growth",
                f"Year-1 growth {year1:.1%} vs latest year {last_hist:.1%}.")
        elif gap > 0.08:
            add("year1_vs_last", "review", "growth",
                f"Year-1 growth {year1:.1%} differs from latest year {last_hist:.1%} by more than 8pp.")
        else:
            add("year1_vs_last", "reasonable", "growth",
                f"Year-1 growth {year1:.1%} vs latest year {last_hist:.1%}.")

    if industry_growth is None:
        add("industry_growth", "review", "growth", "Industry growth: data unavailable.")
    else:
        gap = abs(year1 - industry_growth)
        level = "unrealistic" if gap > 0.10 else "review" if gap > 0.05 else "reasonable"
        add("industry_growth", level, "growth",
            f"Year-1 growth {year1:.1%} vs industry growth {industry_growth:.1%}.")

    terminal = valuation.terminal_growth if valuation else forecast.assumptions.fade_target
    if abs(last_g - terminal) > 0.01:
        add("fade_vs_terminal", "unrealistic", "growth",
            f"Last explicit growth {last_g:.1%} differs from terminal g {terminal:.1%}.")
    else:
        add("fade_vs_terminal", "reasonable", "growth",
            f"Last explicit year {last_g:.1%} matches terminal growth {terminal:.1%}.")

    if evidence and not evidence.high_growth_evidence_ok:
        add("high_growth_evidence", "review", "growth", evidence.high_growth_evidence_note)
    elif evidence and year1 >= 0.20:
        add("high_growth_evidence", "reasonable", "growth", evidence.high_growth_evidence_note)

    if evidence and evidence.regime == "mature" and year1 > 0.15:
        add("maturity_mismatch", "review", "growth",
            f"Regime is mature but Year-1 growth is {year1:.1%}.")

    if multiple is not None:
        if multiple > 3:
            add("revenue_multiple", "unrealistic", "growth",
                f"Revenue increases {multiple:.1f}× over the explicit forecast. High growth is allowed only with evidence.")
        elif multiple > 1.8:
            add("revenue_multiple", "review", "growth",
                f"Revenue increases {multiple:.1f}× over the explicit forecast.")
        else:
            add("revenue_multiple", "reasonable", "growth",
                f"Revenue increases {multiple:.1f}× over the explicit forecast.")

    peak_ebitda = max(y.ebitda_margin for y in summary.years)
    last_ebitda = forecast.years[-1].ebitda_margin
    median_ebitda = summary.median_ebitda_margin_3y
    margin_delta = last_ebitda - median_ebitda
    if last_ebitda > peak_ebitda + 0.005:
        add("margin_vs_peak", "unrealistic", "margins",
            f"Forecast EBITDA margin {last_ebitda:.1%} is above the historical maximum {peak_ebitda:.1%}.")
    elif margin_delta > 0.05:
        add("margin_expansion", "unrealistic", "margins",
            f"EBITDA margin expands {margin_delta:.1%} vs the last-3-year median.")
    elif margin_delta > 0.02:
        add("margin_expansion", "review", "margins",
            f"EBITDA margin expands {margin_delta:.1%} vs the last-3-year median.")
    else:
        add("margin_expansion", "reasonable", "margins",
            f"EBITDA margin {last_ebitda:.1%} vs last-3-year median {median_ebitda:.1%}.")

    last_year = forecast.years[-1]
    if last_year.revenue:
        capex_pct = last_year.capex / last_year.revenue
        da_pct = last_year.da / last_year.revenue
        if year1 > 0.10 and capex_pct + 0.01 < da_pct:
            add("capex_vs_growth", "review", "reinvestment",
                f"Year-1 growth {year1:.1%} with terminal-year capex {capex_pct:.1%} below D&A {da_pct:.1%}.")
        if last_year.change_in_nwc < 0 and year1 > 0.08:
            add("nwc_vs_growth", "review", "reinvestment",
                "Working capital is forecast to release cash while revenue is still growing.")

    if last_year.nopat > 0 and last_year.change_in_nwc > 0.75 * last_year.nopat:
        add("nwc_drag", "review", "reinvestment",
            "ΔNWC consumes more than 75% of NOPAT. FCFF is allowed to reflect this; it is not capped.")

    if valuation:
        tv = valuation.terminal_value_pct_of_ev
        if tv > 0.90:
            add("tv_share", "unrealistic", "terminal",
                f"Terminal value is {tv:.0%} of enterprise value — severe review. The result is dominated by WACC and g.")
        elif tv > 0.70:
            add("tv_share", "review", "terminal",
                f"Terminal value is {tv:.0%} of enterprise value, so the valuation is particularly sensitive to long-term assumptions.")
        else:
            add("tv_share", "reasonable", "terminal",
                f"Terminal value is {tv:.0%} of enterprise value.")

        if wacc_result.wacc <= valuation.terminal_growth:
            add("gordon_invalid", "unrealistic", "terminal",
                f"WACC {wacc_result.wacc:.2%} does not exceed terminal growth {valuation.terminal_growth:.2%}. Gordon TV is invalid.")

        implied = valuation.equity_bridge.equity_value_per_share
        if implied is not None and market_price:
            gap = implied / market_price - 1
            if abs(gap) > 1.0:
                add("vs_market", "review", "valuation",
                    f"Implied value {implied:,.2f} vs market {market_price:,.2f} ({gap:+.0%}). This is not a calibration target.")
            elif abs(gap) > 0.40:
                add("vs_market", "review", "valuation",
                    f"Implied value differs from market by {gap:+.0%}. Check which assumptions drive the gap.")

        if valuation.equity_bridge.equity_value < 0:
            add(
                "negative_equity",
                "review",
                "valuation",
                "Residual equity value is negative and is not floored to zero. See the NEGATIVE EQUITY DIAGNOSTIC.",
            )
        if valuation.enterprise_value < 0:
            add("negative_ev", "unrealistic", "valuation", "Enterprise value is negative.")

    if wacc_result.wacc <= 0:
        add("negative_wacc", "unrealistic", "valuation", "WACC is not positive.")

    if not summary.cash_reported:
        add("cash_unavailable", "review", "data",
            "Cash is unavailable from the statements. The equity bridge does not treat missing cash as zero.")
    if not summary.operating_wc_complete:
        add("nwc_substitute", "review", "data",
            "Operating working capital lines are unavailable. ΔNWC uses the cash-flow-derived substitute.")

    return flags
