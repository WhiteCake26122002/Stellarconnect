"""
Paper trading: a virtual-money stock game layered onto the same app. Every
account starts with Rs. 10,00,000 in simulated cash and trades real, live-quoted
stocks. No real order is ever sent anywhere and no real money ever moves.

Account identity piggybacks on Streamlit Community Cloud's own viewer-email
gate (`st.user`) when this app is deployed and access-restricted there, so no
separate login system had to be built. Running locally, or for any viewer
`st.user` doesn't recognize, a unique Account ID takes over instead: created
once, carried in the page URL (?uid=...), and re-enterable by hand if the
link gets lost.

Visual style deliberately reuses the same plain bordered-container look as
the DCF tool's own cards (see ui_theme.inject_css) rather than bespoke glass
panels. Fewer one-off components, fewer places for something to get clipped
or misaligned.
"""
from __future__ import annotations

import datetime as dt

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from streamlit_autorefresh import st_autorefresh

import ui_common
import ui_theme
import ui_trading_markets
from backend.common.company_search import search_companies
from backend.common.finance import jensens_alpha
from backend.trading import analysis, store
from backend.trading.models import STARTING_CASH
from backend.trading.quotes import (
    BENCHMARK_INDICES,
    NIFTY_TICKER,
    SECTOR_INDICES,
    SENSEX_TICKER,
    exchange_label,
    get_fx_rate_to_inr,
    get_intraday_history,
    get_live_prices,
    get_live_quotes,
    get_price_history,
)

WATCHLIST_PREVIEW = ["RELIANCE.NS", "TCS.NS", "INFY.NS", "AAPL", "MSFT", "TSLA"]
AUTOREFRESH_MS = 20_000  # matches the quote cache TTL in quotes.py, so each tick actually pulls a fresh price

# Company domains for the favicon-based logo on the fixed preview watchlist. Fetching a ticker's real
# website domain requires yfinance's heavier `.info` call (vs. the `fast_info` already fetched for
# price), so this is hardcoded for the small, fixed set below rather than paid for on every quote; a
# user-added watchlist ticker falls back to a plain letter avatar.
TICKER_DOMAINS = {
    "RELIANCE.NS": "ril.com",
    "TCS.NS": "tcs.com",
    "INFY.NS": "infosys.com",
    "AAPL": "apple.com",
    "MSFT": "microsoft.com",
    "TSLA": "tesla.com",
}


def _fmt_change(change: float, change_pct: float) -> str:
    sign = "+" if change >= 0 else ""
    return f"{sign}{change:,.2f} ({sign}{change_pct:.2%})"


def _stock_logo_html(ticker: str) -> str:
    """Real company favicon (via Google's favicon service, the same source ui_theme._avatar_html
    uses for the DCF cards) for the fixed preview watchlist; a plain letter avatar for anything not
    in TICKER_DOMAINS, and live (via onerror) if the favicon request itself fails."""
    domain = TICKER_DOMAINS.get(ticker)
    initial = ticker[0].upper()
    if not domain:
        return f'<div class="pt-logo pt-logo-letter">{initial}</div>'
    logo_url = f"https://www.google.com/s2/favicons?domain={domain}&sz=64"
    return (
        f'<div class="pt-logo">'
        f'<img src="{logo_url}" alt="{initial}" '
        f"onerror=\"this.onerror=null;this.parentElement.classList.add('pt-logo-letter');"
        f"this.parentElement.textContent='{initial}';\" />"
        f"</div>"
    )




