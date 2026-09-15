"""
Markets tab for Paper Trading: gainers/losers across NSE indices, and a
stock detail view with a TradingView-style candlestick chart (via
streamlit-lightweight-charts, which wraps TradingView's own open-source
Lightweight Charts library), toggleable technical indicators, and buy/sell
straight from the chart.

Honesty notes carried through the UI, not hidden: movers refresh on a
multi-minute cache for broad indices (a live per-ticker fetch across an
entire index takes too long to be interactive - see movers.py's docstring),
and every price here is Yahoo Finance's own delayed NSE feed, not
tick-real-time - same framing the rest of Paper Trading already uses.
"""
from __future__ import annotations

import datetime as dt
import json

import pandas as pd
import streamlit as st
from streamlit_autorefresh import st_autorefresh
from streamlit_lightweight_charts import renderLightweightCharts

import ui_theme
from backend.common.company_search import search_companies
from backend.common.currency_format import format_per_share, format_scaled_money
from backend.trading import store
from backend.trading import technical_indicators as ti
from backend.trading.index_constituents import INDEX_CSV_URLS, get_index_constituents
from backend.trading.movers import MoverRow, get_movers
from backend.trading.quotes import (
    TIMEFRAME_PRESETS,
    get_fx_rate_to_inr,
    get_key_stats,
    get_live_quotes,
    get_ohlc_history,
)

INDEX_NAMES = list(INDEX_CSV_URLS.keys())
DETAIL_AUTOREFRESH_MS = 25_000


def _fmt_volume(volume: float) -> str:
    if volume >= 1e7:
        return f"{volume / 1e7:.2f}Cr"
    if volume >= 1e5:
        return f"{volume / 1e5:.2f}L"
    if volume >= 1e3:
        return f"{volume / 1e3:.1f}K"
    return f"{volume:,.0f}"


def _render_mover_row(row: MoverRow) -> None:
    with st.container(border=True):
        c1, c2, c3 = st.columns([2, 1.4, 1.1])
        with c1:
            st.markdown(f"**{row.ticker}**")
            st.caption(row.name)
        with c2:
            cls = "up" if row.change_pct >= 0 else "down"
            st.markdown(
                ui_theme._flatten_html(f"""
                <div style="text-align:right;">
                    <div class="pt-watch-px">Rs. {row.price:,.2f}</div>
                    <div class="pt-watch-chg {cls}">{row.change:+.2f} ({row.change_pct:+.2f}%)</div>
                </div>
                """),
                unsafe_allow_html=True,
            )
            st.caption(f"Vol {_fmt_volume(row.volume)}")
        with c3:
            if st.button("View Chart", key=f"mkt_view_{row.ticker}", use_container_width=True):
                st.session_state["mkt_selected_ticker"] = f"{row.ticker}.NS"
                st.session_state["mkt_selected_name"] = row.name
                st.rerun()


