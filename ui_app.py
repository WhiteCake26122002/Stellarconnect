"""
Basic UI for the DCF Valuation Platform - Phase 1 vertical slice.

This is a deliberately minimal Streamlit front end so a non-technical user
can exercise the calculation engine (change assumptions, see the model
recalculate, download the Excel workbook) without touching Python. It is
NOT the final UI described in the spec (Next.js/React) - it exists purely
to validate that the underlying engine and workflow behave correctly.

Run with:
    venv\\Scripts\\streamlit run ui_app.py
"""
from __future__ import annotations

import io
import os
import tempfile

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import ui_theme
from backend.engine.assumption_utils import shift_assumption
from backend.engine.cost_of_debt import estimate_pretax_cost_of_debt
from backend.engine.forecast import build_default_assumptions, project_financials
from backend.engine.historical import analyze_historicals
from backend.engine.models import AssumptionSource, CompanyType
from backend.engine.scenarios import run_all_scenarios
from backend.engine.sensitivity import ValuationContext, rank_valuation_drivers, wacc_vs_growth_table
from backend.engine.valuation import run_dcf_valuation
from backend.engine.validation import run_validation
from backend.engine.wacc import calculate_wacc
from backend.export.excel_export import export_dcf_to_excel
from backend.export.pdf_report import generate_investment_report
from ui_forms import build_wacc_inputs_for_company, render_custom_company_form, render_live_company_form

st.set_page_config(page_title="DCF Valuation Platform", layout="wide", page_icon="📈")
ui_theme.inject_css()

st.sidebar.title("Mode")
app_mode = st.sidebar.radio(
    "Choose a tool", ["DCF Valuation", "📈 Paper Trading", "🏦 Mutual Funds"], index=0, key="app_mode",
)
if app_mode.startswith("📈"):
    import ui_trading

    ui_trading.render()
    st.stop()
if app_mode.startswith("🏦"):
    import ui_mutual_funds

    ui_mutual_funds.render()
    st.stop()

SOURCE_COLORS = {
    AssumptionSource.HISTORICAL_ACTUAL: "#DBEAFE",
    AssumptionSource.COMPANY_GUIDANCE: "#DCFCE7",
    AssumptionSource.ANALYST_CONSENSUS: "#EDE9FE",
    AssumptionSource.MARKET_DATA: "#EDE9FE",
    AssumptionSource.INDUSTRY_BENCHMARK: "#EDE9FE",
    AssumptionSource.USER_ASSUMPTION: "#FEF9C3",
    AssumptionSource.CALCULATED: "#F3F4F6",
}


CURRENCY_SYMBOLS = {"USD": "$", "INR": "₹", "EUR": "€", "GBP": "£", "JPY": "¥", "CNY": "¥"}


def currency_symbol(currency_code: str) -> str:
    return CURRENCY_SYMBOLS.get((currency_code or "USD").upper(), (currency_code or "USD").upper() + " ")


def money(x, suffix="M"):
    if x is None:
        return "n/a"
    return f"{CURRENCY_SYMBOL}{round(x):,}{suffix}"


def per_share_fmt(x):
    if x is None:
        return "n/a"
    return f"{CURRENCY_SYMBOL}{x:,.2f}"


def r0(x):
    """Round a monetary (millions-scale) value to the nearest whole unit for display."""
    return None if x is None else round(x)


def pct(x):
    if x is None:
        return "n/a"
    return f"{x:.1%}"


# ------------------------------------------------------------- Data source --
st.sidebar.title("Data Source")
data_source = st.sidebar.radio(
    "Company",
    ["Search Live Company (Yahoo Finance)", "Enter My Own Company"],
    index=0,
)

sector_match = None
country_risk = None

if data_source.startswith("Search"):
    company, hist, sector_match, country_risk = render_live_company_form()
    if company is None or hist is None:
        st.stop()
else:
    company, hist = render_custom_company_form()
    if company is None or hist is None:
        st.stop()
    st.success(f"Using your entered data for **{company.name}** — scroll down or check the sidebar to run the valuation.")

summary = analyze_historicals(hist)
CURRENCY_SYMBOL = currency_symbol(company.currency)

# ---------------------------------------------------------------- Sidebar --
st.sidebar.title("DCF Assumptions")
st.sidebar.caption(f"{company.name} ({company.ticker or 'n/a'}) — {company.company_type.value.title()} company")

_widget_scope = f"{data_source}:{company.ticker or company.name}"  # widgets reset to fresh defaults when the company changes

