"""Base / Bull / Bear scenario engine."""
from __future__ import annotations

from pydantic import BaseModel

from .assumption_utils import pin_last_growth, shift_assumption
from .company_profile import CompanyProfile
from .forecast import ForecastAssumptions, ForecastResult, project_financials
from .growth_evidence import GrowthEvidence
from .historical import HistoricalSummary
from .models import Company, HistoricalFinancials
from .valuation import DCFValuationResult, run_dcf_valuation
from .wacc import WaccInputs, WaccResult, calculate_wacc


class ScenarioDefinition(BaseModel):
    name: str
    description: str
    key_drivers: list[str]
    revenue_growth_delta: float = 0.0
    ebitda_margin_delta: float = 0.0
    capex_pct_delta: float = 0.0
    nwc_pct_delta: float = 0.0
    wacc_delta: float = 0.0
    terminal_growth_delta: float = 0.0


class ScenarioOutput(BaseModel):
    definition: ScenarioDefinition
    forecast: ForecastResult
    wacc_result: WaccResult
    terminal_growth: float
    valuation: DCFValuationResult
    revenue_cagr: float | None


BASE_CASE = ScenarioDefinition(
    name="Base Case",
    description="Current operating trajectory using the evidence engine.",
    key_drivers=["Evidence Year-1 growth", "Last-3-year median margins", "Fade to terminal growth"],
)

BULL_CASE = ScenarioDefinition(
    name="Bull Case",
    description="Upside: stronger demand and operating leverage, without raising terminal growth.",
    key_drivers=["Higher near-term volume/demand", "Limited operating leverage", "Unchanged terminal g"],
    revenue_growth_delta=0.025,
    ebitda_margin_delta=0.015,
    wacc_delta=-0.0025,
)

BEAR_CASE = ScenarioDefinition(
    name="Bear Case",
    description="Downside: weaker demand and margin pressure, without changing terminal growth.",
    key_drivers=["Lower near-term growth", "Margin pressure", "Unchanged terminal g"],
    revenue_growth_delta=-0.025,
    ebitda_margin_delta=-0.015,
    capex_pct_delta=0.005,
    wacc_delta=0.005,
)


def scenarios_for(
    profile: CompanyProfile | None = None,
    evidence: GrowthEvidence | None = None,
    summary: HistoricalSummary | None = None,
) -> tuple[ScenarioDefinition, ScenarioDefinition, ScenarioDefinition]:
    """Company-specific operating shocks. Terminal g is not used as a valuation dial."""
    year1 = evidence.year1 if evidence else 0.10
    template = profile.template.value if profile else "other"
    peak = max((y.ebitda_margin for y in summary.years), default=0.0) if summary else 0.0
    median_m = summary.median_ebitda_margin_3y if summary else 0.0
    headroom = max(0.0, peak - median_m)

    bull_g = min(0.04, max(0.01, 0.25 * abs(year1)))
    bear_g = -min(0.05, max(0.015, 0.35 * abs(year1)))
    bull_m = min(0.02, headroom if headroom > 0 else 0.01)
    bear_m = -0.02

    if template in {"manufacturing", "asset_heavy", "cyclical"}:
        bull_capex, bear_capex = 0.01, 0.005
        bear_wacc = 0.01 if template == "cyclical" else 0.005
        if template == "cyclical" and summary is not None:
            from .cyclical import normalize_cyclical_margins

            cyc = normalize_cyclical_margins(summary)
            base_m = cyc.normalized_ebitda_margin
            bull_m = max(0.005, (cyc.p75_ebitda or base_m) - base_m)
            bear_m = min(-0.005, (cyc.p25_ebitda or base_m) - base_m)
            bull_g = 0.02
            bear_g = -0.03
            bull_desc = (
                f"Upper-quartile historical EBITDA ({(cyc.p75_ebitda or base_m):.1%}) with modest volume growth. "
                "Not a peak-margin case and not a mechanical +1.5pp."
            )
            bear_desc = (
                f"Lower-quartile historical EBITDA ({(cyc.p25_ebitda or base_m):.1%}) and weaker volume. "
                "Terminal growth unchanged."
            )
            bull_drivers = ["Mid-to-upper cycle utilization", "Volume", "Not peak-year margins"]
            bear_drivers = ["Lower-quartile cycle margins", "Volume decline", "WACC + cyclical risk"]
        else:
            bull_desc = (
                "Stronger volume and utilization; capex rises because growth still consumes capital. "
                "Peak margins are an upside, not the base."
            )
            bear_desc = "Weaker volume, margin pressure, and higher capital intensity. Terminal growth unchanged."
            bull_drivers = ["Volume / utilization", "Operating leverage up to historical peak headroom", "Higher growth capex"]
            bear_drivers = ["Volume decline", "Margin compression", "WACC + cyclical risk"]
    elif template in {"it_services", "asset_light"}:
        bull_capex, bear_capex = 0.0, 0.0
        bear_wacc = 0.0025
        bull_desc = "Stronger client/volume growth and modest operating leverage. Capex stays maintenance-like."
        bear_desc = "Pricing or utilization pressure and slower client growth. Terminal g unchanged."
        bull_drivers = ["Client / volume growth", "Utilization / operating leverage"]
        bear_drivers = ["Pricing / utilization pressure", "Slower demand"]
    elif template == "consumer":
        bull_capex, bear_capex = 0.0, 0.0
        bear_wacc = 0.005
        bull_desc = "Better volume and mix. Peak historical margin is the bull ceiling, not the base."
        bear_desc = "Volume slowdown and mix/margin pressure. Terminal g unchanged."
        bull_drivers = ["Volume / mix", "Limited operating leverage"]
        bear_drivers = ["Volume slowdown", "Margin pressure"]
    else:
        bull_capex, bear_capex = 0.0, 0.005
        bear_wacc = 0.005
        bull_desc = "Stronger near-term demand and modest margin expansion toward historical peak headroom."
        bear_desc = "Weaker demand and margin pressure. Terminal g unchanged."
        bull_drivers = ["Near-term demand", "Operating leverage"]
        bear_drivers = ["Demand", "Margins"]

    if evidence and evidence.regime.value == "declining":
        bull_g = min(0.03, abs(year1) * 0.5)
        bear_g = min(-0.02, year1 - 0.02)
        bull_desc = "Less-negative or stabilizing growth versus the declining base. Not a mechanical +2pp."
        bear_desc = "Deeper decline and margin pressure. Terminal g still not raised."

    bull = ScenarioDefinition(
        name="Bull Case",
        description=bull_desc,
        key_drivers=bull_drivers,
        revenue_growth_delta=bull_g,
        ebitda_margin_delta=bull_m,
        capex_pct_delta=bull_capex,
        wacc_delta=-0.0025,
    )
    bear = ScenarioDefinition(
        name="Bear Case",
        description=bear_desc,
        key_drivers=bear_drivers,
        revenue_growth_delta=bear_g,
        ebitda_margin_delta=bear_m,
        capex_pct_delta=bear_capex,
        wacc_delta=bear_wacc,
    )
    base = BASE_CASE
    if template == "cyclical":
        base = ScenarioDefinition(
            name="Base Case",
            description="Mid-cycle operating environment: normalized EBITDA, volume-aware growth fade, Gordon g unchanged.",
            key_drivers=["Mid-cycle margins", "Normalized volume growth", "Fade to terminal g"],
        )
    return bear, base, bull


