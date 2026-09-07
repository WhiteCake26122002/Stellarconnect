"""
Mutual Fund tracker: track real mutual fund holdings (scheme, units, average
NAV) against live daily NAV data, with rule-based portfolio observations
(concentration, category overlap, underperformance vs your own holdings).

Uses the same Account ID system as Paper Trading (see ui_common.py) - one
account, one login, every feature mode shares it.

This is not investment advice. The Insights tab only surfaces arithmetic
over your own holdings (weight, trailing returns, category); it never tells
you to buy or sell anything, and is not a substitute for a SEBI-registered
advisor.
"""
from __future__ import annotations

import datetime as dt

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import ui_common
import ui_theme
from backend.mutual_funds import analysis, nav, recommend, store

# Qualitative palette for allocation charts - distinct, readable against the app's dark
# background, in a fixed order so a given category's color stays consistent chart to chart.
_BREAKDOWN_PALETTE = ["#38BDF8", "#A78BFA", "#F472B6", "#34D399", "#FBBF24", "#60A5FA", "#FB7185", "#4ADE80"]


def _enrich(holdings: list) -> list[dict]:
    enriched = []
    for h in holdings:
        purchase_date = dt.date.fromisoformat(h.purchase_date)
        detail = nav.get_scheme_detail(h.scheme_code)
        if detail is None:
            enriched.append({
                "scheme_code": h.scheme_code, "scheme_name": h.scheme_name, "scheme_category": "Unknown",
                "fund_house": "Unknown", "units": h.units, "avg_nav": h.avg_nav, "current_nav": None,
                "value": 0.0, "invested": h.units * h.avg_nav, "purchase_date": purchase_date,
                "gain": None, "gain_pct": None, "return_1y": None, "data_available": False,
            })
            continue
        _, current_nav = nav.latest_nav(detail)
        invested = h.units * h.avg_nav
        value = h.units * current_nav
        enriched.append({
            "scheme_code": h.scheme_code, "scheme_name": h.scheme_name,
            "scheme_category": detail["scheme_category"], "fund_house": detail["fund_house"],
            "units": h.units, "avg_nav": h.avg_nav, "current_nav": current_nav, "value": value,
            "invested": invested, "purchase_date": purchase_date, "gain": value - invested,
            "gain_pct": (value / invested - 1) * 100 if invested else None,
            "return_1y": nav.trailing_return_pct(detail, 365),
            "data_available": True,
        })
    return enriched


def _add_fund_section(user_key: str) -> None:
    all_schemes = nav.get_all_schemes()
    if not all_schemes:
        st.warning("Could not reach the NAV data source right now. Try again shortly.")
        return
    st.caption(f"Search across all {len(all_schemes):,} AMFI schemes.")

    query = st.text_input("Search scheme name", placeholder="e.g. HDFC Flexi Cap", key="mf_search_input")
    if not query.strip():
        return
    matches = nav.search_schemes(query, all_schemes, limit=15)
    if not matches:
        st.info("No matching schemes.")
        return

    options = {f"{m['name']} ({m['code']})": m for m in matches}
    choice = st.selectbox("Matching schemes", list(options.keys()), key="mf_scheme_choice")
    selected = options[choice]

    detail = nav.get_scheme_detail(selected["code"])
    if detail is None:
        st.warning("Could not fetch a live NAV for this scheme right now. Try again shortly.")
        return
    latest_date, latest_price = nav.latest_nav(detail)
    st.metric("Latest NAV", f"Rs. {latest_price:,.4f}", help=f"As of {latest_date.strftime('%d %b %Y')}")

    c1, c2 = st.columns(2)
    units = c1.number_input("Units", min_value=0.0, step=1.0, key="mf_units_input")
    nav_mode = c2.radio("Purchase NAV", ["Use latest NAV", "Enter manually"], key="mf_nav_mode")
    manual_nav = None
    purchase_date = dt.date.today()
    if nav_mode == "Enter manually":
        c3, c4 = st.columns(2)
        manual_nav = c3.number_input("Your purchase NAV", min_value=0.0, step=0.01, key="mf_manual_nav_input")
        purchase_date = c4.date_input(
            "When did you buy this?", value=dt.date.today(), max_value=dt.date.today(), key="mf_purchase_date_input",
        )
        st.caption("Set the actual purchase date for an existing holding so returns (XIRR) are calculated correctly.")
        if units > 0 and manual_nav:
            st.caption(f"Order value: Rs. {units * manual_nav:,.2f}")
    elif units > 0:
        st.caption(f"Order value at latest NAV: Rs. {units * latest_price:,.2f}")

    if st.button("Add to Portfolio", type="primary", key="mf_add_button"):
        purchase_nav = latest_price if nav_mode == "Use latest NAV" else manual_nav
        try:
            store.add_holding(user_key, selected["code"], selected["name"], units, purchase_nav, purchase_date.isoformat())
            st.success(f"Added {units:g} units of {selected['name']} at Rs. {purchase_nav:,.4f}.")
            st.rerun()
        except store.MFError as e:
            st.error(str(e))