st.sidebar.subheader("Forecast Horizon")
forecast_years = st.sidebar.selectbox("Explicit forecast period", [3, 5, 7, 10], index=1, key=f"fy_{_widget_scope}")

st.sidebar.subheader("Revenue & Margin")
long_term_growth = st.sidebar.slider(
    "Long-term revenue growth (terminal glide target)", 0.0, 15.0, 4.0, 0.5, format="%.1f%%", key=f"ltg_{_widget_scope}"
) / 100
default_margin_pct = min(60.0, max(5.0, float(max(y.ebitda_margin for y in summary.years)) * 100))
target_ebitda_margin = st.sidebar.slider(
    "Target EBITDA margin (by final forecast year)", 5.0, 60.0, default_margin_pct, 0.5, format="%.1f%%",
    key=f"margin_{_widget_scope}",
) / 100

st.sidebar.subheader("WACC Inputs")
_beta_default = min(3.0, max(0.3, sector_match.levered_beta)) if sector_match else 1.15
_erp_default = min(15.0, max(0.0, country_risk.total_equity_risk_premium * 100)) if country_risk else 5.5
if sector_match:
    st.sidebar.caption(f"Beta default sourced from Damodaran India sector data ({sector_match.matched_industry}).")
if country_risk:
    st.sidebar.caption(f"ERP default sourced from Damodaran country risk data ({country_risk.country}).")

risk_free_rate = st.sidebar.slider("Risk-free rate", 0.0, 15.0, 4.2, 0.1, format="%.1f%%", key=f"rf_{_widget_scope}") / 100
beta = st.sidebar.number_input("Beta", 0.3, 3.0, _beta_default, 0.01, key=f"beta_{_widget_scope}")
equity_risk_premium = st.sidebar.slider("Equity risk premium", 0.0, 15.0, _erp_default, 0.1, format="%.1f%%", key=f"erp_{_widget_scope}") / 100

_kd_estimate = estimate_pretax_cost_of_debt(
    risk_free_rate, hist.income_statements[-1].ebit, hist.income_statements[-1].interest_expense,
    hist.income_statements[-1].period,
)
_kd_default = min(20.0, max(0.0, _kd_estimate.pretax_cost_of_debt * 100))
if _kd_estimate.interest_coverage_ratio is not None:
    st.sidebar.caption(
        f"Cost of debt default: synthetic **{_kd_estimate.synthetic_rating}** rating from "
        f"{_kd_estimate.interest_coverage_ratio:.1f}x interest coverage (EBIT/Interest, Damodaran spread table) "
        f"+ risk-free rate — override if you know the company's actual borrowing rate."
    )
else:
    st.sidebar.caption("Cost of debt default: negligible interest expense reported, defaulted to the safest spread tier.")
pretax_cost_of_debt = st.sidebar.slider("Pre-tax cost of debt", 0.0, 20.0, _kd_default, 0.1, format="%.1f%%", key=f"kd_{_widget_scope}") / 100
if company.company_type == CompanyType.PRIVATE and "custom_target_equity_weight" not in st.session_state:
    st.session_state["custom_target_equity_weight"] = 0.70

st.sidebar.subheader("Terminal Value")
terminal_growth = st.sidebar.slider(
    "Terminal growth rate (g)", 0.0, 6.0, 3.0, 0.1, format="%.1f%%", key=f"tg_{_widget_scope}"
) / 100
exit_multiple = st.sidebar.number_input(
    "Exit multiple (x EBITDA, cross-check)", 1.0, 40.0, 14.0, 0.5, key=f"exit_mult_{_widget_scope}"
)

st.sidebar.caption("Any change above triggers a full model recalculation — nothing is cached across assumptions.")

# ------------------------------------------------------------ Base model --
base_assumptions = build_default_assumptions(
    hist, summary, forecast_years=forecast_years, long_term_growth_rate=long_term_growth,
    target_ebitda_margin=target_ebitda_margin,
)

st.title("DCF Valuation & Financial Analysis")
st.caption(
    f"Company type: **{company.company_type.value.title()}** | Currency: **{company.currency} ({company.units})** | "
    f"Historical period: **{hist.periods[0]}-{hist.periods[-1]}**"
)

tabs = st.tabs(
    [
        "📊 Dashboard", "📄 Financials", "📈 Historical Analysis", "🔮 Forecast", "💰 DCF",
        "🎭 Scenarios", "🎛️ Sensitivity", "📋 Assumptions", "✅ Model Quality", "⬇️ Export",
    ]
)

