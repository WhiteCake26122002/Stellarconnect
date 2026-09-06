"""
Sensitivity tables and driver-impact ranking. Spec section 17.

Every sensitivity is computed by fully re-running the forecast + valuation
pipeline with one assumption perturbed (never by approximating with a single
partial derivative), so the numbers shown always match what a full
recalculation of the model would produce.
"""
from __future__ import annotations

from pydantic import BaseModel

from .assumption_utils import shift_assumption
from .forecast import ForecastAssumptions, project_financials
from .models import Company, HistoricalFinancials
from .valuation import DCFValuationResult, run_dcf_valuation
from .wacc import WaccResult


class ValuationContext(BaseModel):
    """Bundles the fixed inputs needed to re-run a valuation for sensitivity analysis."""

    model_config = {"arbitrary_types_allowed": True}

    cash_and_investments: float
    total_debt: float
    lease_liabilities: float
    exit_multiple: float | None = None


def _revalue(
    hist: HistoricalFinancials,
    assumptions: ForecastAssumptions,
    wacc_result: WaccResult,
    terminal_growth: float,
    company: Company,
    ctx: ValuationContext,
) -> DCFValuationResult:
    forecast = project_financials(hist, assumptions)
    return run_dcf_valuation(
        forecast=forecast,
        wacc_result=wacc_result,
        terminal_growth=terminal_growth,
        company=company,
        cash_and_investments=ctx.cash_and_investments,
        total_debt=ctx.total_debt,
        lease_liabilities=ctx.lease_liabilities,
        exit_multiple=ctx.exit_multiple,
    )


class SensitivityCell(BaseModel):
    wacc: float
    terminal_growth: float
    enterprise_value: float
    equity_value_per_share: float | None


class WaccGrowthTable(BaseModel):
    wacc_range: list[float]
    growth_range: list[float]
    cells: list[SensitivityCell]

    def value_at(self, wacc: float, growth: float) -> SensitivityCell | None:
        for c in self.cells:
            if abs(c.wacc - wacc) < 1e-9 and abs(c.terminal_growth - growth) < 1e-9:
                return c
        return None


def wacc_vs_growth_table(
    hist: HistoricalFinancials,
    assumptions: ForecastAssumptions,
    base_wacc_result: WaccResult,
    company: Company,
    ctx: ValuationContext,
    wacc_range: list[float],
    growth_range: list[float],
) -> WaccGrowthTable:
    forecast = project_financials(hist, assumptions)
    cells: list[SensitivityCell] = []
    for w in wacc_range:
        for g in growth_range:
            if w <= g:
                cells.append(SensitivityCell(wacc=w, terminal_growth=g, enterprise_value=float("nan"), equity_value_per_share=None))
                continue
            wacc_copy = base_wacc_result.model_copy()
            wacc_copy.wacc = w
            result = run_dcf_valuation(
                forecast=forecast,
                wacc_result=wacc_copy,
                terminal_growth=g,
                company=company,
                cash_and_investments=ctx.cash_and_investments,
                total_debt=ctx.total_debt,
                lease_liabilities=ctx.lease_liabilities,
                exit_multiple=ctx.exit_multiple,
            )
            cells.append(
                SensitivityCell(
                    wacc=w,
                    terminal_growth=g,
                    enterprise_value=result.enterprise_value,
                    equity_value_per_share=result.equity_bridge.equity_value_per_share,
                )
            )
    return WaccGrowthTable(wacc_range=wacc_range, growth_range=growth_range, cells=cells)


class OneDimSensitivityPoint(BaseModel):
    shift: float
    enterprise_value: float
    equity_value_per_share: float | None


class OneDimSensitivity(BaseModel):
    driver_name: str
    points: list[OneDimSensitivityPoint]
    base_enterprise_value: float

    def impact_range_pct(self) -> float:
        values = [p.enterprise_value for p in self.points]
        if not values or self.base_enterprise_value == 0:
            return 0.0
        return (max(values) - min(values)) / abs(self.base_enterprise_value)


def revenue_growth_sensitivity(
    hist, base_assumptions, wacc_result, terminal_growth, company, ctx, shifts: list[float]
) -> OneDimSensitivity:
    base_result = _revalue(hist, base_assumptions, wacc_result, terminal_growth, company, ctx)
    points = []
    for shift in shifts:
        shifted = base_assumptions.model_copy(deep=True)
        shifted.revenue_growth = [shift_assumption(a, shift, "Sensitivity") for a in shifted.revenue_growth]
        result = _revalue(hist, shifted, wacc_result, terminal_growth, company, ctx)
        points.append(
            OneDimSensitivityPoint(
                shift=shift,
                enterprise_value=result.enterprise_value,
                equity_value_per_share=result.equity_bridge.equity_value_per_share,
            )
        )
    return OneDimSensitivity(
        driver_name="Revenue Growth (all forecast years)",
        points=points,
        base_enterprise_value=base_result.enterprise_value,
    )


