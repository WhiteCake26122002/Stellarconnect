"""Base / Bull / Bear scenario engine. Spec section 16."""
from __future__ import annotations

from pydantic import BaseModel

from .assumption_utils import shift_assumption
from .forecast import ForecastAssumptions, ForecastResult, project_financials
from .historical import HistoricalSummary
from .models import Company, HistoricalFinancials
from .valuation import DCFValuationResult, run_dcf_valuation
from .wacc import WaccInputs, WaccResult, calculate_wacc


class ScenarioDefinition(BaseModel):
    name: str
    description: str
    key_drivers: list[str]
    revenue_growth_delta: float = 0.0  # added to every forecast-year growth rate
    ebitda_margin_delta: float = 0.0  # added to every forecast-year gross-derived opex glide endpoint (applied via opex pct delta)
    capex_pct_delta: float = 0.0  # added to capex % of revenue
    nwc_pct_delta: float = 0.0  # added to NWC % of revenue
    wacc_delta: float = 0.0  # added to WACC
    terminal_growth_delta: float = 0.0  # added to terminal growth


class ScenarioOutput(BaseModel):
    definition: ScenarioDefinition
    forecast: ForecastResult
    wacc_result: WaccResult
    terminal_growth: float
    valuation: DCFValuationResult
    revenue_cagr: float | None


BASE_CASE = ScenarioDefinition(
    name="Base Case",
    description="Most probable scenario using evidence-supported, conservative assumptions.",
    key_drivers=["Historical trend growth normalization", "Gradual operating-leverage margin improvement"],
)

BULL_CASE = ScenarioDefinition(
    name="Bull Case",
    description="Upside scenario reflecting stronger execution and market conditions.",
    key_drivers=[
        "Faster revenue growth from market-share gains",
        "Greater margin expansion from operating leverage",
        "Lower capital intensity",
        "Lower discount rate on improved risk profile",
    ],
    revenue_growth_delta=0.02,
    ebitda_margin_delta=0.02,
    capex_pct_delta=-0.005,
    nwc_pct_delta=-0.005,
    wacc_delta=-0.005,
    terminal_growth_delta=0.005,
)

BEAR_CASE = ScenarioDefinition(
    name="Bear Case",
    description="Downside scenario reflecting competitive pressure and cost inflation.",
    key_drivers=[
        "Revenue deceleration from competitive pressure",
        "Margin compression from cost inflation",
        "Higher capital intensity",
        "Higher discount rate on elevated risk",
    ],
    revenue_growth_delta=-0.02,
    ebitda_margin_delta=-0.02,
    capex_pct_delta=0.005,
    nwc_pct_delta=0.005,
    wacc_delta=0.01,
    terminal_growth_delta=-0.005,
)


def apply_scenario_to_assumptions(
    base_assumptions: ForecastAssumptions, scenario: ScenarioDefinition
) -> ForecastAssumptions:
    clone = base_assumptions.model_copy(deep=True)

    clone.revenue_growth = [
        shift_assumption(a, scenario.revenue_growth_delta, scenario.name) for a in clone.revenue_growth
    ]
    # Distribute the EBITDA-margin delta across opex lines (evenly) so gross margin stays untouched
    # and EBITDA margin moves by exactly `ebitda_margin_delta` at every forecast year.
    per_line_delta = -scenario.ebitda_margin_delta / 3
    clone.rnd_pct_revenue = [shift_assumption(a, per_line_delta, scenario.name) for a in clone.rnd_pct_revenue]
    clone.sm_pct_revenue = [shift_assumption(a, per_line_delta, scenario.name) for a in clone.sm_pct_revenue]
    clone.ga_pct_revenue = [shift_assumption(a, per_line_delta, scenario.name) for a in clone.ga_pct_revenue]
    clone.capex_pct_revenue = [
        shift_assumption(a, scenario.capex_pct_delta, scenario.name) for a in clone.capex_pct_revenue
    ]
    clone.nwc_pct_revenue = [
        shift_assumption(a, scenario.nwc_pct_delta, scenario.name) for a in clone.nwc_pct_revenue
    ]
    return clone


def run_scenario(
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    company: Company,
    base_assumptions: ForecastAssumptions,
    base_wacc_inputs: WaccInputs,
    base_terminal_growth: float,
    scenario: ScenarioDefinition,
    cash_and_investments: float,
    total_debt: float,
    lease_liabilities: float,
    exit_multiple: float | None = None,
) -> ScenarioOutput:
    scenario_assumptions = apply_scenario_to_assumptions(base_assumptions, scenario)
    forecast = project_financials(hist, scenario_assumptions)

    wacc_inputs = base_wacc_inputs.model_copy(deep=True)
    wacc_inputs.beta = wacc_inputs.beta.model_copy()
    # WACC delta applied post-hoc by shifting the equity risk premium equivalent; simplest transparent
    # approach is to compute base WACC then add the scenario delta directly.
    base_wacc = calculate_wacc(wacc_inputs)
    scenario_wacc = base_wacc.model_copy()
    scenario_wacc.wacc = base_wacc.wacc + scenario.wacc_delta

    terminal_growth = base_terminal_growth + scenario.terminal_growth_delta

    valuation = run_dcf_valuation(
        forecast=forecast,
        wacc_result=scenario_wacc,
        terminal_growth=terminal_growth,
        company=company,
        cash_and_investments=cash_and_investments,
        total_debt=total_debt,
        lease_liabilities=lease_liabilities,
        exit_multiple=exit_multiple,
    )

    base_revenue = hist.income_statements[-1].revenue
    last_rev = forecast.years[-1].revenue
    n = len(forecast.years)
    revenue_cagr = (last_rev / base_revenue) ** (1 / n) - 1 if base_revenue > 0 and last_rev > 0 else None

    return ScenarioOutput(
        definition=scenario,
        forecast=forecast,
        wacc_result=scenario_wacc,
        terminal_growth=terminal_growth,
        valuation=valuation,
        revenue_cagr=revenue_cagr,
    )


def run_all_scenarios(
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    company: Company,
    base_assumptions: ForecastAssumptions,
    base_wacc_inputs: WaccInputs,
    base_terminal_growth: float,
    cash_and_investments: float,
    total_debt: float,
    lease_liabilities: float,
    exit_multiple: float | None = None,
) -> dict[str, ScenarioOutput]:
    results = {}
    for scenario in (BEAR_CASE, BASE_CASE, BULL_CASE):
        results[scenario.name] = run_scenario(
            hist,
            summary,
            company,
            base_assumptions,
            base_wacc_inputs,
            base_terminal_growth,
            scenario,
            cash_and_investments,
            total_debt,
            lease_liabilities,
            exit_multiple,
        )
    return results
