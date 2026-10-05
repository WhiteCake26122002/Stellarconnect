"""Valuation stability engine.

Each perturbation re-runs the full forecast and valuation, so the recorded
response is what the model would actually produce, not a derivative estimate.

Property expectations are economic, not cosmetic. Two of them legitimately
invert when the discounted cash flows are negative: a higher discount rate
shrinks a negative present value, and so does lower terminal growth. Those
cases are reported as EXPECTED_INVERSION with the reason, never silently
passed and never mislabelled MODEL_ERROR.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .assumption_utils import pin_last_growth, shift_assumption
from .forecast import ForecastAssumptions, project_financials
from .models import Company, HistoricalFinancials
from .sensitivity import ValuationContext
from .valuation import run_dcf_valuation
from .wacc import WaccResult

PASS = "PASS"
EXPECTED_INVERSION = "EXPECTED_INVERSION"
NOT_APPLICABLE = "NOT_APPLICABLE"
MODEL_ERROR = "MODEL_ERROR"

_TOL = 1e-6


class PerturbationResult(BaseModel):
    driver: str
    label: str
    shock: str
    equity_value: float | None
    value_per_share: float | None
    enterprise_value: float | None
    pct_change_vs_base: float | None = None


class PropertyCheck(BaseModel):
    property: str
    expectation: str
    status: str
    base: float | None = None
    up: float | None = None
    down: float | None = None
    note: str = ""


class StabilityReport(BaseModel):
    score: int
    base_value_per_share: float | None = None
    perturbations: list[PerturbationResult] = Field(default_factory=list)
    properties: list[PropertyCheck] = Field(default_factory=list)
    failures: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    max_swing_pct: float | None = None
    sign_flips: bool = False
    note: str = (
        "Perturbations are diagnostic. They never change the reported base-case assumptions "
        "and are not tuned against the market price."
    )


def _shift_list(items, delta: float):
    return [shift_assumption(a, delta, "Stability") for a in items]


def _scale_list(items, factor: float):
    return [shift_assumption(a, a.effective_value * (factor - 1.0), "Stability") for a in items]


def _bump_list(items, fraction: float):
    """Signed bump of 'fraction' of the current magnitude.

    Working capital is often negative (payables funding the business). Scaling a
    negative ratio by 1.1 would release more cash, which is the opposite of
    investing more in working capital, so the shock has to move the level in a
    fixed direction regardless of the base sign.
    """
    return [shift_assumption(a, fraction * abs(a.effective_value), "Stability") for a in items]


def _run(
    hist: HistoricalFinancials,
    assumptions: ForecastAssumptions,
    wacc_result: WaccResult,
    terminal_growth: float,
    company: Company,
    ctx: ValuationContext,
):
    forecast = project_financials(hist, assumptions)
    valuation = run_dcf_valuation(
        forecast=forecast,
        wacc_result=wacc_result,
        terminal_growth=terminal_growth,
        company=company,
        cash_and_investments=ctx.cash_and_investments,
        total_debt=ctx.total_debt,
        lease_liabilities=ctx.lease_liabilities,
        exit_multiple=ctx.exit_multiple,
        non_operating_investments=ctx.non_operating_investments,
    )
    return forecast, valuation


def run_stability_analysis(
    *,
    hist: HistoricalFinancials,
    assumptions: ForecastAssumptions,
    wacc_result: WaccResult,
    terminal_growth: float,
    company: Company,
    ctx: ValuationContext,
) -> StabilityReport:
    base_forecast, base_valuation = _run(hist, assumptions, wacc_result, terminal_growth, company, ctx)
    base_eq = base_valuation.equity_bridge.equity_value
    base_ps = base_valuation.equity_bridge.equity_value_per_share
    base_ev = base_valuation.enterprise_value
    pv_total = base_valuation.pv_of_explicit_fcf + base_valuation.pv_of_terminal_value
    terminal_fcff = base_forecast.years[-1].fcff if base_forecast.years else 0.0
    terminal_margin = base_forecast.years[-1].ebit_margin if base_forecast.years else 0.0

    results: list[PerturbationResult] = []
    values: dict[tuple[str, str], float | None] = {}

    def record(driver: str, label: str, shock: str, valuation) -> None:
        eq = valuation.equity_bridge.equity_value
        pct = ((eq - base_eq) / abs(base_eq)) if base_eq else None
        results.append(
            PerturbationResult(
                driver=driver,
                label=label,
                shock=shock,
                equity_value=eq,
                value_per_share=valuation.equity_bridge.equity_value_per_share,
                enterprise_value=valuation.enterprise_value,
                pct_change_vs_base=pct,
            )
        )
        values[(driver, shock)] = eq

    results.append(
        PerturbationResult(
            driver="base",
            label="Base case",
            shock="base",
            equity_value=base_eq,
            value_per_share=base_ps,
            enterprise_value=base_ev,
            pct_change_vs_base=0.0,
        )
    )
    values[("base", "base")] = base_eq

    plan: list[tuple[str, str, str, dict[str, Any]]] = [
        ("revenue_growth", "Revenue growth", "-2pp", {"growth": -0.02}),
        ("revenue_growth", "Revenue growth", "+2pp", {"growth": 0.02}),
        ("margin", "EBITDA margin", "-2pp", {"margin": -0.02}),
        ("margin", "EBITDA margin", "+2pp", {"margin": 0.02}),
        ("wacc", "WACC", "+1pp", {"wacc": 0.01}),
        ("wacc", "WACC", "-1pp", {"wacc": -0.01}),
        ("terminal_growth", "Terminal growth", "-0.5pp", {"tg": -0.005}),
        ("terminal_growth", "Terminal growth", "+0.5pp", {"tg": 0.005}),
        ("capex", "Capex", "-10%", {"capex": 0.90}),
        ("capex", "Capex", "+10%", {"capex": 1.10}),
        ("nwc", "Working capital", "-10%", {"nwc": -0.10}),
        ("nwc", "Working capital", "+10%", {"nwc": 0.10}),
    ]

    for driver, label, shock, spec in plan:
        adj = assumptions.model_copy(deep=True)
        w = wacc_result
        tg = terminal_growth
        if "growth" in spec:
            adj.revenue_growth = _shift_list(adj.revenue_growth, spec["growth"])
            pin_last_growth(adj.revenue_growth, tg, "Stability: last explicit year stays at Gordon g.")
        if "margin" in spec:
            # Same convention as the sensitivity tables: the margin shock is applied
            # across the three opex ratios so it reaches EBITDA and EBIT one-for-one.
            per_line = -spec["margin"] / 3
            adj.rnd_pct_revenue = _shift_list(adj.rnd_pct_revenue, per_line)
            adj.sm_pct_revenue = _shift_list(adj.sm_pct_revenue, per_line)
            adj.ga_pct_revenue = _shift_list(adj.ga_pct_revenue, per_line)
        if "capex" in spec:
            adj.capex_pct_revenue = _scale_list(adj.capex_pct_revenue, spec["capex"])
        if "nwc" in spec:
            adj.nwc_pct_revenue = _bump_list(adj.nwc_pct_revenue, spec["nwc"])
            if adj.nwc_delta_pct_of_delta_revenue is not None:
                adj.nwc_delta_pct_of_delta_revenue += spec["nwc"] * abs(adj.nwc_delta_pct_of_delta_revenue)
        if "wacc" in spec:
            w = wacc_result.model_copy(deep=True)
            w.wacc = wacc_result.wacc + spec["wacc"]
        if "tg" in spec:
            tg = terminal_growth + spec["tg"]
            pin_last_growth(adj.revenue_growth, tg, "Stability: last explicit year stays at Gordon g.")
        if w.wacc <= tg:
            results.append(
                PerturbationResult(
                    driver=driver,
                    label=label,
                    shock=shock,
                    equity_value=None,
                    value_per_share=None,
                    enterprise_value=None,
                )
            )
            values[(driver, shock)] = None
            continue
        _, valuation = _run(hist, adj, w, tg, company, ctx)
        record(driver, label, shock, valuation)

    def pair(driver: str, down_key: str, up_key: str) -> tuple[float | None, float | None]:
        return values.get((driver, down_key)), values.get((driver, up_key))

    properties: list[PropertyCheck] = []
    failures: list[str] = []

    def check(
        name: str,
        expectation: str,
        low: float | None,
        high: float | None,
        *,
        increasing: bool,
        inversion_reason: str | None = None,
        skip_reason: str | None = None,
    ) -> None:
        if skip_reason:
            properties.append(
                PropertyCheck(property=name, expectation=expectation, status=NOT_APPLICABLE, base=base_eq, note=skip_reason)
            )
            return
        if low is None or high is None:
            properties.append(
                PropertyCheck(
                    property=name,
                    expectation=expectation,
                    status=NOT_APPLICABLE,
                    base=base_eq,
                    note="One perturbation is undefined (WACC would not exceed terminal growth).",
                )
            )
            return
        ok = (high >= low - _TOL) if increasing else (high <= low + _TOL)
        if ok:
            status, note = PASS, ""
        elif inversion_reason:
            status, note = EXPECTED_INVERSION, inversion_reason
        else:
            status = MODEL_ERROR
            note = f"Expected {expectation}, but the response moved the other way."
            failures.append(f"{name}: {note}")
        properties.append(
            PropertyCheck(property=name, expectation=expectation, status=status, base=base_eq, up=high, down=low, note=note)
        )

    g_down, g_up = pair("revenue_growth", "-2pp", "+2pp")
    check(
        "Revenue growth",
        "Higher revenue growth should not reduce equity value",
        g_down,
        g_up,
        increasing=True,
        inversion_reason=(
            f"Terminal EBIT margin is {terminal_margin:.1%}. Growing a loss-making operation consumes cash, "
            "so a higher growth rate legitimately lowers value."
            if terminal_margin <= 0
            else None
        ),
    )
    m_down, m_up = pair("margin", "-2pp", "+2pp")
    check("EBITDA margin", "Higher margin should not reduce equity value", m_down, m_up, increasing=True)

    w_up, w_down = pair("wacc", "+1pp", "-1pp")
    check(
        "WACC",
        "Higher WACC should not increase equity value",
        w_down,
        w_up,
        increasing=False,
        inversion_reason=(
            "Discounted cash flows are negative, so a higher discount rate shrinks a negative present value. "
            "This is arithmetic, not a defect."
            if pv_total < 0
            else None
        ),
    )
    tg_down, tg_up = pair("terminal_growth", "-0.5pp", "+0.5pp")
    check(
        "Terminal growth",
        "Higher terminal growth should not reduce equity value",
        tg_down,
        tg_up,
        increasing=True,
        inversion_reason=(
            "Terminal-year FCFF is negative, so a higher terminal growth rate capitalises a larger loss."
            if terminal_fcff < 0
            else None
        ),
    )
    c_down, c_up = pair("capex", "-10%", "+10%")
    check("Capex", "Higher capex should not increase equity value", c_down, c_up, increasing=False)
    n_down, n_up = pair("nwc", "-10%", "+10%")
    check(
        "Working capital",
        "Higher working-capital investment should not increase equity value",
        n_down,
        n_up,
        increasing=False,
    )

    bridge = base_valuation.equity_bridge
    properties.append(
        PropertyCheck(
            property="Debt",
            expectation="Higher debt should reduce equity value",
            status=PASS,
            base=base_eq,
            up=base_eq - 1000.0,
            down=base_eq + 1000.0,
            note="Debt enters the bridge with a negative sign by construction.",
        )
    )
    properties.append(
        PropertyCheck(
            property="Cash",
            expectation="Higher cash should increase equity value",
            status=PASS if bridge.cash_status != "unavailable" else NOT_APPLICABLE,
            base=base_eq,
            note=(
                "Cash enters the bridge with a positive sign by construction."
                if bridge.cash_status != "unavailable"
                else "Cash is unavailable and is not treated as zero, so the bridge is blocked rather than perturbed."
            ),
        )
    )

    numeric = [r.pct_change_vs_base for r in results if r.pct_change_vs_base is not None]
    max_swing = max((abs(v) for v in numeric), default=0.0)
    equities = [r.equity_value for r in results if r.equity_value is not None]
    sign_flips = bool(equities) and (min(equities) < 0 < max(equities))

    score = 95.0
    warnings: list[str] = []
    score -= 45.0 * len(failures)
    if sign_flips:
        score -= 25
        warnings.append("Equity value changes sign within the tested assumption range.")
    if max_swing > 1.0:
        score -= 25
        warnings.append(f"A single-driver shock moves equity value by up to {max_swing:.0%}.")
    elif max_swing > 0.50:
        score -= 15
        warnings.append(f"A single-driver shock moves equity value by up to {max_swing:.0%}.")
    elif max_swing > 0.30:
        score -= 8
    undefined = sum(1 for r in results if r.equity_value is None)
    if undefined:
        score -= 5 * undefined
        warnings.append(f"{undefined} perturbations are undefined because WACC would not exceed terminal growth.")
    for p in properties:
        if p.status == EXPECTED_INVERSION:
            warnings.append(f"{p.property}: {p.note}")

    return StabilityReport(
        score=max(0, min(100, int(round(score)))),
        base_value_per_share=base_ps,
        perturbations=results,
        properties=properties,
        failures=failures,
        warnings=warnings,
        max_swing_pct=max_swing,
        sign_flips=sign_flips,
    )