def _portfolio_tab(user_key: str, enriched: list[dict]) -> None:
    with st.expander("Add a Fund", expanded=not enriched):
        _add_fund_section(user_key)

    if not enriched:
        st.info("No mutual funds tracked yet. Use \"Add a Fund\" above to add your first holding.")
        return

    st.write("")
    total_invested = sum(h["invested"] for h in enriched)
    total_value = sum(h["value"] for h in enriched)
    total_gain = total_value - total_invested

    c1, c2, c3 = st.columns(3)
    c1.metric("Invested", f"Rs. {total_invested:,.2f}")
    c2.metric("Current Value", f"Rs. {total_value:,.2f}")
    c3.metric(
        "Overall Gain/Loss", f"Rs. {total_gain:,.2f}",
        f"{(total_gain / total_invested * 100) if total_invested else 0:+.2f}%",
    )

    st.write("")
    df = pd.DataFrame([{
        "Scheme": h["scheme_name"], "Category": h["scheme_category"], "Units": round(h["units"], 3),
        "Avg NAV": round(h["avg_nav"], 4),
        "Current NAV": round(h["current_nav"], 4) if h["current_nav"] is not None else None,
        "Invested (Rs.)": round(h["invested"], 2), "Value (Rs.)": round(h["value"], 2),
        "Gain/Loss (Rs.)": round(h["gain"], 2) if h["gain"] is not None else None,
        "Gain/Loss %": round(h["gain_pct"], 2) if h["gain_pct"] is not None else None,
        "1Y Return %": round(h["return_1y"], 2) if h["return_1y"] is not None else None,
    } for h in enriched])
    st.dataframe(df, use_container_width=True, hide_index=True)

    st.write("")
    st.caption("Remove a holding")
    options = {f"{h['scheme_name']} ({h['scheme_code']})": h["scheme_code"] for h in enriched}
    rc1, rc2 = st.columns([3, 1])
    choice = rc1.selectbox(
        "Remove a holding", list(options.keys()), key="mf_remove_choice", label_visibility="collapsed",
    )
    if rc2.button("Remove", use_container_width=True):
        store.remove_holding(user_key, options[choice])
        st.rerun()


def _insights_tab(enriched: list[dict]) -> None:
    st.caption(
        "Portfolio observations computed from your own holdings. Not investment advice, and not a "
        "substitute for a SEBI-registered advisor."
    )
    if not enriched:
        st.info("Add a fund to your portfolio to see observations here.")
        return
    flags = recommend.build_flags(enriched)
    if not flags:
        st.success("No concerns from these checks right now.")
        return
    for f in flags:
        body = f"**{f.title}**  \n{f.detail}"
        if f.severity == "warning":
            st.warning(body)
        else:
            st.info(body)


def _render_breakdown(allocation: dict[str, float]) -> None:
    """A single 100%-stacked horizontal bar (one colored segment per category) with a two-column
    color-swatch legend below - reads at a glance, unlike a multi-bar chart for a handful of
    categories that don't relate on a shared numeric axis."""
    if not allocation:
        st.caption("Not enough data to compute this yet.")
        return
    items = sorted(allocation.items(), key=lambda kv: kv[1], reverse=True)

    fig = go.Figure()
    for i, (label, pct) in enumerate(items):
        color = _BREAKDOWN_PALETTE[i % len(_BREAKDOWN_PALETTE)]
        fig.add_trace(go.Bar(
            x=[pct], y=[""], orientation="h", marker=dict(color=color, line=dict(width=0)),
            text=f"{pct:.0f}%" if pct >= 8 else "", textposition="inside", insidetextanchor="middle",
            textfont=dict(color="#0B0B12", size=12, family="-apple-system, Segoe UI, Roboto, sans-serif"),
            hovertemplate=f"{label}: {pct:.1f}%<extra></extra>", showlegend=False,
        ))
    fig.update_layout(
        barmode="stack", height=56, margin=dict(t=4, b=4, l=4, r=4), bargap=0,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        xaxis=dict(visible=False, range=[0, 100], fixedrange=True),
        yaxis=dict(visible=False, fixedrange=True),
    )
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})

    # A fresh st.columns(2) per row (rather than one columns() call reused via index%2) so items
    # fill left-to-right, top-to-bottom - the same reading order as the bar's segments - instead
    # of top-to-bottom within each column first.
    for row_start in range(0, len(items), 2):
        row = list(enumerate(items[row_start:row_start + 2], start=row_start))
        row_cols = st.columns(2)
        for col, (i, (label, pct)) in zip(row_cols, row):
            color = _BREAKDOWN_PALETTE[i % len(_BREAKDOWN_PALETTE)]
            with col:
                st.markdown(
                    ui_theme._flatten_html(f"""
                    <div style="display:flex; align-items:center; gap:8px; padding:3px 0;">
                        <span style="width:11px; height:11px; border-radius:3px; background:{color}; flex-shrink:0;"></span>
                        <span style="color:{ui_theme.MUTED}; font-size:0.84rem; flex:1;">{label}</span>
                        <span style="color:{ui_theme.INK}; font-weight:700; font-size:0.84rem;">{pct:.1f}%</span>
                    </div>
                    """),
                    unsafe_allow_html=True,
                )