# ---------------------------------------------------- Per-year overrides --
with tabs[3]:
    st.subheader("Forecast Assumption Overrides")
    st.caption("Edit any cell below to override that year's assumption. The entire model recalculates immediately.")
    override_df = pd.DataFrame(
        {
            "Period": base_assumptions.forecast_years,
            "Revenue Growth %": [a.effective_value * 100 for a in base_assumptions.revenue_growth],
            "Capex % of Revenue": [a.effective_value * 100 for a in base_assumptions.capex_pct_revenue],
            "NWC % of Revenue": [a.effective_value * 100 for a in base_assumptions.nwc_pct_revenue],
            "Tax Rate %": [a.effective_value * 100 for a in base_assumptions.tax_rate],
        }
    )
    edited_df = st.data_editor(
        override_df, use_container_width=True, hide_index=True,
        key=f"override_editor_{_widget_scope}_{forecast_years}_{long_term_growth}_{target_ebitda_margin}",
    )

assumptions = base_assumptions.model_copy(deep=True)
for i, row in edited_df.iterrows():
    assumptions.revenue_growth[i] = assumptions.revenue_growth[i].overridden(row["Revenue Growth %"] / 100)
    assumptions.capex_pct_revenue[i] = assumptions.capex_pct_revenue[i].overridden(row["Capex % of Revenue"] / 100)
    assumptions.nwc_pct_revenue[i] = assumptions.nwc_pct_revenue[i].overridden(row["NWC % of Revenue"] / 100)
    assumptions.tax_rate[i] = assumptions.tax_rate[i].overridden(row["Tax Rate %"] / 100)

forecast = project_financials(hist, assumptions)

wacc_inputs = build_wacc_inputs_for_company(hist, summary, company, risk_free_rate, beta, equity_risk_premium, pretax_cost_of_debt, kd_estimate=_kd_estimate)
wacc_result = calculate_wacc(wacc_inputs)

latest_bs = hist.balance_sheets[-1]

valuation_error = None
valuation = None
if wacc_result.wacc <= terminal_growth:
    valuation_error = (
        f"WACC ({pct(wacc_result.wacc)}) must exceed terminal growth ({pct(terminal_growth)}). "
        "Lower terminal growth or raise WACC in the sidebar to compute a valuation."
    )
else:
    valuation = run_dcf_valuation(
        forecast=forecast, wacc_result=wacc_result, terminal_growth=terminal_growth, company=company,
        cash_and_investments=latest_bs.total_cash_and_investments, total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities, exit_multiple=exit_multiple,
    )