def _render_search_and_trade(user_key: str, cash: float) -> None:
    """
    A broker-style search box: type a company, get back rows with a live price and three
    actions - Buy/Sell execute inline right under that row (no navigation), Chart jumps into
    the same stock-detail view the movers list's own "View Chart" button uses. Buy/Sell open
    an inline quantity+confirm control rather than executing instantly, mirroring how a real
    broker's search result opens an order ticket instead of firing an order on one click.
    """
    st.markdown('<div class="pt-section-label">Search & Trade</div>', unsafe_allow_html=True)
    query = st.text_input(
        "Search company", key="mkt_search_query", placeholder="e.g. Reliance, TCS, Infosys",
        label_visibility="collapsed",
    )
    if not query.strip():
        return

    matches = search_companies(query.strip())
    if not matches:
        st.caption("No matches yet - keep typing, or try the exact ticker.")
        return

    quotes = get_live_quotes(tuple(m["symbol"] for m in matches))
    active_side, active_symbol = st.session_state.get("mkt_search_action", (None, None))

    for m in matches:
        symbol = m["symbol"]
        q = quotes.get(symbol)
        live_price = q["price"] if q else None
        with st.container(border=True):
            row_col, action_col = st.columns([3, 1.8])
            with row_col:
                st.markdown(
                    ui_theme.search_result_row_html(
                        m["name"], symbol, m["exchange"],
                        price=f"Rs. {live_price:,.2f}" if live_price else None,
                        change_pct=(q["change_pct"] * 100) if q else None,
                    ),
                    unsafe_allow_html=True,
                )
            with action_col:
                bcol, scol, ccol = action_col.columns(3)
                if bcol.button("Buy", key=f"srch_buy_{symbol}", use_container_width=True, type="primary"):
                    st.session_state["mkt_search_action"] = ("buy", symbol)
                    st.rerun()
                if scol.button("Sell", key=f"srch_sell_{symbol}", use_container_width=True):
                    st.session_state["mkt_search_action"] = ("sell", symbol)
                    st.rerun()
                if ccol.button("Chart", key=f"srch_chart_{symbol}", use_container_width=True):
                    st.session_state["mkt_selected_ticker"] = symbol
                    st.session_state["mkt_selected_name"] = m["name"]
                    st.session_state.pop("mkt_search_action", None)
                    st.rerun()

            if active_symbol == symbol:
                qc1, qc2, qc3 = st.columns([1, 1.4, 1])
                qty = qc1.number_input(
                    "Qty", min_value=0.0, value=1.0, step=1.0, key=f"srch_qty_{symbol}",
                    label_visibility="collapsed",
                )
                with qc2:
                    if live_price and qty > 0:
                        st.caption(f"Order value: Rs. {qty * live_price:,.2f} (cash: Rs. {cash:,.2f})")
                    elif not live_price:
                        st.caption("No live price available right now.")
                confirm_label = "Confirm Buy" if active_side == "buy" else "Confirm Sell"
                if qc3.button(
                    confirm_label, key=f"srch_confirm_{symbol}", use_container_width=True,
                    type="primary" if active_side == "buy" else "secondary",
                    disabled=not (live_price and qty > 0),
                ):
                    try:
                        if active_side == "buy":
                            store.execute_buy(user_key, symbol, qty, live_price)
                        else:
                            store.execute_sell(user_key, symbol, qty, live_price)
                        verb = "Bought" if active_side == "buy" else "Sold"
                        st.toast(f"{verb} {qty:g} {symbol} at Rs. {live_price:,.2f}", icon="✅")
                        st.session_state.pop("mkt_search_action", None)
                        st.rerun()
                    except store.TradeError as e:
                        st.error(str(e))


def render_movers_tab(user_key: str, cash: float) -> None:
    _render_search_and_trade(user_key, cash)
    st.divider()
    st.markdown('<div class="pt-section-label">Market Movers</div>', unsafe_allow_html=True)
    st.caption(
        "Gainers/losers refresh every ~1 minute for smaller indices and every ~5 minutes for "
        "broad ones (Nifty 500 / Midcap 150 / Smallcap 250) - ranking ~500 live prices on every "
        "page load isn't interactive, so this trades a little freshness for speed. Prices are "
        "Yahoo Finance's own delayed NSE feed, not tick-real-time."
    )

    index_name = st.selectbox("Index", INDEX_NAMES, index=0, key="mkt_index_select")

    with st.spinner(f"Loading {index_name} movers..."):
        result = get_movers(index_name, top_n=10)

    if result.universe_size == 0:
        st.warning(f"Could not fetch movers data for {index_name} right now. Try again shortly, or pick a different index.")
        return

    total_constituents = len(get_index_constituents(index_name))
    st.caption(f"{result.universe_size} of {total_constituents} constituents with usable live data, as of {result.as_of.strftime('%H:%M:%S')}.")

    col_gain, col_lose = st.columns(2)
    with col_gain:
        st.markdown('<div class="pt-section-label"><span class="pt-live-dot"></span>Top Gainers</div>', unsafe_allow_html=True)
        if not result.gainers:
            st.caption("No gainers right now.")
        for row in result.gainers:
            _render_mover_row(row)
    with col_lose:
        st.markdown('<div class="pt-section-label">Top Losers</div>', unsafe_allow_html=True)
        if not result.losers:
            st.caption("No losers right now.")
        for row in result.losers:
            _render_mover_row(row)