def _css() -> None:
    st.markdown(
        ui_theme._flatten_html(f"""
        <style>
        /* Streamlit's default top padding leaves a large dead void above the content on a wide layout */
        div.block-container {{ padding-top: 2rem; }}

        @keyframes pt-pulse {{
            0%   {{ opacity: 1; transform: scale(1); }}
            50%  {{ opacity: 0.35; transform: scale(0.7); }}
            100% {{ opacity: 1; transform: scale(1); }}
        }}
        @media (prefers-reduced-motion: reduce) {{
            .pt-live-dot {{ animation: none !important; }}
        }}

        .pt-eyebrow {{ font-size:0.76rem; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:{ui_theme.MUTED}; }}
        .pt-h1 {{ font-size:2.2rem; font-weight:800; color:{ui_theme.INK}; letter-spacing:-0.01em; margin:4px 0 8px; }}
        .pt-sub {{ font-size:1rem; color:{ui_theme.MUTED}; max-width:620px; line-height:1.5; }}

        .pt-live {{ display:inline-flex; align-items:center; gap:6px; font-size:0.74rem; font-weight:700; color:{ui_theme.MUTED};
                    text-transform:uppercase; letter-spacing:0.06em; margin:4px 0 10px; }}
        .pt-live-dot {{ width:7px; height:7px; border-radius:50%; background:{ui_theme.BULL}; animation: pt-pulse 1.6s ease-in-out infinite; }}

        .pt-ticker-sym {{ font-size:0.74rem; font-weight:700; color:{ui_theme.MUTED}; letter-spacing:0.03em; }}
        .pt-ticker-px {{ font-size:1.05rem; font-weight:700; color:{ui_theme.INK}; font-variant-numeric: tabular-nums; }}
        .pt-ticker-chg {{ font-size:0.76rem; font-weight:600; }}
        .pt-ticker-chg.up {{ color:{ui_theme.BULL}; }}
        .pt-ticker-chg.down {{ color:{ui_theme.BEAR}; }}
        .pt-logo {{ width:34px; height:34px; border-radius:50%; background:#FFFFFF; display:flex; align-items:center;
                    justify-content:center; overflow:hidden; margin:0 auto 8px; box-shadow:0 2px 8px rgba(0,0,0,0.35); flex-shrink:0; }}
        .pt-logo img {{ width:100%; height:100%; object-fit:contain; padding:5px; box-sizing:border-box; }}
        .pt-logo.pt-logo-letter {{ background:{ui_theme.NAVY_LIGHT}; color:{ui_theme.INK}; font-weight:700; font-size:0.95rem; }}
        .pt-logo-row {{ display:flex; align-items:center; gap:10px; margin-bottom:2px; }}
        .pt-logo-row .pt-logo {{ margin:0; }}

        /* ---- Trading-floor top bar ---------------------------------------- */
        .pt-navbar {{ border-bottom:1px solid {ui_theme.BORDER}; padding:6px 4px 14px; margin-bottom:20px; }}
        .pt-navbar-row {{ display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }}
        .pt-navbar-left {{ display:flex; gap:26px; flex-wrap:wrap; }}
        .pt-index {{ display:flex; flex-direction:column; line-height:1.3; }}
        .pt-index-label {{ font-size:0.66rem; font-weight:700; letter-spacing:0.06em; color:{ui_theme.MUTED}; }}
        .pt-index-val {{ font-size:0.98rem; font-weight:700; color:{ui_theme.INK}; font-variant-numeric: tabular-nums; }}
        .pt-index-chg {{ font-size:0.72rem; font-weight:600; }}
        .pt-index-chg.up {{ color:{ui_theme.BULL}; }}
        .pt-index-chg.down {{ color:{ui_theme.BEAR}; }}
        .pt-navbar-brand {{ font-weight:800; font-size:1.15rem; color:{ui_theme.INK}; }}
        .pt-avatar {{ width:36px; height:36px; border-radius:50%; background:{ui_theme.NAVY_LIGHT}; color:{ui_theme.INK};
                      display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.8rem; flex-shrink:0; }}

        /* Sectoral indices row: smaller pills, horizontally scrollable so a narrow screen doesn't
           force multi-line wrapping mid-pill. */
        .pt-navbar-sectors {{ display:flex; gap:20px; margin-top:12px; padding-top:12px; overflow-x:auto;
                              border-top:1px solid {ui_theme.BORDER}; }}
        .pt-navbar-sectors .pt-index {{ flex-shrink:0; }}
        .pt-navbar-sectors .pt-index-label {{ font-size:0.62rem; }}
        .pt-navbar-sectors .pt-index-val {{ font-size:0.86rem; }}
        .pt-navbar-sectors .pt-index-chg {{ font-size:0.68rem; }}

        .pt-section-label {{ font-size:0.85rem; font-weight:700; color:{ui_theme.MUTED}; text-transform:uppercase;
                             letter-spacing:0.04em; margin:20px 0 10px; display:flex; align-items:center; gap:8px; }}
        .pt-popular {{ text-align:center; min-height:104px; display:flex; flex-direction:column; justify-content:center; gap:2px; }}

        .pt-watch-sym {{ font-weight:700; color:{ui_theme.INK}; font-size:0.88rem; }}
        .pt-watch-exch {{ font-size:0.68rem; color:{ui_theme.MUTED}; }}
        .pt-watch-px {{ font-weight:700; color:{ui_theme.INK}; text-align:right; font-variant-numeric: tabular-nums; }}
        .pt-watch-chg {{ font-size:0.72rem; font-weight:600; text-align:right; }}
        .pt-watch-chg.up {{ color:{ui_theme.BULL}; }}
        .pt-watch-chg.down {{ color:{ui_theme.BEAR}; }}
        </style>
        """),
        unsafe_allow_html=True,
    )