# --------------------------------------------------------------- Dashboard
with tabs[0]:
    if valuation_error:
        st.error(valuation_error)
    else:
        if valuation.equity_bridge.equity_value < 0:
            st.error(
                "Equity Value is negative — Enterprise Value plus cash does not cover debt, lease liabilities, "
                "minority interest, and preferred stock combined. See the Model Quality tab for details before "
                "trusting the implied share price below."
            )

        with st.container(border=True):
            c1, c2, c3, c4, c5 = st.columns(5)
            c1.metric("Enterprise Value", money(valuation.enterprise_value))
            c2.metric("Equity Value", money(valuation.equity_bridge.equity_value))
            c3.metric("Implied Share Price", per_share_fmt(valuation.equity_bridge.equity_value_per_share))
            c4.metric("Current Share Price", per_share_fmt(valuation.equity_bridge.current_share_price))
            upside = valuation.equity_bridge.upside_downside
            c5.metric("Upside / (Downside)", pct(upside))

            c6, c7, c8, c9 = st.columns(4)
            c6.metric("WACC", pct(wacc_result.wacc))
            c7.metric("Terminal Growth", pct(terminal_growth))
            c8.metric("Terminal EBITDA Margin", pct(forecast.years[-1].ebitda_margin))
            c9.metric("Terminal Value % of EV", pct(valuation.terminal_value_pct_of_ev))
        if valuation.terminal_value_pct_of_ev > 0.90:
            st.warning(f"Terminal value represents {pct(valuation.terminal_value_pct_of_ev)} of Enterprise Value — unusually high; the explicit forecast is contributing almost nothing to the valuation. Consider a longer forecast horizon or double-checking WACC and terminal growth.")

        st.write("")
        scenarios = run_all_scenarios(
            hist=hist, summary=summary, company=company, base_assumptions=assumptions,
            base_wacc_inputs=wacc_inputs, base_terminal_growth=terminal_growth,
            cash_and_investments=latest_bs.total_cash_and_investments, total_debt=latest_bs.total_debt,
            lease_liabilities=latest_bs.lease_liabilities, exit_multiple=exit_multiple,
        )

        col_a, col_b = st.columns(2)

        with col_a:
            with st.container(border=True):
                st.subheader("Historical vs. Forecast Revenue")
                fig = go.Figure()
                fig.add_bar(x=hist.periods, y=[i.revenue for i in hist.income_statements], name="Historical", marker_color=ui_theme.HISTORICAL)
                fig.add_bar(x=[y.period for y in forecast.years], y=[y.revenue for y in forecast.years], name="Forecast", marker_color=ui_theme.FORECAST)
                fig.add_vline(x=len(hist.periods) - 0.5, line_dash="dot", line_color=ui_theme.MUTED)
                ui_theme.base_layout(fig, yaxis_title=f"Revenue ({CURRENCY_SYMBOL}M)", bargap=0.25)
                st.plotly_chart(fig, use_container_width=True)

        with col_b:
            with st.container(border=True):
                st.subheader("Intrinsic Value vs. Price")
                scenario_pick = st.segmented_control(
                    "Scenario", ["Bear Case", "Base Case", "Bull Case"], default="Base Case",
                    key=f"scenario_pick_{_widget_scope}", label_visibility="collapsed",
                )
                if not scenario_pick:
                    scenario_pick = "Base Case"
                picked_price = scenarios[scenario_pick].valuation.equity_bridge.equity_value_per_share
                st.markdown(
                    ui_theme.intrinsic_value_card(
                        company.ticker or company.name, company.name, picked_price,
                        valuation.equity_bridge.current_share_price, CURRENCY_SYMBOL,
                        website=company.website,
                    ),
                    unsafe_allow_html=True,
                )

# --------------------------------------------------------------- Financials
with tabs[1]:
    st.subheader("Historical Income Statement")
    is_df = pd.DataFrame(
        {
            "Period": hist.periods,
            "Revenue": [r0(i.revenue) for i in hist.income_statements],
            "Gross Profit": [r0(i.gross_profit) for i in hist.income_statements],
            "Gross Margin": [f"{i.gross_margin:.1%}" for i in hist.income_statements],
            "EBITDA": [r0(i.ebitda) for i in hist.income_statements],
            "EBITDA Margin": [f"{i.ebitda_margin:.1%}" for i in hist.income_statements],
            "EBIT": [r0(i.ebit) for i in hist.income_statements],
            "Net Income": [r0(i.net_income) for i in hist.income_statements],
        }
    ).set_index("Period").T
    st.dataframe(is_df, use_container_width=True)

    st.subheader("Historical Balance Sheet")
    bs_df = pd.DataFrame(
        {
            "Period": hist.periods,
            "Cash & Investments": [r0(b.total_cash_and_investments) for b in hist.balance_sheets],
            "Total Assets": [r0(b.total_assets) for b in hist.balance_sheets],
            "Total Debt": [r0(b.total_debt) for b in hist.balance_sheets],
            "Total Liabilities": [r0(b.total_liabilities) for b in hist.balance_sheets],
            "Shareholders' Equity": [r0(b.shareholders_equity) for b in hist.balance_sheets],
            "Net Working Capital": [r0(b.net_working_capital) for b in hist.balance_sheets],
        }
    ).set_index("Period").T
    st.dataframe(bs_df, use_container_width=True)

    st.subheader("Historical Cash Flow Statement")
    cf_df = pd.DataFrame(
        {
            "Period": hist.periods,
            "CFO": [r0(c.cfo) for c in hist.cash_flows],
            "Capex": [r0(-c.capex) for c in hist.cash_flows],
            "CFI": [r0(c.cfi) for c in hist.cash_flows],
            "CFF": [r0(c.cff) for c in hist.cash_flows],
            "Net Change in Cash": [r0(c.net_change_in_cash) for c in hist.cash_flows],
        }
    ).set_index("Period").T
    st.dataframe(cf_df, use_container_width=True)