def apply_scenario_to_assumptions(
    base_assumptions: ForecastAssumptions,
    scenario: ScenarioDefinition,
    terminal_growth: float | None = None,
) -> ForecastAssumptions:
    clone = base_assumptions.model_copy(deep=True)
    clone.revenue_growth = [
        shift_assumption(a, scenario.revenue_growth_delta, scenario.name) for a in clone.revenue_growth
    ]
    fade_to = terminal_growth if terminal_growth is not None else clone.fade_target
    pin_last_growth(
        clone.revenue_growth,
        fade_to,
        f"{scenario.name}: last explicit year stays at terminal growth {fade_to:.1%}; shocks apply to the explicit period, not perpetuity.",
    )
    clone.fade_target = fade_to
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
    cash_status: str = "reported",
    minority_interest_status: str = "reported",
    debt_status: str = "reported",
    shares_status: str = "reported",
    bridge_complete: bool = True,
    block_reason: str | None = None,
    non_operating_investments: float = 0.0,
) -> ScenarioOutput:
    scenario_assumptions = apply_scenario_to_assumptions(
        base_assumptions, scenario, terminal_growth=base_terminal_growth + scenario.terminal_growth_delta
    )
    forecast = project_financials(hist, scenario_assumptions)

    wacc_inputs = base_wacc_inputs.model_copy(deep=True)
    wacc_inputs.beta = wacc_inputs.beta.model_copy()
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
        cash_status=cash_status,
        minority_interest_status=minority_interest_status,
        debt_status=debt_status,
        shares_status=shares_status,
        bridge_complete=bridge_complete,
        block_reason=block_reason,
        non_operating_investments=non_operating_investments,
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
    profile: CompanyProfile | None = None,
    evidence: GrowthEvidence | None = None,
    cash_status: str = "reported",
    minority_interest_status: str = "reported",
    debt_status: str = "reported",
    shares_status: str = "reported",
    bridge_complete: bool = True,
    block_reason: str | None = None,
    non_operating_investments: float = 0.0,
) -> dict[str, ScenarioOutput]:
    results = {}
    for scenario in scenarios_for(profile, evidence, summary):
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
            cash_status=cash_status,
            minority_interest_status=minority_interest_status,
            debt_status=debt_status,
            shares_status=shares_status,
            bridge_complete=bridge_complete,
            block_reason=block_reason,
            non_operating_investments=non_operating_investments,
        )
    return results
