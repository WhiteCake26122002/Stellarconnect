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

import pandas as pd
import streamlit as st

import ui_common
from backend.mutual_funds import nav, recommend, store


def _enrich(holdings: list) -> list[dict]:
    enriched = []
    for h in holdings:
        detail = nav.get_scheme_detail(h.scheme_code)
        if detail is None:
            enriched.append({
                "scheme_code": h.scheme_code, "scheme_name": h.scheme_name, "scheme_category": "Unknown",
                "units": h.units, "avg_nav": h.avg_nav, "current_nav": None, "value": 0.0,
                "invested": h.units * h.avg_nav, "gain": None, "gain_pct": None,
                "return_1y": None, "data_available": False,
            })
            continue
        _, current_nav = nav.latest_nav(detail)
        invested = h.units * h.avg_nav
        value = h.units * current_nav
        enriched.append({
            "scheme_code": h.scheme_code, "scheme_name": h.scheme_name,
            "scheme_category": detail["scheme_category"],
            "units": h.units, "avg_nav": h.avg_nav, "current_nav": current_nav, "value": value,
            "invested": invested, "gain": value - invested,
            "gain_pct": (value / invested - 1) * 100 if invested else None,
            "return_1y": nav.trailing_return_pct(detail, 365),
            "data_available": True,
        })
    return enriched


def _add_fund_form(user_key: str) -> None:
    st.sidebar.title("Add a Fund")
    all_schemes = nav.get_all_schemes()
    if not all_schemes:
        st.sidebar.warning("Could not reach the NAV data source right now. Try again shortly.")
        return
    st.sidebar.caption(f"{len(all_schemes):,} AMFI schemes available to search.")

    query = st.sidebar.text_input("Search scheme name", placeholder="e.g. HDFC Flexi Cap", key="mf_search_input")
    if not query.strip():
        return
    matches = nav.search_schemes(query, all_schemes, limit=15)
    if not matches:
        st.sidebar.info("No matching schemes.")
        return

    options = {f"{m['name']} ({m['code']})": m for m in matches}
    choice = st.sidebar.selectbox("Matching schemes", list(options.keys()), key="mf_scheme_choice")
    selected = options[choice]

    units = st.sidebar.number_input("Units", min_value=0.0, step=1.0, key="mf_units_input")
    nav_mode = st.sidebar.radio("Purchase NAV", ["Use latest NAV", "Enter manually"], key="mf_nav_mode")
    manual_nav = None
    if nav_mode == "Enter manually":
        manual_nav = st.sidebar.number_input("Your purchase NAV", min_value=0.0, step=0.01, key="mf_manual_nav_input")

    if st.sidebar.button("Add to Portfolio", use_container_width=True, type="primary"):
        detail = nav.get_scheme_detail(selected["code"])
        if nav_mode == "Use latest NAV":
            if detail is None:
                st.sidebar.error("Could not fetch a live NAV for this scheme right now.")
                return
            _, purchase_nav = nav.latest_nav(detail)
        else:
            purchase_nav = manual_nav
        try:
            store.add_holding(user_key, selected["code"], selected["name"], units, purchase_nav)
            st.sidebar.success(f"Added {units:g} units of {selected['name']}.")
            st.rerun()
        except store.MFError as e:
            st.sidebar.error(str(e))


def _portfolio_tab(user_key: str, enriched: list[dict]) -> None:
    if not enriched:
        st.info("No mutual funds tracked yet. Search for one in the sidebar to add your first holding.")
        return

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

    _add_fund_form(user_key)
    st.sidebar.divider()
    if st.sidebar.button("Back to Landing", use_container_width=True, key="mf_back_to_landing"):
        st.session_state[ui_common.ACCOUNT_SESSION_KEY] = False
        st.rerun()

    holdings = store.get_holdings(user_key)
    enriched = _enrich(holdings)

    tab_portfolio, tab_insights = st.tabs(["Portfolio", "Insights"])
    with tab_portfolio:
        _portfolio_tab(user_key, enriched)
    with tab_insights:
        _insights_tab(enriched)


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