# --------------------------------------------------------- Historical Analysis
with tabs[2]:
    st.subheader("Key Trends")
    c1, c2, c3 = st.columns(3)
    c1.metric("Revenue CAGR (5Y)", pct(summary.revenue_cagr_5y))
    c2.metric("Revenue CAGR (3Y)", pct(summary.revenue_cagr_3y))
    c3.metric("Avg EBITDA Margin", pct(summary.avg_ebitda_margin))

    hist_df = pd.DataFrame(
        {
            "Period": [y.period for y in summary.years],
            "Revenue Growth": [pct(y.revenue_growth) for y in summary.years],
            "Gross Margin": [pct(y.gross_margin) for y in summary.years],
            "EBITDA Margin": [pct(y.ebitda_margin) for y in summary.years],
            "EBIT Margin": [pct(y.ebit_margin) for y in summary.years],
            "Net Margin": [pct(y.net_margin) for y in summary.years],
            "Capex % Rev": [pct(y.capex_pct_revenue) for y in summary.years],
            "FCF Margin": [pct(y.fcf_margin) for y in summary.years],
        }
    ).set_index("Period").T
    st.dataframe(hist_df, use_container_width=True)

    st.subheader("Automated Trend Commentary")
    for line in summary.trend_commentary:
        st.write(f"- {line}")

# --------------------------------------------------------------- Forecast
with tabs[3]:
    st.subheader("Revenue, Margin & FCFF Forecast")
    fc_df = pd.DataFrame(
        {
            "Period": [y.period for y in forecast.years],
            "Revenue": [r0(y.revenue) for y in forecast.years],
            "Growth": [pct(y.revenue_growth) for y in forecast.years],
            "EBITDA": [r0(y.ebitda) for y in forecast.years],
            "EBITDA Margin": [pct(y.ebitda_margin) for y in forecast.years],
            "EBIT": [r0(y.ebit) for y in forecast.years],
            "NOPAT": [r0(y.nopat) for y in forecast.years],
            "Capex": [r0(y.capex) for y in forecast.years],
            "Chg in NWC": [r0(y.change_in_nwc) for y in forecast.years],
            "FCFF": [r0(y.fcff) for y in forecast.years],
        }
    ).set_index("Period").T
    st.dataframe(fc_df, use_container_width=True)

    st.subheader("FCFF Build")
    fcff_vals = [y.fcff for y in forecast.years]
    fig3 = go.Figure(go.Bar(
        x=[y.period for y in forecast.years], y=fcff_vals,
        marker_color=[ui_theme.BULL if v >= 0 else ui_theme.BEAR for v in fcff_vals],
    ))
    ui_theme.base_layout(fig3, height=300, yaxis_title=f"Unlevered FCF ({CURRENCY_SYMBOL}M)")
    st.plotly_chart(fig3, use_container_width=True)

    st.info(base_assumptions.revenue_growth[0].rationale)

# --------------------------------------------------------------------- DCF
with tabs[4]:
    if valuation_error:
        st.error(valuation_error)
    else:
        st.subheader("WACC Build")
        w1, w2, w3 = st.columns(3)
        w1.metric("Cost of Equity", pct(wacc_result.cost_of_equity))
        w2.metric("After-Tax Cost of Debt", pct(wacc_result.after_tax_cost_of_debt))
        w3.metric("WACC", pct(wacc_result.wacc))
        st.caption(f"Equity weight {pct(wacc_result.equity_weight)} / Debt weight {pct(wacc_result.debt_weight)}")

        st.subheader("Discounted Cash Flows")
        dcf_df = pd.DataFrame(
            {
                "Period": [d.period for d in valuation.discounted_years],
                "FCFF": [r0(d.fcff) for d in valuation.discounted_years],
                "Discount Factor": [round(d.discount_factor, 3) for d in valuation.discounted_years],
                "Present Value": [r0(d.present_value) for d in valuation.discounted_years],
            }
        )
        st.dataframe(dcf_df, use_container_width=True, hide_index=True)

        st.subheader("Terminal Value")
        t1, t2 = st.columns(2)
        t1.metric("Gordon Growth Method", money(valuation.terminal_value_gordon))
        t2.metric("Exit Multiple Method (cross-check)", money(valuation.terminal_value_exit_multiple))

        st.subheader("Enterprise Value → Equity Value Bridge")
        bridge_rows = [
            ("PV of Explicit FCF", r0(valuation.pv_of_explicit_fcf)),
            ("+ PV of Terminal Value", r0(valuation.pv_of_terminal_value)),
            ("= Enterprise Value", r0(valuation.enterprise_value)),
            ("+ Cash & Investments", r0(valuation.equity_bridge.plus_cash_and_investments)),
            ("- Total Debt", r0(-valuation.equity_bridge.less_total_debt)),
            ("- Lease Liabilities", r0(-valuation.equity_bridge.less_lease_liabilities)),
            ("- Minority Interest", r0(-valuation.equity_bridge.less_minority_interest)),
            ("- Preferred Stock", r0(-valuation.equity_bridge.less_preferred_stock)),
            ("= Equity Value", r0(valuation.equity_bridge.equity_value)),
        ]
        st.dataframe(pd.DataFrame(bridge_rows, columns=["Line Item", f"Value ({CURRENCY_SYMBOL}M)"]), use_container_width=True, hide_index=True)