# ------------------------------------------------------------- Landing page --
def _live_ticker_strip() -> None:
    quotes = get_live_quotes(tuple(WATCHLIST_PREVIEW))
    cols = st.columns(len(WATCHLIST_PREVIEW))
    for col, t in zip(cols, WATCHLIST_PREVIEW):
        q = quotes.get(t)
        with col:
            with st.container(border=True):
                if q:
                    cls = "up" if q["change"] >= 0 else "down"
                    st.markdown(
                        ui_theme._flatten_html(f"""
                        <div style="text-align:center;">
                            <div class="pt-ticker-sym">{t}</div>
                            <div class="pt-ticker-px" data-countup="{q['price']:,.2f}" data-countup-key="px:{t}">{q['price']:,.2f}</div>
                            <div class="pt-ticker-chg {cls}">{_fmt_change(q['change'], q['change_pct'])}</div>
                        </div>
                        """),
                        unsafe_allow_html=True,
                    )
                else:
                    st.markdown(f'<div style="text-align:center;"><div class="pt-ticker-sym">{t}</div><div class="pt-ticker-px">n/a</div></div>', unsafe_allow_html=True)


def _sparkline_preview() -> None:
    hist = get_intraday_history("RELIANCE.NS")
    if hist.empty:
        return
    fig = go.Figure(go.Scatter(x=hist.iloc[:, 0], y=hist["Close"], mode="lines", line=dict(color=ui_theme.NAVY_LIGHT, width=2), fill="tozeroy", fillcolor="rgba(42,31,176,0.15)"))
    ui_theme.base_layout(fig, height=160, showlegend=False)
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False)
    fig.update_layout(margin=dict(t=4, b=4, l=4, r=4))
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})


def _landing_page() -> None:
    st.markdown('<div class="pt-eyebrow">Paper Trading. Share the link to invite others.</div>', unsafe_allow_html=True)
    st.markdown('<div class="pt-h1">Trade real stocks. Zero real risk.</div>', unsafe_allow_html=True)
    st.markdown(
        '<div class="pt-sub">Build a portfolio of real, live-quoted stocks against a simulated bankroll. '
        'Every price is real. Every rupee is not.</div>',
        unsafe_allow_html=True,
    )
    st.write("")

    _, wcol, _ = st.columns([1, 1.2, 1])
    with wcol:
        with st.container(border=True):
            st.caption("Starting wallet balance")
            st.metric("Starting wallet balance", f"Rs. {STARTING_CASH:,.0f}", label_visibility="collapsed")
            st.caption("Credited instantly to every new account. Simulated currency only.")

    st.write("")
    c1, c2, c3, c4 = st.columns(4)
    cards = [
        (c1, "Live Market Data", "Prices stream from the same Yahoo Finance feed powering the DCF engine, refreshed on a live cycle."),
        (c2, "No Real-Money Channel", "There is no card, bank, or crypto link anywhere in this app. Simulated cash cannot become real cash."),
        (c3, "Shareable Access", "Anyone with the app link can open it and create their own account. No sign-up or approval needed."),
        (c4, "Realistic Execution", "Orders fill at the live quote at the moment you submit them, using the same cost basis and P&L math a real broker uses."),
    ]
    for col, title, desc in cards:
        with col:
            with st.container(border=True):
                st.markdown(f"**{title}**")
                st.caption(desc)

    st.write("")
    st.markdown('<div class="pt-live"><span class="pt-live-dot"></span>Live preview</div>', unsafe_allow_html=True)
    _live_ticker_strip()
    st.write("")
    _sparkline_preview()

    st.write("")
    t1, t2, t3 = st.columns(3)
    t1.caption("Rs. 0 real money at risk, ever.")
    t2.caption("Prices refresh every ~20 seconds.")
    t3.caption("Portfolios are private to your account.")

    st.divider()
    _, mid, _ = st.columns([1, 1.4, 1])
    with mid:
        ui_common.render_entry_gate()


# ------------------------------------------------------------ Trading floor --
def _top_navbar(display_name: str) -> None:
    sector_tickers = [t for _, t in SECTOR_INDICES]
    quotes = get_live_quotes((NIFTY_TICKER, SENSEX_TICKER, *sector_tickers))
    usd_inr = get_fx_rate_to_inr("USD")

    def _pill(label: str, q: dict | None) -> str:
        if not q:
            return f'<div class="pt-index"><span class="pt-index-label">{label}</span><span class="pt-index-val">n/a</span></div>'
        cls = "up" if q["change"] >= 0 else "down"
        return (
            f'<div class="pt-index"><span class="pt-index-label">{label}</span>'
            f'<span class="pt-index-val" data-countup="{q["price"]:,.2f}" data-countup-key="idx:{label}">{q["price"]:,.2f}</span>'
            f'<span class="pt-index-chg {cls}">{_fmt_change(q["change"], q["change_pct"])}</span></div>'
        )

    fx_pill = (
        f'<div class="pt-index"><span class="pt-index-label">USD/INR</span>'
        f'<span class="pt-index-val">{usd_inr:,.2f}</span></div>'
    )
    sector_pills = "".join(_pill(label, quotes.get(t)) for label, t in SECTOR_INDICES)

    st.markdown(
        ui_theme._flatten_html(f"""
        <div class="pt-navbar">
            <div class="pt-navbar-row">
                <div class="pt-navbar-left">{_pill("NIFTY", quotes.get(NIFTY_TICKER))}{_pill("SENSEX", quotes.get(SENSEX_TICKER))}{fx_pill}</div>
                <div class="pt-navbar-brand">Paper Trading</div>
                <div class="pt-avatar">{ui_common.initials(display_name)}</div>
            </div>
            <div class="pt-navbar-sectors">{sector_pills}</div>
        </div>
        """),
        unsafe_allow_html=True,
    )