def _chart_base_options(height: int) -> dict:
    return {
        "height": height,
        "layout": {"background": {"type": "solid", "color": ui_theme.BLACK}, "textColor": ui_theme.MUTED},
        "grid": {"vertLines": {"color": ui_theme.BORDER}, "horzLines": {"color": ui_theme.BORDER}},
        "rightPriceScale": {"borderColor": ui_theme.BORDER},
        "timeScale": {"borderColor": ui_theme.BORDER, "timeVisible": True},
    }


def _line_series(times: pd.Series, values: pd.Series, color: str, is_intraday: bool, width: int = 2) -> dict:
    data = []
    for t, v in zip(times, values):
        if pd.isna(v):
            continue
        data.append({"time": int(t.timestamp()) if is_intraday else t.strftime("%Y-%m-%d"), "value": float(v)})
    return {"type": "Line", "data": data, "options": {"color": color, "lineWidth": width}}


def _render_indicator_controls() -> dict:
    """A compact settings panel (checkboxes + period inputs) for every supported indicator.
    Returns a plain dict of the current toggle/period state, read by the chart-building code
    below - kept separate from it so the controls and the math stay easy to reason about
    independently."""
    with st.expander("Indicators", expanded=False):
        st.caption("Overlays draw on the price chart itself; RSI/Stochastic RSI/MACD each get their own panel below it.")
        r1c1, r1c2, r1c3, r1c4 = st.columns(4)
        show_sma = r1c1.checkbox("SMA", key="mkt_show_sma")
        sma_period = r1c1.number_input("SMA period", 2, 200, 20, key="mkt_sma_period", label_visibility="collapsed")
        show_ema = r1c2.checkbox("EMA", key="mkt_show_ema")
        ema_period = r1c2.number_input("EMA period", 2, 200, 20, key="mkt_ema_period", label_visibility="collapsed")
        show_dma = r1c3.checkbox("DMA", key="mkt_show_dma")
        dma_period = r1c3.number_input("DMA period", 2, 200, 20, key="mkt_dma_period", label_visibility="collapsed")
        show_bb = r1c4.checkbox("Bollinger Bands", key="mkt_show_bb")
        bb_period = r1c4.number_input("BB period", 2, 200, 20, key="mkt_bb_period", label_visibility="collapsed")

        r2c1, r2c2, r2c3, _ = st.columns(4)
        show_rsi = r2c1.checkbox("RSI", key="mkt_show_rsi")
        rsi_period = r2c1.number_input("RSI period", 2, 100, 14, key="mkt_rsi_period", label_visibility="collapsed")
        show_stoch = r2c2.checkbox("Stochastic RSI", key="mkt_show_stoch")
        stoch_period = r2c2.number_input("StochRSI period", 2, 100, 14, key="mkt_stoch_period", label_visibility="collapsed")
        show_macd = r2c3.checkbox("MACD", key="mkt_show_macd")

    return {
        "sma": (show_sma, sma_period), "ema": (show_ema, ema_period), "dma": (show_dma, dma_period),
        "bb": (show_bb, bb_period), "rsi": (show_rsi, rsi_period), "stoch": (show_stoch, stoch_period),
        "macd": (show_macd, None),
    }