# ----------------------------------------------------------------- Scenarios
with tabs[5]:
    if valuation_error:
        st.error(valuation_error)
    else:
        st.subheader("Bear / Base / Bull Scenarios")
        sc_df = pd.DataFrame(
            {
                "Metric": ["Revenue CAGR", "Terminal EBITDA Margin", "WACC", "Terminal Growth", "Enterprise Value", "Equity Value", "Implied Share Price"],
                "Bear Case": [
                    pct(scenarios["Bear Case"].revenue_cagr), pct(scenarios["Bear Case"].forecast.years[-1].ebitda_margin),
                    pct(scenarios["Bear Case"].wacc_result.wacc), pct(scenarios["Bear Case"].terminal_growth),
                    money(scenarios["Bear Case"].valuation.enterprise_value), money(scenarios["Bear Case"].valuation.equity_bridge.equity_value),
                    per_share_fmt(scenarios["Bear Case"].valuation.equity_bridge.equity_value_per_share),
                ],
                "Base Case": [
                    pct(scenarios["Base Case"].revenue_cagr), pct(scenarios["Base Case"].forecast.years[-1].ebitda_margin),
                    pct(scenarios["Base Case"].wacc_result.wacc), pct(scenarios["Base Case"].terminal_growth),
                    money(scenarios["Base Case"].valuation.enterprise_value), money(scenarios["Base Case"].valuation.equity_bridge.equity_value),
                    per_share_fmt(scenarios["Base Case"].valuation.equity_bridge.equity_value_per_share),
                ],
                "Bull Case": [
                    pct(scenarios["Bull Case"].revenue_cagr), pct(scenarios["Bull Case"].forecast.years[-1].ebitda_margin),
                    pct(scenarios["Bull Case"].wacc_result.wacc), pct(scenarios["Bull Case"].terminal_growth),
                    money(scenarios["Bull Case"].valuation.enterprise_value), money(scenarios["Bull Case"].valuation.equity_bridge.equity_value),
                    per_share_fmt(scenarios["Bull Case"].valuation.equity_bridge.equity_value_per_share),
                ],
            }
        )
        st.dataframe(sc_df, use_container_width=True, hide_index=True)

        st.subheader("Key Drivers by Scenario")
        for name in ["Bear Case", "Base Case", "Bull Case"]:
            with st.expander(name):
                st.write(scenarios[name].definition.description)
                for driver in scenarios[name].definition.key_drivers:
                    st.write(f"- {driver}")