def _watchlist_sidebar() -> None:
    st.sidebar.title("Watchlist")
    watchlist: list[str] = st.session_state.setdefault("pt_watchlist", list(WATCHLIST_PREVIEW))

    with st.sidebar.form("pt_watch_add_form", clear_on_submit=True, border=False):
        wc1, wc2 = st.columns([3, 1])
        new_ticker = wc1.text_input("Search & add", placeholder="e.g. HDFCBANK.NS", label_visibility="collapsed")
        added = wc2.form_submit_button("Add")
    if added and new_ticker.strip():
        t = new_ticker.strip().upper()
        if t not in watchlist:
            watchlist.append(t)
            st.toast(f"Added {t} to watchlist", icon="⭐")

    quotes = get_live_quotes(tuple(watchlist)) if watchlist else {}
    for t in watchlist:
        q = quotes.get(t)
        with st.sidebar.container(border=True):
            rc1, rc2 = st.columns([3, 2])
            rc1.markdown(
                f'<div class="pt-logo-row">{_stock_logo_html(t)}<div><div class="pt-watch-sym">{t}</div>'
                f'<div class="pt-watch-exch">{exchange_label(t)}</div></div></div>',
                unsafe_allow_html=True,
            )
            if q:
                cls = "up" if q["change"] >= 0 else "down"
                rc2.markdown(
                    f'<div class="pt-watch-px" data-countup="{q["price"]:,.2f}" data-countup-key="wl:{t}">{q["price"]:,.2f}</div>'
                    f'<div class="pt-watch-chg {cls}">{_fmt_change(q["change"], q["change_pct"])}</div>',
                    unsafe_allow_html=True,
                )
            else:
                rc2.markdown('<div class="pt-watch-px">n/a</div>', unsafe_allow_html=True)
            wcol1, wcol2, wcol3 = st.columns(3)
            if wcol1.button("Trade", key=f"watch_trade_{t}", use_container_width=True):
                st.session_state["pt_ticker_input"] = t
            if wcol2.button("Chart", key=f"watch_chart_{t}", use_container_width=True):
                _goto_chart(t, t)
            if wcol3.button("✕", key=f"watch_remove_{t}", use_container_width=True, help="Remove from watchlist"):
                watchlist.remove(t)
                st.toast(f"Removed {t} from watchlist", icon="🗑️")
                st.rerun()


def _summary_card(cash: float, holdings_value: float) -> float:
    net_worth = cash + holdings_value
    total_return = net_worth - STARTING_CASH
    total_return_pct = total_return / STARTING_CASH
    st.markdown(
        ui_theme.kpi_card(
            f"Portfolio Value  ·  Total return {total_return:+,.2f}", f"Rs. {net_worth:,.2f}",
            icon="wallet", change_pct=total_return_pct * 100,
        ),
        unsafe_allow_html=True,
    )
    return net_worth


def _goto_chart(ticker: str, name: str) -> None:
    """Jump straight to that ticker's chart in the Markets tab, from anywhere in the app -
    the sidebar Watchlist, Popular Stocks, or Holdings. Streamlit's own st.tabs() has no
    server-side way to activate a different tab (the Markets tab's own "View Chart" buttons
    don't need this - they're already on that pill), which is why _dashboard() drives
    navigation off session_state instead of st.tabs(); this just adds the one extra step
    those in-tab buttons don't need: switching the active pill itself.

    Can't assign st.session_state["pt_active_tab"] directly here: this runs from inside a
    tab body (Home, Portfolio, ...), which renders *after* the segmented_control widget with
    that key is already instantiated for this script run, and Streamlit raises
    StreamlitWidgetAlreadyInstantiatedError on a same-run reassignment. Stashing it in a
    plain key instead and applying it just before the widget is created on the rerun (see
    _dashboard) sidesteps that - it only ever writes pt_active_tab pre-instantiation."""
    st.session_state["mkt_selected_ticker"] = ticker
    st.session_state["mkt_selected_name"] = name
    st.session_state["_pt_goto_tab"] = "Markets"
    st.rerun()