def _build_charts(
    hist: pd.DataFrame, timeframe: str, indicators: dict,
    transactions: list | None = None, avg_cost: float | None = None,
) -> list[dict]:
    time_col = "Date" if "Date" in hist.columns else "Datetime"
    is_intraday = timeframe not in ("1D", "1W", "1M")
    times = hist[time_col]

    def t(ts):
        return int(ts.timestamp()) if is_intraday else ts.strftime("%Y-%m-%d")

    candles = [
        {"time": t(row[time_col]), "open": row["Open"], "high": row["High"], "low": row["Low"], "close": row["Close"]}
        for _, row in hist.iterrows()
    ]

    # Past trades on this ticker, rendered as arrows directly on the candle they filled at -
    # the component has no separate "annotations" layer, but its series-level `markers` does
    # exactly this (verified against the installed build before relying on it).
    markers = []
    for txn in (transactions or []):
        is_buy = txn.side == "BUY"
        markers.append({
            "time": t(dt.datetime.fromisoformat(txn.timestamp)),
            "position": "belowBar" if is_buy else "aboveBar",
            "color": ui_theme.BULL if is_buy else ui_theme.BEAR,
            "shape": "arrowUp" if is_buy else "arrowDown",
            "text": f"{txn.side} {txn.quantity:g} @ {txn.price:,.2f}",
        })

    overlays = []
    show_sma, sma_period = indicators["sma"]
    if show_sma:
        overlays.append(_line_series(times, ti.sma(hist["Close"], sma_period), ui_theme.NAVY_LIGHT, is_intraday))
    show_ema, ema_period = indicators["ema"]
    if show_ema:
        overlays.append(_line_series(times, ti.ema(hist["Close"], ema_period), ui_theme.CYAN, is_intraday))
    show_dma, dma_period = indicators["dma"]
    if show_dma:
        overlays.append(_line_series(times, ti.dma(hist["Close"], dma_period), ui_theme.WARN, is_intraday))
    show_bb, bb_period = indicators["bb"]
    if show_bb:
        upper, mid, lower = ti.bollinger_bands(hist["Close"], bb_period)
        overlays.append(_line_series(times, upper, ui_theme.MUTED, is_intraday, width=1))
        overlays.append(_line_series(times, mid, ui_theme.MUTED_2, is_intraday, width=1))
        overlays.append(_line_series(times, lower, ui_theme.MUTED, is_intraday, width=1))

    if avg_cost is not None and len(times) > 0:
        # No native horizontal price-line API in this build (checked before relying on it) -
        # a flat two-point Line series across the visible range reads the same way visually.
        overlays.append({
            "type": "Line",
            "data": [{"time": t(times.iloc[0]), "value": avg_cost}, {"time": t(times.iloc[-1]), "value": avg_cost}],
            "options": {"color": ui_theme.MUTED_2, "lineWidth": 1, "lineStyle": 2},
        })

    candlestick_series = {
        "type": "Candlestick",
        "data": candles,
        "options": {
            "upColor": ui_theme.BULL, "downColor": ui_theme.BEAR, "borderVisible": False,
            "wickUpColor": ui_theme.BULL, "wickDownColor": ui_theme.BEAR,
        },
    }
    if markers:
        candlestick_series["markers"] = markers

    main_chart = {
        "chart": {**_chart_base_options(420), "crosshair": {"mode": 0}},
        "series": [candlestick_series, *overlays],
    }
    charts = [main_chart]

    show_rsi, rsi_period = indicators["rsi"]
    if show_rsi:
        rsi_vals = ti.rsi(hist["Close"], rsi_period)
        charts.append({"chart": _chart_base_options(140), "series": [_line_series(times, rsi_vals, ui_theme.WARN, is_intraday)]})

    show_stoch, stoch_period = indicators["stoch"]
    if show_stoch:
        k, d = ti.stoch_rsi(hist["Close"], stoch_period)
        charts.append({
            "chart": _chart_base_options(140),
            "series": [
                _line_series(times, k, ui_theme.NAVY_LIGHT, is_intraday),
                _line_series(times, d, ui_theme.CYAN, is_intraday),
            ],
        })

    show_macd, _ = indicators["macd"]
    if show_macd:
        macd_line, signal_line, _hist_bars = ti.macd(hist["Close"])
        charts.append({
            "chart": _chart_base_options(140),
            "series": [
                _line_series(times, macd_line, ui_theme.NAVY_LIGHT, is_intraday),
                _line_series(times, signal_line, ui_theme.WARN, is_intraday),
            ],
        })

    return charts