def ebitda_margin_sensitivity(
    hist, base_assumptions, wacc_result, terminal_growth, company, ctx, shifts: list[float]
) -> OneDimSensitivity:
    base_result = _revalue(hist, base_assumptions, wacc_result, terminal_growth, company, ctx)
    points = []
    for shift in shifts:
        shifted = base_assumptions.model_copy(deep=True)
        per_line = -shift / 3
        shifted.rnd_pct_revenue = [shift_assumption(a, per_line, "Sensitivity") for a in shifted.rnd_pct_revenue]
        shifted.sm_pct_revenue = [shift_assumption(a, per_line, "Sensitivity") for a in shifted.sm_pct_revenue]
        shifted.ga_pct_revenue = [shift_assumption(a, per_line, "Sensitivity") for a in shifted.ga_pct_revenue]
        result = _revalue(hist, shifted, wacc_result, terminal_growth, company, ctx)
        points.append(
            OneDimSensitivityPoint(
                shift=shift,
                enterprise_value=result.enterprise_value,
                equity_value_per_share=result.equity_bridge.equity_value_per_share,
            )
        )
    return OneDimSensitivity(
        driver_name="Terminal EBITDA Margin", points=points, base_enterprise_value=base_result.enterprise_value
    )


def wacc_sensitivity(
    hist, base_assumptions, wacc_result, terminal_growth, company, ctx, shifts: list[float]
) -> OneDimSensitivity:
    base_result = _revalue(hist, base_assumptions, wacc_result, terminal_growth, company, ctx)
    forecast = project_financials(hist, base_assumptions)
    points = []
    for shift in shifts:
        wacc_copy = wacc_result.model_copy()
        wacc_copy.wacc = wacc_result.wacc + shift
        result = run_dcf_valuation(
            forecast=forecast,
            wacc_result=wacc_copy,
            terminal_growth=terminal_growth,
            company=company,
            cash_and_investments=ctx.cash_and_investments,
            total_debt=ctx.total_debt,
            lease_liabilities=ctx.lease_liabilities,
            exit_multiple=ctx.exit_multiple,
        )
        points.append(
            OneDimSensitivityPoint(
                shift=shift,
                enterprise_value=result.enterprise_value,
                equity_value_per_share=result.equity_bridge.equity_value_per_share,
            )
        )
    return OneDimSensitivity(driver_name="WACC", points=points, base_enterprise_value=base_result.enterprise_value)


def capex_sensitivity(
    hist, base_assumptions, wacc_result, terminal_growth, company, ctx, shifts: list[float]
) -> OneDimSensitivity:
    base_result = _revalue(hist, base_assumptions, wacc_result, terminal_growth, company, ctx)
    points = []
    for shift in shifts:
        shifted = base_assumptions.model_copy(deep=True)
        shifted.capex_pct_revenue = [
            shift_assumption(a, shift, "Sensitivity") for a in shifted.capex_pct_revenue
        ]
        result = _revalue(hist, shifted, wacc_result, terminal_growth, company, ctx)
        points.append(
            OneDimSensitivityPoint(
                shift=shift,
                enterprise_value=result.enterprise_value,
                equity_value_per_share=result.equity_bridge.equity_value_per_share,
            )
        )
    return OneDimSensitivity(
        driver_name="Capex % of Revenue", points=points, base_enterprise_value=base_result.enterprise_value
    )


class DriverImpact(BaseModel):
    driver_name: str
    impact_range_pct: float


def rank_valuation_drivers(
    hist, base_assumptions, wacc_result, terminal_growth, company, ctx
) -> list[DriverImpact]:
    """
    Ranks drivers by the % swing in Enterprise Value produced by a standardized
    perturbation of each (+/- one unit step), largest impact first (spec section 17).
    """
    sensitivities = {
        "WACC (+/-1.0pp)": wacc_sensitivity(hist, base_assumptions, wacc_result, terminal_growth, company, ctx, [-0.01, 0.01]),
        "Terminal Growth (+/-0.5pp)": _terminal_growth_sensitivity(
            hist, base_assumptions, wacc_result, terminal_growth, company, ctx, [-0.005, 0.005]
        ),
        "Revenue CAGR (+/-1.0pp/yr)": revenue_growth_sensitivity(hist, base_assumptions, wacc_result, terminal_growth, company, ctx, [-0.01, 0.01]),
        "Terminal EBITDA Margin (+/-1.0pp)": ebitda_margin_sensitivity(hist, base_assumptions, wacc_result, terminal_growth, company, ctx, [-0.01, 0.01]),
        "Capex % of Revenue (+/-0.5pp)": capex_sensitivity(hist, base_assumptions, wacc_result, terminal_growth, company, ctx, [-0.005, 0.005]),
    }
    ranked = [DriverImpact(driver_name=name, impact_range_pct=s.impact_range_pct()) for name, s in sensitivities.items()]
    ranked.sort(key=lambda d: d.impact_range_pct, reverse=True)
    return ranked


def _terminal_growth_sensitivity(
    hist, base_assumptions, wacc_result, terminal_growth, company, ctx, shifts: list[float]
) -> OneDimSensitivity:
    base_result = _revalue(hist, base_assumptions, wacc_result, terminal_growth, company, ctx)
    forecast = project_financials(hist, base_assumptions)
    points = []
    for shift in shifts:
        result = run_dcf_valuation(
            forecast=forecast,
            wacc_result=wacc_result,
            terminal_growth=terminal_growth + shift,
            company=company,
            cash_and_investments=ctx.cash_and_investments,
            total_debt=ctx.total_debt,
            lease_liabilities=ctx.lease_liabilities,
            exit_multiple=ctx.exit_multiple,
        )
        points.append(
            OneDimSensitivityPoint(
                shift=shift,
                enterprise_value=result.enterprise_value,
                equity_value_per_share=result.equity_bridge.equity_value_per_share,
            )
        )
    return OneDimSensitivity(
        driver_name="Terminal Growth", points=points, base_enterprise_value=base_result.enterprise_value
    )