def _popular_stocks_row() -> None:
    st.markdown('<div class="pt-section-label"><span class="pt-live-dot"></span>Popular Stocks</div>', unsafe_allow_html=True)
    quotes = get_live_quotes(tuple(WATCHLIST_PREVIEW))
    cols = st.columns(len(WATCHLIST_PREVIEW))
    for col, t in zip(cols, WATCHLIST_PREVIEW):
        q = quotes.get(t)
        logo = _stock_logo_html(t)
        with col:
            with st.container(border=True):
                if q:
                    cls = "up" if q["change"] >= 0 else "down"
                    st.markdown(
                        ui_theme._flatten_html(f"""
                        <div class="pt-popular">
                            {logo}
                            <div class="pt-ticker-sym">{t}</div>
                            <div class="pt-ticker-px">{q['price']:,.2f}</div>
                            <div class="pt-ticker-chg {cls}">{_fmt_change(q['change'], q['change_pct'])}</div>
                        </div>
                        """),
                        unsafe_allow_html=True,
                    )
                else:
                    st.markdown(
                        ui_theme._flatten_html(f'<div class="pt-popular">{logo}<div class="pt-ticker-sym">{t}</div><div class="pt-ticker-px">n/a</div></div>'),
                        unsafe_allow_html=True,
                    )
                pop_c1, pop_c2 = st.columns(2)
                if pop_c1.button("Trade", key=f"pop_trade_{t}", use_container_width=True):
                    st.session_state["pt_ticker_input"] = t
                if pop_c2.button("Chart", key=f"pop_chart_{t}", use_container_width=True):
                    _goto_chart(t, t)


def _order_panel(user_key: str, cash: float) -> None:
    st.markdown('<div class="pt-section-label">Place an Order</div>', unsafe_allow_html=True)
    c1, c2, c3 = st.columns([2, 1, 1])
    ticker = c1.text_input("Ticker", key="pt_ticker_input", placeholder="e.g. RELIANCE.NS, AAPL, or search \"Reliance\"")
    qty = c2.number_input("Quantity", min_value=0.0, value=0.0, step=1.0, key="pt_qty_input")

    live_price = None
    if ticker.strip():
        quotes = get_live_quotes((ticker.strip().upper(),))
        q = quotes.get(ticker.strip().upper())
        live_price = q["price"] if q else None
        if q is not None:
            c3.metric("Live Price (INR)", f"{live_price:,.2f}")
            if q["currency"] != "INR":
                st.caption(f"Quoted in {q['currency']} natively, converted to INR at a live spot rate of {q['fx_rate']:,.2f} {q['currency']}/INR. All cash and P&L in this app are INR.")
            if qty > 0:
                st.caption(f"Order value: {qty * live_price:,.2f} (cash available: {cash:,.2f})")
        else:
            c3.metric("Live Price", "n/a")
            matches = search_companies(ticker.strip())
            if matches:
                st.caption("Not a live ticker as typed. Did you mean:")
                sugg_cols = st.columns(len(matches))
                for col, m in zip(sugg_cols, matches):
                    if col.button(m["symbol"], key=f"pt_sugg_{m['symbol']}", help=f"{m['name']} - {m['exchange']}", use_container_width=True):
                        st.session_state["pt_ticker_input"] = m["symbol"]
            else:
                st.warning(f"Could not fetch a live price for '{ticker}'. Check the ticker/exchange suffix (e.g. RELIANCE.NS, AAPL).")

    bcol, scol = st.columns(2)
    if bcol.button("Buy", use_container_width=True, type="primary", disabled=not (ticker.strip() and qty > 0 and live_price)):
        try:
            store.execute_buy(user_key, ticker.strip().upper(), qty, live_price)
            st.toast(f"Bought {qty:g} {ticker.strip().upper()} at {live_price:,.2f}", icon="✅")
            st.rerun()
        except store.TradeError as e:
            st.error(str(e))
    if scol.button("Sell", use_container_width=True, disabled=not (ticker.strip() and qty > 0 and live_price)):
        try:
            store.execute_sell(user_key, ticker.strip().upper(), qty, live_price)
            st.toast(f"Sold {qty:g} {ticker.strip().upper()} at {live_price:,.2f}", icon="✅")
            st.rerun()
        except store.TradeError as e:
            st.error(str(e))