def _render_order_toolbar(user_key: str, cash: float, ticker: str, live_price: float | None):
    """A compact Qty | Buy | Sell row that sits directly above the chart, like a broker's own
    chart toolbar, instead of a full order panel scrolled below it. Returns the caller's
    current Holding in this ticker (or None) so render_stock_detail can pass the average cost
    straight into the chart's reference line without a second store lookup."""
    holdings = {h.ticker: h for h in store.get_holdings(user_key)}
    held = holdings.get(ticker)

    tc1, tc2, tc3, tc4 = st.columns([1.1, 0.8, 0.8, 2.3])
    qty = tc1.number_input(
        "Quantity", min_value=0.0, value=0.0, step=1.0, key=f"mkt_qty_{ticker}",
        label_visibility="collapsed", placeholder="Qty",
    )
    can_trade = bool(live_price) and qty > 0
    if tc2.button("Buy", type="primary", use_container_width=True, disabled=not can_trade, key=f"mkt_buy_{ticker}"):
        try:
            store.execute_buy(user_key, ticker, qty, live_price)
            st.toast(f"Bought {qty:g} {ticker} at Rs. {live_price:,.2f}", icon="✅")
            st.rerun()
        except store.TradeError as e:
            st.error(str(e))
    if tc3.button("Sell", use_container_width=True, disabled=not can_trade, key=f"mkt_sell_{ticker}"):
        try:
            store.execute_sell(user_key, ticker, qty, live_price)
            st.toast(f"Sold {qty:g} {ticker} at Rs. {live_price:,.2f}", icon="✅")
            st.rerun()
        except store.TradeError as e:
            st.error(str(e))
    with tc4:
        if held:
            unrealized = (live_price - held.avg_cost) * held.quantity if live_price else None
            unrealized_note = f" | unrealized P&L Rs. {unrealized:,.2f}" if unrealized is not None else ""
            st.caption(f"Position: {held.quantity:g} @ avg Rs. {held.avg_cost:,.2f}{unrealized_note}")
        elif live_price and qty > 0:
            st.caption(f"Order value: Rs. {qty * live_price:,.2f} (cash: Rs. {cash:,.2f})")
        else:
            st.caption("No existing position in this stock.")
    return held


def _render_financials_panel(ticker: str) -> None:
    """
    A TradingView-style "Key facts" block - market cap, valuation ratios, 52-week range,
    sector/industry, and a short business description - so researching a company doesn't mean
    leaving Paper Trading for the DCF tool just to see what it actually does. Everything
    money-shaped is converted to INR (via the same live FX rate quotes.py uses for orders),
    consistent with the rest of this module always pricing in the wallet's own currency rather
    than mixing $ and Rs. figures on the same page.
    """
    st.markdown('<div class="pt-section-label">Financials</div>', unsafe_allow_html=True)
    stats = get_key_stats(ticker)
    if not stats:
        st.caption("Financial data is not available for this ticker right now.")
        return

    fx = get_fx_rate_to_inr(stats["currency"])

    def _pct(v) -> str:
        return f"{v:.2f}%" if v is not None else "n/a"

    def _num(v) -> str:
        return f"{v:,.2f}" if v is not None else "n/a"

    def _inr_money(v) -> str:
        return format_scaled_money((v * fx) / 1_000_000, "INR", symbol_override="Rs.") if v is not None else "n/a"

    def _inr_per_share(v) -> str:
        return format_per_share(v * fx, "INR", symbol_override="Rs.") if v is not None else "n/a"

    facts = [
        ("Market Cap", _inr_money(stats["market_cap"])),
        ("P/E (TTM)", _num(stats["pe_trailing"])),
        ("Forward P/E", _num(stats["pe_forward"])),
        ("EPS (TTM)", _inr_per_share(stats["eps_trailing"])),
        ("Dividend Yield", _pct(stats["dividend_yield"])),
        ("Beta", _num(stats["beta"])),
        ("52W High", _inr_per_share(stats["week52_high"])),
        ("52W Low", _inr_per_share(stats["week52_low"])),
        ("Avg Volume", _fmt_volume(stats["avg_volume"]) if stats["avg_volume"] else "n/a"),
        ("Sector", stats["sector"] or "n/a"),
        ("Industry", stats["industry"] or "n/a"),
        ("Employees", f"{stats['employees']:,}" if stats["employees"] else "n/a"),
    ]
    st.markdown(ui_theme.key_facts_grid_html(facts), unsafe_allow_html=True)

    if stats["summary"]:
        summary = stats["summary"]
        if len(summary) > 420:
            summary = summary[:420].rsplit(" ", 1)[0] + "…"
        st.write("")
        st.caption(summary)
    if stats["website"]:
        st.markdown(f"[Visit website ↗]({stats['website']})")


