"""
End-to-end demo of the Phase 1 vertical slice (spec section 42):

Upload (sample data) -> Normalize -> Historical Analysis -> Forecast -> WACC
-> Terminal Value -> Enterprise Value -> Equity Value -> Scenarios ->
Sensitivity -> Validation -> Excel Export.

Run with:  venv\\Scripts\\python -m backend.run_demo
"""
from __future__ import annotations

import os

from .data.sample_company import build_orion_company, build_orion_historicals
from .data.sample_wacc import build_orion_wacc_inputs
from .engine.forecast import build_default_assumptions, project_financials
from .engine.historical import analyze_historicals
from .engine.scenarios import run_all_scenarios
from .engine.sensitivity import ValuationContext, rank_valuation_drivers, wacc_vs_growth_table
from .engine.valuation import run_dcf_valuation
from .engine.validation import run_validation
from .engine.wacc import calculate_wacc
from .export.excel_export import export_dcf_to_excel


def money(x: float | None) -> str:
    if x is None:
        return "n/a"
    return f"${x:,.1f}M"


def per_share(x: float | None) -> str:
    if x is None:
        return "n/a"
    return f"${x:,.2f}"


def pct(x: float | None) -> str:
    if x is None:
        return "n/a"
    return f"{x:.1%}"


def main() -> None:
    print("=" * 78)
    print("STEP 1-3: Upload & Normalize — Sample Company")
    print("=" * 78)
    company = build_orion_company()
    hist = build_orion_historicals()
    print(f"Company detected: {company.name} ({company.ticker})")
    print(f"Company type: {company.company_type.value.title()}")
    print(f"Currency: {company.currency} ({company.units})")
    print(f"Historical period: {hist.periods[0]}-{hist.periods[-1]}")

    print()
    print("=" * 78)
    print("STEP 5: Historical Analysis")
    print("=" * 78)
    summary = analyze_historicals(hist)
    print(f"Revenue CAGR (5Y): {pct(summary.revenue_cagr_5y)}")
    print(f"Revenue CAGR (3Y): {pct(summary.revenue_cagr_3y)}")
    print(f"Avg EBITDA Margin: {pct(summary.avg_ebitda_margin)}")
    for line in summary.trend_commentary:
        print(f"  - {line}")

    print()
    print("=" * 78)
    print("STEP 6-9: Forecast Assumptions & FCFF")
    print("=" * 78)
    assumptions = build_default_assumptions(hist, summary, forecast_years=5, long_term_growth_rate=0.04)
    forecast = project_financials(hist, assumptions)
    print(f"{'Period':<10}{'Revenue':>12}{'Growth':>10}{'EBITDA':>12}{'EBITDA%':>10}{'EBIT':>12}{'FCFF':>12}")
    for y in forecast.years:
        print(
            f"{y.period:<10}{y.revenue:>12,.1f}{y.revenue_growth:>10.1%}{y.ebitda:>12,.1f}"
            f"{y.ebitda_margin:>10.1%}{y.ebit:>12,.1f}{y.fcff:>12,.1f}"
        )
    print(f"\nRationale ({forecast.years[0].period} revenue growth):")
    print(f"  {assumptions.revenue_growth[0].rationale}")

    print()
    print("=" * 78)
    print("STEP 8: WACC")
    print("=" * 78)
    wacc_inputs = build_orion_wacc_inputs(hist, company.current_share_price, company.diluted_shares_outstanding)
    wacc_result = calculate_wacc(wacc_inputs)
    print(f"Cost of Equity: {pct(wacc_result.cost_of_equity)}")
    print(f"After-Tax Cost of Debt: {pct(wacc_result.after_tax_cost_of_debt)}")
    print(f"Equity Weight / Debt Weight: {pct(wacc_result.equity_weight)} / {pct(wacc_result.debt_weight)}")
    print(f"WACC: {pct(wacc_result.wacc)}")

    print()
    print("=" * 78)
    print("STEP 8-11: Terminal Value, Enterprise Value, Equity Value")
    print("=" * 78)
    terminal_growth = 0.03
    latest_bs = hist.balance_sheets[-1]
    valuation = run_dcf_valuation(
        forecast=forecast,
        wacc_result=wacc_result,
        terminal_growth=terminal_growth,
        company=company,
        cash_and_investments=latest_bs.total_cash_and_investments,
        total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
        exit_multiple=14.0,
    )
    print(f"Terminal Growth: {pct(valuation.terminal_growth)}")
    print(f"Terminal Value (Gordon Growth): {money(valuation.terminal_value_gordon)}")
    print(f"Terminal Value (Exit Multiple, 14.0x EBITDA): {money(valuation.terminal_value_exit_multiple)}")
    print(f"PV of Explicit FCF: {money(valuation.pv_of_explicit_fcf)}")
    print(f"PV of Terminal Value: {money(valuation.pv_of_terminal_value)}")
    print(f"Enterprise Value: {money(valuation.enterprise_value)}")
    print(f"Terminal Value % of EV: {pct(valuation.terminal_value_pct_of_ev)}")
    print(f"Equity Value: {money(valuation.equity_bridge.equity_value)}")
    print(f"Equity Value per Share: {per_share(valuation.equity_bridge.equity_value_per_share)}")
    print(f"Current Share Price: {per_share(valuation.equity_bridge.current_share_price)}")
    print(f"Upside/(Downside): {pct(valuation.equity_bridge.upside_downside)}")

    print()
    print("=" * 78)
    print("STEP 12: Base / Bull / Bear Scenarios")
    print("=" * 78)
    scenarios = run_all_scenarios(
        hist=hist,
        summary=summary,
        company=company,
        base_assumptions=assumptions,
        base_wacc_inputs=wacc_inputs,
        base_terminal_growth=terminal_growth,
        cash_and_investments=latest_bs.total_cash_and_investments,
        total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
        exit_multiple=14.0,
    )
    print(f"{'Scenario':<12}{'Rev CAGR':>10}{'WACC':>8}{'Term g':>8}{'EV':>14}{'Equity/Sh':>12}")
    for name in ["Bear Case", "Base Case", "Bull Case"]:
        s = scenarios[name]
        print(
            f"{s.definition.name:<12}{pct(s.revenue_cagr):>10}{s.wacc_result.wacc:>8.1%}{s.terminal_growth:>8.1%}"
            f"{s.valuation.enterprise_value:>14,.1f}{per_share(s.valuation.equity_bridge.equity_value_per_share):>12}"
        )

    print()
    print("=" * 78)
    print("STEP 13: Sensitivity — WACC vs. Terminal Growth (Enterprise Value)")
    print("=" * 78)
    ctx = ValuationContext(
        cash_and_investments=latest_bs.total_cash_and_investments,
        total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
        exit_multiple=14.0,
    )
    wacc_range = [wacc_result.wacc + d for d in (-0.01, -0.005, 0.0, 0.005, 0.01)]
    growth_range = [terminal_growth + d for d in (-0.01, -0.005, 0.0, 0.005, 0.01)]
    table = wacc_vs_growth_table(hist, assumptions, wacc_result, company, ctx, wacc_range, growth_range)
    header = "WACC\\g  " + "".join(f"{g:>9.1%}" for g in growth_range)
    print(header)
    for w in wacc_range:
        row = f"{w:>7.1%} "
        for g in growth_range:
            cell = table.value_at(w, g)
            v = cell.enterprise_value if cell else float("nan")
            row += f"{v:>9,.0f}" if v == v else f"{'n/a':>9}"
        print(row)

    print()
    print("=" * 78)
    print("STEP 14: Ranked Valuation Drivers")
    print("=" * 78)
    ranking = rank_valuation_drivers(hist, assumptions, wacc_result, terminal_growth, company, ctx)
    for i, d in enumerate(ranking, start=1):
        print(f"{i}. {d.driver_name}: {d.impact_range_pct:.1%} EV swing")

    print()
    print("=" * 78)
    print("Model Integrity Check")
    print("=" * 78)
    integrity = run_validation(hist, summary, forecast, wacc_result, valuation)
    print(integrity.summary)
    for issue in integrity.issues:
        print(f"  [{issue.severity.upper()}] {issue.message}")

    print()
    print("=" * 78)
    print("STEP 15: Excel Export")
    print("=" * 78)
    out_dir = os.path.join(os.path.dirname(__file__), "..", "output")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.abspath(os.path.join(out_dir, "Orion_Cloud_Systems_DCF.xlsx"))
    export_dcf_to_excel(
        out_path, company, hist, summary, forecast, wacc_result, valuation, scenarios, table, ranking, integrity
    )
    print(f"Workbook written to: {out_path}")


if __name__ == "__main__":
    main()