def _holdings_orbit(user_key: str, cash: float) -> None:
    """A faster, secondary read of the same holdings `_holdings_table` lists in full below -
    each planet is one position, sized by weight and colored by its own return; hovering one
    also shows today's real intraday sparkline for terminal-level density."""
    holdings = store.get_holdings(user_key)
    if not holdings:
        st.markdown(ui_theme.orbit_holdings_html([], "Cash", f"Rs. {cash:,.0f}"), unsafe_allow_html=True)
        return

    quotes = get_live_quotes(tuple(h.ticker for h in holdings))
    items = []
    for h in holdings:
        q = quotes.get(h.ticker)
        px = q["price"] if q else h.avg_cost
        value = h.quantity * px
        return_pct = (px / h.avg_cost - 1) * 100 if h.avg_cost else 0.0
        spark = get_intraday_history(h.ticker)
        items.append({
            "label": h.ticker, "sublabel": f"Qty {h.quantity:g} - avg Rs. {h.avg_cost:,.2f}",
            "weight_pct": value, "return_pct": return_pct,
            "spark_values": spark["Close"].tolist() if not spark.empty else None,
        })
    total = sum(it["weight_pct"] for it in items) or 1.0
    for it in items:
        it["weight_pct"] = it["weight_pct"] / total * 100
    st.markdown(ui_theme.orbit_holdings_html(items, "Cash", f"Rs. {cash:,.0f}"), unsafe_allow_html=True)


def _holdings_table(user_key: str) -> float:
    holdings = store.get_holdings(user_key)
    if not holdings:
        st.info("No positions yet. Place your first order from the Home tab.")
        return 0.0

    tickers = tuple(h.ticker for h in holdings)
    quotes = get_live_quotes(tickers)

    rows = []
    total_value = 0.0
    for h in holdings:
        q = quotes.get(h.ticker)
        px = q["price"] if q else None
        value = h.quantity * px if px is not None else None
        pnl = (px - h.avg_cost) * h.quantity if px is not None else None
        pnl_pct = (px / h.avg_cost - 1) if px else None
        if value is not None:
            total_value += value
        rows.append({
            "Ticker": h.ticker, "Native Ccy": q["currency"] if q else "?", "Qty": h.quantity,
            "Avg Cost (INR)": round(h.avg_cost, 2),
            "Live Price (INR)": round(px, 2) if px is not None else None,
            "Market Value (INR)": round(value, 2) if value is not None else None,
            "Unrealized P&L (INR)": round(pnl, 2) if pnl is not None else None,
            "P&L %": round(pnl_pct * 100, 2) if pnl_pct is not None else None,
        })
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
    st.caption("All values shown in INR. Non-INR tickers are converted at the live spot rate in effect at the time of each quote.")
    return total_value


def _transactions_table(user_key: str) -> None:
    txns = store.get_transactions(user_key, limit=50)
    if not txns:
        st.info("No orders placed yet.")
        return
    st.dataframe(
        pd.DataFrame([{
            "Time": t.timestamp[:19].replace("T", " "), "Side": t.side, "Ticker": t.ticker,
            "Qty": t.quantity, "Price": round(t.price, 2),
            "Realized P&L": round(t.realized_pnl, 2) if t.realized_pnl is not None else "",
        } for t in txns]),
        use_container_width=True, hide_index=True,
    )


def _leaderboard(current_user_key: str) -> None:
    users = store.get_all_users()
    if len(users) <= 1:
        st.info("Invite a friend to open an account and the leaderboard fills in here.")
        return
    all_holdings = {u.user_key: store.get_holdings(u.user_key) for u in users}
    all_tickers = tuple({h.ticker for hs in all_holdings.values() for h in hs})
    prices = get_live_prices(all_tickers) if all_tickers else {}

    rows = []
    for u in users:
        value = sum((prices.get(h.ticker) or h.avg_cost) * h.quantity for h in all_holdings[u.user_key])
        net_worth = u.cash + value
        rows.append({
            "Player": u.display_name + (" (you)" if u.user_key == current_user_key else ""),
            "Net Worth": round(net_worth, 2),
            "Return %": round((net_worth / STARTING_CASH - 1) * 100, 2),
        })
    rows.sort(key=lambda r: r["Net Worth"], reverse=True)
    for i, r in enumerate(rows, 1):
        r["Rank"] = i
    df = pd.DataFrame(rows)[["Rank", "Player", "Net Worth", "Return %"]]
    st.dataframe(df, use_container_width=True, hide_index=True)