def _render_drawing_chart(ticker: str, timeframe: str, hist: pd.DataFrame, transactions: list, avg_cost: float | None) -> None:
    """
    A second, hand-built chart with TradingView-style drawing tools (trend line, horizontal
    ray, text note) that the tradeable chart above can't offer: it renders through
    streamlit_lightweight_charts, a pre-built component we only get to configure declaratively
    (candles/lines/markers), not extend with custom mouse-driven interactions.

    Embedding TradingView's own real "Advanced Chart" widget was tried first and abandoned:
    confirmed directly against TradingView's own embed endpoint that NSE (India) symbols are
    blocked on the free public widget ("This symbol is only available on TradingView") while a
    US ticker like AAPL loads fine - since this app's own default watchlist and branding is
    India-first (NIFTY/SENSEX, RELIANCE.NS/TCS.NS/INFY.NS), that would have made drawing tools
    work for a minority of this app's stocks. This chart instead loads TradingView's own
    *open-source* Lightweight Charts library fresh via CDN (not through the Python wrapper
    above) so this app's own code can drive it directly and wire up real click-to-draw tools,
    working identically for every ticker since it's built on this app's own Yahoo Finance data.

    Drawings live only in this component's own iframe, which Streamlit tears down and rebuilds
    on every script rerun (this page's own 25s autorefresh included, same as the tradeable
    chart above already does) - there's no channel back to Python to persist them, since
    st.components.v1.html is one-way. Disclosed in the caption rather than hidden.
    """
    time_col = "Date" if "Date" in hist.columns else "Datetime"
    is_intraday = timeframe not in ("1D", "1W", "1M")
    times = hist[time_col]

    def t(ts):
        return int(ts.timestamp()) if is_intraday else ts.strftime("%Y-%m-%d")

    candles = [
        {
            "time": t(row[time_col]), "open": float(row["Open"]), "high": float(row["High"]),
            "low": float(row["Low"]), "close": float(row["Close"]),
        }
        for _, row in hist.iterrows()
    ]
    trade_markers = []
    for txn in (transactions or []):
        is_buy = txn.side == "BUY"
        trade_markers.append({
            "time": t(dt.datetime.fromisoformat(txn.timestamp)),
            "position": "belowBar" if is_buy else "aboveBar",
            "color": ui_theme.BULL if is_buy else ui_theme.BEAR,
            "shape": "arrowUp" if is_buy else "arrowDown",
            "text": f"{txn.side} {txn.quantity:g} @ {txn.price:,.2f}",
        })
    candles_json = json.dumps(candles)
    trade_markers_json = json.dumps(trade_markers)
    avg_cost_json = json.dumps(float(avg_cost)) if avg_cost is not None else "null"
    container_id = f"draw_{ticker.replace('.', '_').replace('^', '')}_{timeframe}"

    widget_html = f"""
    <style>
      body {{ margin: 0; font-family: 'IBM Plex Sans', -apple-system, sans-serif; }}
      .dtool-bar {{ display: flex; gap: 6px; padding: 6px 0 10px; flex-wrap: wrap; }}
      .dtool-btn {{ background: {ui_theme.PANEL_RAISED}; color: {ui_theme.MUTED}; border: 1px solid {ui_theme.BORDER};
        border-radius: 6px; padding: 6px 12px; font-size: 0.78rem; cursor: pointer; }}
      .dtool-btn.active {{ background: {ui_theme.NAVY_LIGHT}22; color: {ui_theme.NAVY_LIGHT}; border-color: {ui_theme.NAVY_LIGHT}; }}
      .dtool-btn:hover {{ color: {ui_theme.INK}; }}
      .dtool-hint {{ color: {ui_theme.MUTED_2}; font-size: 0.72rem; padding-left: 4px; align-self: center; }}
    </style>
    <div class="dtool-bar">
      <button class="dtool-btn active" id="tool-cursor">Cursor</button>
      <button class="dtool-btn" id="tool-trendline">Trend Line</button>
      <button class="dtool-btn" id="tool-hline">Horizontal Line</button>
      <button class="dtool-btn" id="tool-text">Text</button>
      <button class="dtool-btn" id="tool-clear">Clear All</button>
      <span class="dtool-hint" id="dtool-hint"></span>
    </div>
    <div id="{container_id}" style="height:460px;width:100%"></div>
    <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
    <script>
      const CANDLES = {candles_json};
      const TRADE_MARKERS = {trade_markers_json};
      const AVG_COST = {avg_cost_json};
      const container = document.getElementById("{container_id}");
      const chart = LightweightCharts.createChart(container, {{
        width: container.clientWidth, height: 460,
        layout: {{ background: {{ color: "{ui_theme.BLACK}" }}, textColor: "{ui_theme.MUTED}" }},
        grid: {{ vertLines: {{ color: "{ui_theme.BORDER}" }}, horzLines: {{ color: "{ui_theme.BORDER}" }} }},
        rightPriceScale: {{ borderColor: "{ui_theme.BORDER}" }},
        timeScale: {{ borderColor: "{ui_theme.BORDER}", timeVisible: true }},
        crosshair: {{ mode: 0 }},
      }});
      const candleSeries = chart.addCandlestickSeries({{
        upColor: "{ui_theme.BULL}", downColor: "{ui_theme.BEAR}", borderVisible: false,
        wickUpColor: "{ui_theme.BULL}", wickDownColor: "{ui_theme.BEAR}",
      }});
      candleSeries.setData(CANDLES);
      let textMarkers = [];
      function refreshMarkers() {{ candleSeries.setMarkers([...TRADE_MARKERS, ...textMarkers]); }}
      if (TRADE_MARKERS.length) refreshMarkers();
      if (AVG_COST !== null && CANDLES.length > 0) {{
        const avgSeries = chart.addLineSeries({{ color: "{ui_theme.MUTED_2}", lineWidth: 1, lineStyle: 2 }});
        avgSeries.setData([{{time: CANDLES[0].time, value: AVG_COST}}, {{time: CANDLES[CANDLES.length - 1].time, value: AVG_COST}}]);
      }}
      new ResizeObserver(entries => {{
        chart.applyOptions({{ width: entries[0].contentRect.width }});
      }}).observe(container);

      let activeTool = "cursor";
      let pendingPoint = null;
      let drawnSeries = [];
      const hints = {{
        cursor: "", trendline: "Click a start point, then an end point.",
        hline: "Click a price to draw a horizontal level.", text: "Click a point to add a text note.",
      }};
      function setActiveTool(tool) {{
        activeTool = tool;
        pendingPoint = null;
        document.querySelectorAll(".dtool-btn").forEach(b => b.classList.remove("active"));
        const btn = document.getElementById("tool-" + tool);
        if (btn) btn.classList.add("active");
        document.getElementById("dtool-hint").textContent = hints[tool] || "";
      }}
      document.getElementById("tool-cursor").addEventListener("click", () => setActiveTool("cursor"));
      document.getElementById("tool-trendline").addEventListener("click", () => setActiveTool("trendline"));
      document.getElementById("tool-hline").addEventListener("click", () => setActiveTool("hline"));
      document.getElementById("tool-text").addEventListener("click", () => setActiveTool("text"));
      document.getElementById("tool-clear").addEventListener("click", () => {{
        drawnSeries.forEach(s => chart.removeSeries(s));
        drawnSeries = [];
        textMarkers = [];
        refreshMarkers();
        pendingPoint = null;
      }});

      chart.subscribeClick(param => {{
        if (activeTool === "cursor" || !param.point || !param.time) return;
        const price = candleSeries.coordinateToPrice(param.point.y);
        if (price === null) return;
        const time = param.time;

        if (activeTool === "trendline") {{
          if (!pendingPoint) {{
            pendingPoint = {{ time, price }};
          }} else {{
            const line = chart.addLineSeries({{ color: "{ui_theme.NAVY_LIGHT}", lineWidth: 2 }});
            line.setData([{{ time: pendingPoint.time, value: pendingPoint.price }}, {{ time, value: price }}]);
            drawnSeries.push(line);
            pendingPoint = null;
          }}
        }} else if (activeTool === "hline") {{
          const line = chart.addLineSeries({{ color: "{ui_theme.CYAN}", lineWidth: 1, lineStyle: 2 }});
          line.setData([{{ time: CANDLES[0].time, value: price }}, {{ time: CANDLES[CANDLES.length - 1].time, value: price }}]);
          drawnSeries.push(line);
        }} else if (activeTool === "text") {{
          const label = prompt("Annotation text:");
          if (label) {{
            textMarkers.push({{ time, position: "aboveBar", color: "{ui_theme.WARN}", shape: "circle", text: label }});
            refreshMarkers();
          }}
        }}
      }});
    </script>
    """
    st.components.v1.html(widget_html, height=510, scrolling=False)
    st.caption(
        "Drawn on this app's own live data, so it works the same for every stock. Drawings live only "
        "in this chart and clear whenever the page reruns (switching tabs, the 25s auto-refresh, or "
        "any other action on this page) - a limit of embedding this without a full custom component."
    )