def _analysis_tab(enriched: list[dict]) -> None:
    available = [h for h in enriched if h["data_available"]]
    if not available:
        st.info("Add a fund to your portfolio to see analysis here.")
        return

    st.caption(
        "Money-weighted (XIRR) returns compared against NIFTY 50 and NIFTY 500, plus how your "
        "portfolio splits by asset class, market cap and fund house."
    )

    today = dt.date.today()
    benchmark_histories = {label: nav.get_index_history(ticker) for label, ticker in nav.BENCHMARK_INDICES.items()}

    portfolio_flows = [(h["purchase_date"], -h["invested"]) for h in available]
    portfolio_flows.append((today, sum(h["value"] for h in available)))
    portfolio_xirr = analysis.xirr(portfolio_flows)

    def _benchmark_xirr(history: list[tuple[dt.date, float]]) -> float | None:
        total = 0.0
        for h in available:
            bev = analysis.benchmark_equivalent_value(h["invested"], h["purchase_date"], today, history)
            if bev is None:
                return None
            total += bev
        flows = [(h["purchase_date"], -h["invested"]) for h in available] + [(today, total)]
        return analysis.xirr(flows)

    benchmark_returns = {label: _benchmark_xirr(hist) for label, hist in benchmark_histories.items()}

    st.markdown("**Portfolio XIRR vs Benchmarks**")
    if portfolio_xirr is None:
        st.info("Not enough history yet to compute an annualized return (e.g. everything was bought today).")
    else:
        cols = st.columns(len(nav.BENCHMARK_INDICES) + 1)
        cols[0].metric("Your Portfolio", f"{portfolio_xirr:+.2f}%")
        for col, (label, bench_xirr) in zip(cols[1:], benchmark_returns.items()):
            col.metric(label, f"{bench_xirr:+.2f}%" if bench_xirr is not None else "n/a")

        comparable = {label: r for label, r in benchmark_returns.items() if r is not None}
        if comparable:
            beaten = [label for label, r in comparable.items() if portfolio_xirr > r]
            st.caption(f"Outperforming {len(beaten)}/{len(comparable)} benchmarks shown above.")

    st.write("")
    st.markdown("**Fund Performance (vs NIFTY 500)**")
    benchmark_history = benchmark_histories.get("NIFTY 500", [])
    fund_rows = []
    for h in available:
        own = analysis.xirr([(h["purchase_date"], -h["invested"]), (today, h["value"])])
        bev = (
            analysis.benchmark_equivalent_value(h["invested"], h["purchase_date"], today, benchmark_history)
            if benchmark_history else None
        )
        bench = analysis.xirr([(h["purchase_date"], -h["invested"]), (today, bev)]) if bev is not None else None
        fund_rows.append({"name": h["scheme_name"], "own": own, "bench": bench})

    comparable = [r for r in fund_rows if r["own"] is not None and r["bench"] is not None]
    if comparable:
        outperforming = [r for r in comparable if r["own"] > r["bench"]]
        st.caption(f"{len(outperforming)}/{len(comparable)} funds outperforming their NIFTY 500-equivalent period.")
        for r in comparable:
            with st.container(border=True):
                label = "outperforming benchmark" if r["own"] > r["bench"] else "trailing benchmark"
                st.markdown(f"**{r['name']}** ({label})")
                cc1, cc2 = st.columns(2)
                cc1.metric("Your XIRR", f"{r['own']:+.2f}%")
                cc2.metric("Benchmark XIRR", f"{r['bench']:+.2f}%")
    else:
        st.caption("Not enough purchase history yet to compare individual funds against the benchmark.")

    st.divider()

    rows = [{"scheme_category": h["scheme_category"], "value": h["value"]} for h in available]
    asset_alloc = analysis.weighted_breakdown(rows, analysis.classify_asset_class)
    with st.container(border=True):
        st.markdown("**Asset Allocation**")
        _render_breakdown(asset_alloc)
        if asset_alloc:
            top_label, top_pct = max(asset_alloc.items(), key=lambda kv: kv[1])
            if top_pct >= 80:
                st.warning(
                    f"Most of your investment is in {top_label} ({top_pct:.0f}%). "
                    "Consider whether that concentration matches your risk appetite."
                )

    st.write("")
    equity_rows = [
        {"scheme_category": h["scheme_category"], "value": h["value"]}
        for h in available if analysis.classify_asset_class(h["scheme_category"]) == "Equity"
    ]
    if equity_rows:
        cap_alloc = analysis.weighted_breakdown(equity_rows, analysis.classify_market_cap)
        with st.container(border=True):
            st.markdown("**Equity Market Cap Split**")
            _render_breakdown(cap_alloc)
            if cap_alloc:
                top_label, top_pct = max(cap_alloc.items(), key=lambda kv: kv[1])
                if top_pct >= 50:
                    st.warning(f"Your equity holdings are concentrated in {top_label} ({top_pct:.0f}%).")

    st.write("")
    amc_rows = [{"fund_house": h["fund_house"], "value": h["value"]} for h in available]
    amc_alloc = analysis.amc_breakdown(amc_rows)
    with st.container(border=True):
        st.markdown("**AMC Split**")
        _render_breakdown(amc_alloc)

    st.divider()
    st.caption(
        "Sector-level look-through (Financial, Technology, Healthcare, etc.) isn't shown here: it "
        "would require knowing exactly which stocks each fund currently holds, and there is no "
        "free, reliable source for that in India - only paid data providers carry it. The asset "
        "class and market cap splits above are based on each fund's official AMFI category, not a "
        "live look-through of its actual holdings."
    )