def _benchmarks_tab(created_at: dt.date, cash: float, holdings: list, live_prices: dict[str, float]) -> None:
    today = dt.date.today()
    net_worth = cash + sum((live_prices.get(h.ticker) or h.avg_cost) * h.quantity for h in holdings)
    portfolio_return = analysis.account_return_pct(created_at, today, STARTING_CASH, net_worth)

    st.markdown('<div class="pt-section-label">Portfolio vs Benchmarks</div>', unsafe_allow_html=True)
    st.caption(
        "Your account's money-weighted (XIRR) return since it was created, compared against what "
        "the same starting cash would have earned if it had gone into each index instead."
    )

    if portfolio_return is None:
        st.info("Not enough history yet to compute an annualized return - check back once your account is at least a day old.")
        return

    benchmark_histories = {label: get_price_history(ticker) for label, ticker in BENCHMARK_INDICES.items()}
    benchmark_returns: dict[str, float | None] = {
        label: analysis.benchmark_return_pct(created_at, today, STARTING_CASH, history)
        for label, history in benchmark_histories.items()
    }

    cols = st.columns(len(BENCHMARK_INDICES) + 1)
    with cols[0]:
        with st.container(border=True):
            st.metric("Your Portfolio", f"{portfolio_return:+.2f}%")
    for col, (label, bench_return) in zip(cols[1:], benchmark_returns.items()):
        with col:
            with st.container(border=True):
                st.metric(label, f"{bench_return:+.2f}%" if bench_return is not None else "n/a")

    comparable = {label: r for label, r in benchmark_returns.items() if r is not None}
    if comparable:
        beaten = [label for label, r in comparable.items() if portfolio_return > r]
        st.caption(f"Outperforming {len(beaten)}/{len(comparable)} benchmarks shown above.")

    st.divider()

    st.markdown('<div class="pt-section-label">Alpha</div>', unsafe_allow_html=True)
    with st.expander("What is alpha?"):
        st.write(
            "Alpha (α) measures an investing strategy's ability to outperform the market - "
            "its \"edge\". It's the excess return of a portfolio compared to a benchmark index, "
            "adjusted for risk. A positive alpha means the portfolio beat what its risk level "
            "would predict; a negative alpha means it fell short.\n\n"
            "Alpha is calculated alongside beta (β), which measures how sensitive a "
            "portfolio is to overall market moves - a beta above 1 means it tends to swing more "
            "than the market, below 1 means less. Together they separate genuine skill from "
            "returns that simply came from taking on more market risk."
        )

    ac1, ac2 = st.columns(2)
    benchmark_label = ac1.selectbox("Benchmark for Beta & Alpha", list(BENCHMARK_INDICES.keys()), key="pt_alpha_benchmark")
    risk_free_rate = ac2.number_input(
        "Risk-free rate (%)", min_value=0.0, max_value=15.0, value=7.0, step=0.1, key="pt_alpha_rf_rate",
    )
    st.caption(
        "There's no live Indian government-bond-yield feed wired up here, so enter the current "
        "10-year G-Sec yield (or your own assumption) directly - the same manual approach the DCF "
        "tool's own risk-free-rate input uses."
    )

    benchmark_history = benchmark_histories[benchmark_label]
    benchmark_return = benchmark_returns[benchmark_label]

    stock_betas = []
    unavailable = []
    for h in holdings:
        stock_history = get_price_history(h.ticker)
        b = analysis.stock_beta(stock_history, benchmark_history)
        if b is None:
            unavailable.append(h.ticker)
        else:
            value = (live_prices.get(h.ticker) or h.avg_cost) * h.quantity
            stock_betas.append((b, value))

    portfolio_beta = analysis.portfolio_beta(stock_betas, cash_value=cash)

    if portfolio_beta is None or benchmark_return is None:
        st.info("Not enough live price history yet to compute beta and alpha for this portfolio.")
        return

    alpha = jensens_alpha(portfolio_return, benchmark_return, portfolio_beta, risk_free_rate)
    bc1, bc2, bc3 = st.columns(3)
    with bc1:
        with st.container(border=True):
            st.metric("Portfolio Beta", f"{portfolio_beta:.2f}", help="How sensitive your portfolio is to the benchmark's moves. 1.0 tracks it exactly; above 1.0 amplifies it, below 1.0 dampens it.")
    with bc2:
        with st.container(border=True):
            st.metric(f"{benchmark_label} Return", f"{benchmark_return:+.2f}%", help="The benchmark's own return over the same period, for comparison against your portfolio's return.")
    with bc3:
        with st.container(border=True):
            st.metric("Alpha (α)", f"{alpha:+.2f}%", help="The return your portfolio earned above (or below) what its beta alone would predict against this benchmark, at the given risk-free rate.")

    if alpha > 0:
        st.success(f"Positive alpha: your portfolio beat what its risk level (beta {portfolio_beta:.2f}) would predict against {benchmark_label}.")
    else:
        st.warning(f"Negative alpha: your portfolio fell short of what its risk level (beta {portfolio_beta:.2f}) would predict against {benchmark_label}.")

    if unavailable:
        st.caption(f"Beta excludes {', '.join(unavailable)} - not enough live price history for them yet.")
    st.caption(
        "Beta is estimated from each stock's own recent daily price history against "
        f"{benchmark_label}; foreign stocks use their native-currency returns (day-to-day INR "
        "exchange-rate moves aren't factored into beta). Idle cash contributes a beta of 0."
    )


