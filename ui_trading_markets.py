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

import pandas as pd
import streamlit as st
from streamlit_autorefresh import st_autorefresh
from streamlit_lightweight_charts import renderLightweightCharts

import ui_theme
from backend.trading import store
from backend.trading import technical_indicators as ti
from backend.trading.index_constituents import INDEX_CSV_URLS, get_index_constituents
from backend.trading.movers import MoverRow, get_movers
from backend.trading.quotes import TIMEFRAME_PRESETS, get_live_quotes, get_ohlc_history

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


def render_movers_tab(user_key: str, cash: float) -> None:
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


def _build_charts(hist: pd.DataFrame, timeframe: str, indicators: dict) -> list[dict]:
    time_col = "Date" if "Date" in hist.columns else "Datetime"
    is_intraday = timeframe not in ("1D", "1W", "1M")
    times = hist[time_col]

    def t(ts):
        return int(ts.timestamp()) if is_intraday else ts.strftime("%Y-%m-%d")

    candles = [
        {"time": t(row[time_col]), "open": row["Open"], "high": row["High"], "low": row["Low"], "close": row["Close"]}
        for _, row in hist.iterrows()
    ]

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

    main_chart = {
        "chart": {**_chart_base_options(420), "crosshair": {"mode": 0}},
        "series": [
            {
                "type": "Candlestick",
                "data": candles,
                "options": {
                    "upColor": ui_theme.BULL, "downColor": ui_theme.BEAR, "borderVisible": False,
                    "wickUpColor": ui_theme.BULL, "wickDownColor": ui_theme.BEAR,
                },
            },
            *overlays,
        ],
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


def _render_order_panel(user_key: str, cash: float, ticker: str, live_price: float | None) -> None:
    st.markdown('<div class="pt-section-label">Place an Order</div>', unsafe_allow_html=True)
    holdings = {h.ticker: h for h in store.get_holdings(user_key)}
    held = holdings.get(ticker)

    c1, c2, c3 = st.columns([1, 1, 2])
    c1.metric("Live Price", f"Rs. {live_price:,.2f}" if live_price else "n/a")
    qty = c2.number_input("Quantity", min_value=0.0, value=0.0, step=1.0, key=f"mkt_qty_{ticker}")
    with c3:
        if held:
            unrealized = (live_price - held.avg_cost) * held.quantity if live_price else None
            unrealized_note = f" - unrealized P&L Rs. {unrealized:,.2f}" if unrealized is not None else ""
            st.caption(f"Current position: {held.quantity:g} @ avg Rs. {held.avg_cost:,.2f}{unrealized_note}")
        else:
            st.caption("No existing position in this stock.")
        if live_price and qty > 0:
            st.caption(f"Order value: Rs. {qty * live_price:,.2f} (cash available: Rs. {cash:,.2f})")

    can_trade = bool(live_price) and qty > 0
    bcol, scol = st.columns(2)
    if bcol.button("Buy", type="primary", use_container_width=True, disabled=not can_trade, key=f"mkt_buy_{ticker}"):
        try:
            store.execute_buy(user_key, ticker, qty, live_price)
            st.toast(f"Bought {qty:g} {ticker} at Rs. {live_price:,.2f}", icon="✅")
            st.rerun()
        except store.TradeError as e:
            st.error(str(e))
    if scol.button("Sell", use_container_width=True, disabled=not can_trade, key=f"mkt_sell_{ticker}"):
        try:
            store.execute_sell(user_key, ticker, qty, live_price)
            st.toast(f"Sold {qty:g} {ticker} at Rs. {live_price:,.2f}", icon="✅")
            st.rerun()
        except store.TradeError as e:
            st.error(str(e))


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

    st.write("")
    timeframe = st.selectbox("Timeframe", list(TIMEFRAME_PRESETS.keys()), index=4, key="mkt_timeframe")
    indicators = _render_indicator_controls()

    hist = get_ohlc_history(ticker, timeframe)
    if hist.empty:
        st.info(f"No {timeframe} data available for {ticker} right now.")
        return

    charts = _build_charts(hist, timeframe, indicators)
    renderLightweightCharts(charts, key=f"mkt_chart_{ticker}_{timeframe}")

    interval, period = TIMEFRAME_PRESETS[timeframe]
    st.caption(f"Showing {period} of {interval} bars - Yahoo Finance's own maximum lookback at this resolution.")

    st.write("")
    _render_order_panel(user_key, cash, ticker, q["price"] if q else None)