def _dashboard() -> None:
    user_key, display_name = ui_common.resolve_identity()
    if user_key is None:
        # Same recovery as Paper Trading: an account this browser was pointing at no longer
        # resolves to a real row (e.g. the backing store was reset). Bounce to the landing page.
        st.session_state[ui_common.ACCOUNT_SESSION_KEY] = False
        st.query_params.pop("uid", None)
        st.rerun()

    st.title("Mutual Fund Tracker")
    st.caption(f"Signed in as {display_name}. NAVs are sourced from AMFI via mfapi.in, updated once per business day.")

    if user_key.startswith("guest:"):
        uid = user_key.removeprefix("guest:")
        st.query_params["uid"] = uid

    if st.sidebar.button("Back to Landing", use_container_width=True, key="mf_back_to_landing"):
        st.session_state[ui_common.ACCOUNT_SESSION_KEY] = False
        st.rerun()

    holdings = store.get_holdings(user_key)
    enriched = _enrich(holdings)

    tab_portfolio, tab_insights, tab_analysis = st.tabs(["Portfolio", "Insights", "Analysis"])
    with tab_portfolio:
        _portfolio_tab(user_key, enriched)
    with tab_insights:
        _insights_tab(enriched)
    with tab_analysis:
        _analysis_tab(enriched)


def _landing_page() -> None:
    st.title("Mutual Fund Tracker")
    st.caption(
        "Track your real mutual fund holdings against live, daily-updated NAVs sourced from AMFI "
        "(via mfapi.in), and see simple portfolio observations: concentration, category overlap, "
        "and how each fund is doing against your own other holdings."
    )
    st.write("")
    c1, c2, c3 = st.columns(3)
    with c1:
        with st.container(border=True):
            st.markdown("**All AMFI Schemes**")
            st.caption("Search across every scheme AMFI publishes a NAV for, not a curated shortlist.")
    with c2:
        with st.container(border=True):
            st.markdown("**Daily NAV Updates**")
            st.caption("NAVs refresh on the same once-a-day cadence AMFI itself publishes them on.")
    with c3:
        with st.container(border=True):
            st.markdown("**Not Investment Advice**")
            st.caption("Insights are arithmetic over your own holdings, never a buy or sell recommendation.")

    st.divider()
    _, mid, _ = st.columns([1, 1.4, 1])
    with mid:
        ui_common.render_entry_gate()


def render() -> None:
    store.init_db()
    if st.session_state.get(ui_common.ACCOUNT_SESSION_KEY):
        _dashboard()
    else:
        _landing_page()