def _dashboard() -> None:
    st_autorefresh(interval=AUTOREFRESH_MS, key="pt_autorefresh")

    user_key, display_name = ui_common.resolve_identity()
    if user_key is None:
        # The account this browser was pointing at (via ?uid=... or a stale session) no longer
        # resolves to a real row - e.g. the backing store was reset. Bounce back to the landing
        # page instead of crashing on a null display_name.
        st.session_state[ui_common.ACCOUNT_SESSION_KEY] = False
        st.query_params.pop("uid", None)
        st.rerun()
    user = store.get_or_create_user(user_key, display_name)

    _top_navbar(display_name)

    if user_key.startswith("guest:"):
        uid = user_key.removeprefix("guest:")
        st.query_params["uid"] = uid  # keeps the URL carrying it even if this run got here some other way
        with st.sidebar.container(border=True):
            st.caption("Your Account ID")
            st.code(uid, language=None)
            st.caption("This page's URL now has ?uid=... in it. Bookmark it, or save the ID above, to get back to this exact portfolio after closing the browser.")

    _watchlist_sidebar()
    st.sidebar.divider()
    if st.sidebar.button("Back to Landing", use_container_width=True):
        st.session_state[ui_common.ACCOUNT_SESSION_KEY] = False
        st.rerun()

    holdings_for_summary = store.get_holdings(user_key)
    live_prices_for_summary = get_live_prices(tuple(h.ticker for h in holdings_for_summary)) if holdings_for_summary else {}
    holdings_value = sum((live_prices_for_summary.get(h.ticker) or h.avg_cost) * h.quantity for h in holdings_for_summary)

    # A session-state pill selector instead of st.tabs(): st.tabs() has no server-side way to
    # activate a different tab, which is exactly what "click any stock, anywhere, see its
    # chart" needs (see _goto_chart above) - Popular Stocks, the sidebar Watchlist, and
    # Holdings all live outside the Markets pill and need to land the user on it.
    if "_pt_goto_tab" in st.session_state:
        st.session_state["pt_active_tab"] = st.session_state.pop("_pt_goto_tab")
    active_tab = st.segmented_control(
        "Navigate", ["Home", "Markets", "Orders", "Portfolio", "Benchmarks", "Leaderboard"],
        default="Home", key="pt_active_tab", label_visibility="collapsed",
    )
    if not active_tab:  # segmented_control can come back empty if deselected - same guard ui_app.py uses for its own scenario picker
        active_tab = "Home"
    st.write("")

    if active_tab == "Home":
        _summary_card(user.cash, holdings_value)
        st.caption("Simulated cash, real live prices. This page refreshes itself every ~20 seconds.")
        m1, m2, m3 = st.columns(3)
        m1.markdown(ui_theme.kpi_card("Cash Left", f"Rs. {user.cash:,.2f}", icon="wallet"), unsafe_allow_html=True)
        m2.markdown(ui_theme.kpi_card("Stocks Bought", f"{len(holdings_for_summary)}", icon="bar-chart"), unsafe_allow_html=True)
        m3.markdown(ui_theme.kpi_card("Invested Value", f"Rs. {holdings_value:,.2f}", icon="layers"), unsafe_allow_html=True)
        st.divider()
        _popular_stocks_row()
        st.divider()
        _order_panel(user_key, user.cash)

    if active_tab == "Markets":
        if st.session_state.get("mkt_selected_ticker"):
            ui_trading_markets.render_stock_detail(user_key, user.cash, st.session_state["mkt_selected_ticker"])
        else:
            ui_trading_markets.render_movers_tab(user_key, user.cash)

    if active_tab == "Orders":
        _transactions_table(user_key)

    if active_tab == "Portfolio":
        c1, c2 = st.columns(2)
        c1.markdown(ui_theme.kpi_card("Cash", f"Rs. {user.cash:,.2f}", icon="wallet"), unsafe_allow_html=True)
        c2.markdown(ui_theme.kpi_card("Holdings Value", f"Rs. {holdings_value:,.2f}", icon="layers"), unsafe_allow_html=True)
        st.write("")
        _holdings_orbit(user_key, user.cash)
        st.caption("Each planet is a position - size is its weight in the book, color is its own return. Hover for the numbers and today's move; the table below has the rest.")
        st.write("")
        if holdings_for_summary:
            st.caption("View chart:")
            chip_cols = st.columns(len(holdings_for_summary))
            for col, h in zip(chip_cols, holdings_for_summary):
                if col.button(h.ticker, key=f"holding_chart_{h.ticker}", use_container_width=True):
                    _goto_chart(h.ticker, h.ticker)
        _holdings_table(user_key)

    if active_tab == "Benchmarks":
        created_at = dt.datetime.fromisoformat(user.created_at).date()
        _benchmarks_tab(created_at, user.cash, holdings_for_summary, live_prices_for_summary)

    if active_tab == "Leaderboard":
        _leaderboard(user_key)


def render() -> None:
    store.init_db()
    _css()
    if st.session_state.get(ui_common.ACCOUNT_SESSION_KEY):
        _dashboard()
    else:
        _landing_page()