# --------------------------------------------------------------- Sensitivity
with tabs[6]:
    if valuation_error:
        st.error(valuation_error)
    else:
        st.subheader("Intrinsic Value: WACC vs. Terminal Growth")
        ctx = ValuationContext(
            cash_and_investments=latest_bs.total_cash_and_investments, total_debt=latest_bs.total_debt,
            lease_liabilities=latest_bs.lease_liabilities, exit_multiple=exit_multiple,
        )
        wacc_range = [wacc_result.wacc + d for d in (-0.02, -0.01, 0.0, 0.01, 0.02)]
        growth_range = [terminal_growth + d for d in (-0.01, -0.005, 0.0, 0.005, 0.01)]
        table = wacc_vs_growth_table(hist, assumptions, wacc_result, company, ctx, wacc_range, growth_range)

        grid = [[table.value_at(w, g).equity_value_per_share for g in growth_range] for w in wacc_range]
        wacc_labels = [f"{w:.1%}" for w in wacc_range]
        growth_labels = [f"{g:.1%}" for g in growth_range]
        heat_fig = go.Figure(
            data=go.Heatmap(
                z=grid, x=growth_labels, y=wacc_labels, colorscale="RdYlGn",
                zmid=valuation.equity_bridge.current_share_price,
                text=[[f"{CURRENCY_SYMBOL}{v:,.2f}" if v is not None else "n/a" for v in row] for row in grid], texttemplate="%{text}",
                hovertemplate=f"WACC %{{y}}, g %{{x}}<br>Intrinsic Value {CURRENCY_SYMBOL}" + "%{z:,.2f}<extra></extra>",
            )
        )
        if valuation.equity_bridge.current_share_price:
            heat_fig.add_annotation(
                text=f"Current price: {CURRENCY_SYMBOL}{valuation.equity_bridge.current_share_price:,.2f}",
                xref="paper", yref="paper", x=0, y=1.08, showarrow=False, font=dict(size=12, color=ui_theme.MUTED),
            )
        ui_theme.base_layout(heat_fig, height=350, xaxis_title="Terminal Growth (g)", yaxis_title="WACC")
        st.plotly_chart(heat_fig, use_container_width=True)
        st.caption(
            "Values = intrinsic value per share. Green cells imply the stock is undervalued at that "
            f"WACC/growth combination (above the current price of {per_share_fmt(valuation.equity_bridge.current_share_price)}); "
            "red cells imply overvalued."
        )

        st.subheader("Ranked Valuation Drivers")
        ranking = rank_valuation_drivers(hist, assumptions, wacc_result, terminal_growth, company, ctx)
        rank_df = pd.DataFrame([(d.driver_name, d.impact_range_pct) for d in ranking], columns=["Driver", "EV Swing %"])
        fig4 = go.Figure(go.Bar(x=rank_df["EV Swing %"], y=rank_df["Driver"], orientation="h", marker_color=ui_theme.ACCENT))
        fig4.update_layout(yaxis=dict(autorange="reversed"))
        ui_theme.base_layout(fig4, height=350, xaxis_tickformat=".0%")
        st.plotly_chart(fig4, use_container_width=True)

# -------------------------------------------------------------- Assumptions
with tabs[7]:
    st.subheader("All Forecast Assumptions")
    st.caption("Yellow = user override | Gray = model-calculated | Blue/Green/Purple = historical/guidance/market data")
    a = assumptions
    all_a = a.revenue_growth + a.gross_margin + a.rnd_pct_revenue + a.sm_pct_revenue + a.ga_pct_revenue + a.da_pct_revenue + a.capex_pct_revenue + a.nwc_pct_revenue + a.tax_rate
    assum_df = pd.DataFrame(
        [
            {
                "Assumption": x.name, "Period": x.period, "Value": f"{x.effective_value:.1%}",
                "Source": x.source.value, "Confidence": x.confidence.value, "Rationale": x.rationale,
            }
            for x in all_a
        ]
    )
    st.dataframe(assum_df, use_container_width=True, hide_index=True, height=500)

    st.subheader("WACC Assumptions")

    def _fmt_wacc_assumption(x):
        if x.unit == "%":
            return f"{x.effective_value:.1%}"
        if x.unit == "x":
            return f"{x.effective_value:.2f}x"
        if x.unit == "currency":
            return money(x.effective_value)
        return f"{x.effective_value:,.2f}"

    wacc_a = [wacc_inputs.risk_free_rate, wacc_inputs.beta, wacc_inputs.equity_risk_premium, wacc_inputs.pretax_cost_of_debt, wacc_inputs.tax_rate, wacc_inputs.market_value_of_equity, wacc_inputs.market_value_of_debt]
    wacc_a_df = pd.DataFrame(
        [{"Assumption": x.name, "Value": _fmt_wacc_assumption(x), "Source": x.source.value, "Confidence": x.confidence.value, "Rationale": x.rationale} for x in wacc_a]
    )
    st.dataframe(wacc_a_df, use_container_width=True, hide_index=True)

# ------------------------------------------------------------- Model Quality
with tabs[8]:
    if valuation_error:
        st.error(valuation_error)
    else:
        integrity = run_validation(hist, summary, forecast, wacc_result, valuation)
        st.metric("Model Integrity Score", integrity.summary)
        for issue in integrity.issues:
            if issue.severity == "error":
                st.error(issue.message)
            elif issue.severity == "warning":
                st.warning(issue.message)
            else:
                st.info(issue.message)
        if not integrity.issues:
            st.success("No data-quality issues detected.")