def render_stock_detail(user_key: str, cash: float, ticker: str) -> None:
    st_autorefresh(interval=DETAIL_AUTOREFRESH_MS, key="mkt_detail_autorefresh")

    if st.button("← Back to Movers", key="mkt_back_button"):
        st.session_state.pop("mkt_selected_ticker", None)
        st.session_state.pop("mkt_selected_name", None)
        st.rerun()

    name = st.session_state.get("mkt_selected_name", ticker)
    quotes = get_live_quotes((ticker,))
    q = quotes.get(ticker)

    st.markdown(
        ui_theme.kpi_card(
            f"{name} ({ticker})",
            f"Rs. {q['price']:,.2f}" if q else "n/a",
            icon="trending-up" if (q and q["change"] >= 0) else "trending-down",
            change_pct=(q["change_pct"] * 100) if q else None,
        ),
        unsafe_allow_html=True,
    )
    if not q:
        st.warning(f"Could not fetch a live quote for {ticker} right now.")

    live_price = q["price"] if q else None
    held = _render_order_toolbar(user_key, cash, ticker, live_price)

    st.write("")
    timeframe = st.selectbox("Timeframe", list(TIMEFRAME_PRESETS.keys()), index=4, key="mkt_timeframe")
    indicators = _render_indicator_controls()

    hist = get_ohlc_history(ticker, timeframe)
    if hist.empty:
        st.info(f"No {timeframe} data available for {ticker} right now.")
        return

    transactions = [txn for txn in store.get_transactions(user_key, limit=200) if txn.ticker == ticker]
    charts = _build_charts(hist, timeframe, indicators, transactions=transactions, avg_cost=held.avg_cost if held else None)
    renderLightweightCharts(charts, key=f"mkt_chart_{ticker}_{timeframe}")

    interval, period = TIMEFRAME_PRESETS[timeframe]
    trade_note = " Past trades on this stock show as arrows on their candle" + (
        ", and the dashed line is your average cost." if held else "."
    )
    st.caption(f"Showing {period} of {interval} bars - Yahoo Finance's own maximum lookback at this resolution.{trade_note}")

    with st.expander("🖊️ Draw on Chart — trend lines, horizontal levels, text notes", key=f"mkt_draw_expander_{ticker}"):
        _render_drawing_chart(ticker, timeframe, hist, transactions, held.avg_cost if held else None)

    st.divider()
    _render_financials_panel(ticker)