# ------------------------------------------------------------------- Export
with tabs[9]:
    st.subheader("Export")
    if valuation_error:
        st.error(valuation_error)
    else:
        import os

        os.makedirs("output", exist_ok=True)
        file_stub = (company.ticker or company.name).replace(" ", "_").replace(".", "_")

        col_xlsx, col_pdf = st.columns(2)

        with col_xlsx:
            st.markdown("**Excel Workbook**")
            st.caption("15 sheets, fully formula-driven: Exec Summary, Historical IS/BS/CF, Historical Analysis, WACC, Forecast & FCFF and DCF for Base/Bear/Bull, Scenario Summary, Sensitivity, Sources & Notes. Edit any yellow input cell in Excel and the model recalculates.")
            if st.button("Generate Excel Workbook"):
                integrity = run_validation(hist, summary, forecast, wacc_result, valuation)
                ctx = ValuationContext(
                    cash_and_investments=latest_bs.total_cash_and_investments, total_debt=latest_bs.total_debt,
                    lease_liabilities=latest_bs.lease_liabilities, exit_multiple=exit_multiple,
                )
                wacc_range = [wacc_result.wacc + d for d in (-0.02, -0.01, 0.0, 0.01, 0.02)]
                growth_range = [terminal_growth + d for d in (-0.01, -0.005, 0.0, 0.005, 0.01)]
                table = wacc_vs_growth_table(hist, assumptions, wacc_result, company, ctx, wacc_range, growth_range)
                ranking = rank_valuation_drivers(hist, assumptions, wacc_result, terminal_growth, company, ctx)
                scenarios_export = run_all_scenarios(
                    hist=hist, summary=summary, company=company, base_assumptions=assumptions,
                    base_wacc_inputs=wacc_inputs, base_terminal_growth=terminal_growth,
                    cash_and_investments=latest_bs.total_cash_and_investments, total_debt=latest_bs.total_debt,
                    lease_liabilities=latest_bs.lease_liabilities, exit_multiple=exit_multiple,
                )
                live_result = st.session_state.get("live_result") if data_source.startswith("Search") else None
                fd, tmp_path = tempfile.mkstemp(suffix=".xlsx")
                os.close(fd)
                try:
                    export_dcf_to_excel(
                        tmp_path, company, hist, summary, forecast, wacc_result, valuation, scenarios_export, table, ranking, integrity,
                        ingestion_notes=live_result.notes if live_result else None,
                        ingestion_warnings=live_result.warnings if live_result else None,
                    )
                    with open(tmp_path, "rb") as f:
                        xlsx_bytes = f.read()
                finally:
                    os.remove(tmp_path)
                st.download_button("Download DCF_Model.xlsx", xlsx_bytes, file_name=f"{file_stub}_DCF_Model.xlsx", key="dl_xlsx")

        with col_pdf:
            st.markdown("**Investment Report (PDF)**")
            st.caption("A short, readable report: valuation summary, investment view, key drivers & risks, scenarios, sensitivity, and assumptions.")
            if st.button("Generate Investment Report"):
                integrity = run_validation(hist, summary, forecast, wacc_result, valuation)
                ctx = ValuationContext(
                    cash_and_investments=latest_bs.total_cash_and_investments, total_debt=latest_bs.total_debt,
                    lease_liabilities=latest_bs.lease_liabilities, exit_multiple=exit_multiple,
                )
                wacc_range = [wacc_result.wacc + d for d in (-0.02, -0.01, 0.0, 0.01, 0.02)]
                growth_range = [terminal_growth + d for d in (-0.01, -0.005, 0.0, 0.005, 0.01)]
                table = wacc_vs_growth_table(hist, assumptions, wacc_result, company, ctx, wacc_range, growth_range)
                ranking = rank_valuation_drivers(hist, assumptions, wacc_result, terminal_growth, company, ctx)
                scenarios_export = run_all_scenarios(
                    hist=hist, summary=summary, company=company, base_assumptions=assumptions,
                    base_wacc_inputs=wacc_inputs, base_terminal_growth=terminal_growth,
                    cash_and_investments=latest_bs.total_cash_and_investments, total_debt=latest_bs.total_debt,
                    lease_liabilities=latest_bs.lease_liabilities, exit_multiple=exit_multiple,
                )
                fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
                os.close(fd)
                try:
                    generate_investment_report(tmp_path, company, hist, summary, forecast, wacc_result, valuation, scenarios_export, table, ranking, integrity)
                    with open(tmp_path, "rb") as f:
                        pdf_bytes = f.read()
                finally:
                    os.remove(tmp_path)
                st.download_button("Download Investment_Report.pdf", pdf_bytes, file_name=f"{file_stub}_Investment_Report.pdf", key="dl_pdf")
