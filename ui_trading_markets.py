"""
Markets tab for Paper Trading: gainers/losers across NSE indices, and a
stock detail view with one unified TradingView-style chart - candles,
toggleable technical indicators (overlays + oscillator sub-panes), and a
click-to-draw toolset (trend lines, channels, Fibonacci retracement,
anchored VWAP, a long/short position tool, ...) - plus buy/sell straight
from the toolbar above it.

The chart is hand-built on TradingView's own open-source Lightweight
Charts library, loaded fresh via CDN inside a components.v1.html block,
rather than through the streamlit-lightweight-charts Python wrapper this
module used previously: that wrapper only exposes a declarative
candles/lines/markers config, with no hook for the mouse-driven drawing
interactions below. See _render_unified_chart's own docstring for the
full rationale, including why TradingView's real "Advanced Chart" widget
was tried and abandoned first (it blocks NSE/India symbols on its free
public embed).

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


FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618]


def _render_unified_chart(
    ticker: str, timeframe: str, hist: pd.DataFrame, indicators: dict,
    transactions: list, avg_cost: float | None,
) -> None:
    """
    One chart - candles, every existing indicator (SMA/EMA/DMA/BB overlays; RSI/Stochastic
    RSI/MACD each in their own synced sub-pane below), trade markers, the avg-cost line, and a
    click-to-draw toolset - replacing the split "tradeable chart" + "separate drawing chart"
    this module shipped with initially.

    Hand-built on TradingView's own open-source Lightweight Charts library, loaded fresh via
    CDN inside a components.v1.html block, rather than through the streamlit-lightweight-charts
    Python wrapper this module used previously: that wrapper only takes a declarative
    candles/lines/markers config, with no hook for the mouse-driven drawing tools below.
    (Embedding TradingView's own real "Advanced Chart" widget was tried first and abandoned:
    confirmed directly against TradingView's own embed endpoint that it blocks NSE/India
    symbols on the free public embed - "This symbol is only available on TradingView" - while a
    US ticker loads fine; since this app's own default watchlist is India-first, that would
    have made drawing tools work for a minority of this app's stocks.)

    The drawing toolset is a deliberately-scoped subset of TradingView's own ~190-tool catalog,
    not an attempt at parity with it - that catalog (Elliott Wave, Gann, harmonic patterns,
    pitchforks, auto pattern recognition, volume profile, ...) is itself a multi-year
    proprietary charting product, not something to hand-build here. This covers most of what a
    working trader actually reaches for day to day: trend line, ray, extended line, horizontal
    line/ray, parallel channel, rectangle (zones), Fibonacci retracement, anchored VWAP, and a
    long/short position tool with entry/stop/target and its R:R ratio - plus text notes.

    Every drawing is saved to localStorage (keyed per ticker+timeframe) the moment it's made,
    and the saved set is replayed when the chart (re)loads - this component's iframe is torn
    down and rebuilt fresh on every Streamlit rerun (this page's own 25s autorefresh included),
    which otherwise silently erased anything drawn within seconds, reported directly by the
    user right after that first version shipped. Persistence relies on this iframe being loaded
    via srcdoc with sandbox="allow-same-origin", which per spec gives it the parent page's own
    storage origin rather than an opaque one - confirmed in-browser (drawn, forced a rerun via
    an unrelated click, still there), not just assumed from the spec.
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
    volumes = [float(v) if pd.notna(v) else 0.0 for v in hist["Volume"]] if "Volume" in hist.columns else [0.0] * len(hist)

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

    def series_data(values: pd.Series) -> list[dict]:
        out = []
        for ts, v in zip(times, values):
            if pd.isna(v):
                continue
            out.append({"time": t(ts), "value": float(v)})
        return out

    overlays = []
    show_sma, sma_period = indicators["sma"]
    if show_sma:
        overlays.append((series_data(ti.sma(hist["Close"], sma_period)), ui_theme.NAVY_LIGHT, 2))
    show_ema, ema_period = indicators["ema"]
    if show_ema:
        overlays.append((series_data(ti.ema(hist["Close"], ema_period)), ui_theme.CYAN, 2))
    show_dma, dma_period = indicators["dma"]
    if show_dma:
        overlays.append((series_data(ti.dma(hist["Close"], dma_period)), ui_theme.WARN, 2))
    show_bb, bb_period = indicators["bb"]
    if show_bb:
        upper, mid, lower = ti.bollinger_bands(hist["Close"], bb_period)
        overlays.append((series_data(upper), ui_theme.MUTED, 1))
        overlays.append((series_data(mid), ui_theme.MUTED_2, 1))
        overlays.append((series_data(lower), ui_theme.MUTED, 1))

    oscillators = []
    show_rsi, rsi_period = indicators["rsi"]
    if show_rsi:
        oscillators.append(("RSI", [(series_data(ti.rsi(hist["Close"], rsi_period)), ui_theme.WARN, 2)]))
    show_stoch, stoch_period = indicators["stoch"]
    if show_stoch:
        k, d = ti.stoch_rsi(hist["Close"], stoch_period)
        oscillators.append(("Stochastic RSI", [(series_data(k), ui_theme.NAVY_LIGHT, 2), (series_data(d), ui_theme.CYAN, 2)]))
    show_macd, _ = indicators["macd"]
    if show_macd:
        macd_line, signal_line, _hist_bars = ti.macd(hist["Close"])
        oscillators.append(("MACD", [(series_data(macd_line), ui_theme.NAVY_LIGHT, 2), (series_data(signal_line), ui_theme.WARN, 2)]))

    candles_json = json.dumps(candles)
    volumes_json = json.dumps(volumes)
    trade_markers_json = json.dumps(trade_markers)
    avg_cost_json = json.dumps(float(avg_cost)) if avg_cost is not None else "null"
    overlays_json = json.dumps([{"data": data, "color": color, "width": width} for data, color, width in overlays])
    oscillators_json = json.dumps([
        {"title": title, "series": [{"data": data, "color": color, "width": width} for data, color, width in series_list]}
        for title, series_list in oscillators
    ])
    fib_levels_json = json.dumps(FIB_LEVELS)
    container_id = f"chart_{ticker.replace('.', '_').replace('^', '')}_{timeframe}"
    total_height = 90 + 460 + len(oscillators) * 172 + 40

    widget_html = f"""
    <style>
      body {{ margin: 0; font-family: 'IBM Plex Sans', -apple-system, sans-serif; }}
      .dtool-bar {{ display: flex; gap: 6px; padding: 6px 0 10px; flex-wrap: wrap; align-items: center; }}
      .dtool-select, .dtool-btn {{ background: {ui_theme.PANEL_RAISED}; color: {ui_theme.MUTED}; border: 1px solid {ui_theme.BORDER};
        border-radius: 6px; padding: 6px 10px; font-size: 0.78rem; cursor: pointer; font-family: inherit; }}
      .dtool-btn:hover {{ color: {ui_theme.INK}; }}
      .dtool-hint {{ color: {ui_theme.MUTED_2}; font-size: 0.72rem; padding-left: 4px; }}
      .osc-label {{ font-size: 0.72rem; color: {ui_theme.MUTED_2}; margin: 8px 0 2px; }}
    </style>
    <div class="dtool-bar">
      <select class="dtool-select" id="tool-select">
        <option value="cursor">Cursor</option>
        <option value="trendline">Trend Line</option>
        <option value="ray">Ray</option>
        <option value="extline">Extended Line</option>
        <option value="hline">Horizontal Line</option>
        <option value="hray">Horizontal Ray</option>
        <option value="channel">Parallel Channel</option>
        <option value="rect">Rectangle</option>
        <option value="fib">Fibonacci Retracement</option>
        <option value="vwap">Anchored VWAP</option>
        <option value="longpos">Long Position</option>
        <option value="shortpos">Short Position</option>
        <option value="text">Text</option>
      </select>
      <button class="dtool-btn" id="tool-undo">Undo</button>
      <button class="dtool-btn" id="tool-clear">Clear All</button>
      <span class="dtool-hint" id="dtool-hint"></span>
    </div>
    <div id="{container_id}" style="height:460px;width:100%"></div>
    <div id="{container_id}_osc"></div>
    <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
    <script>
      const CANDLES = {candles_json};
      const VOLUMES = {volumes_json};
      const TRADE_MARKERS = {trade_markers_json};
      const AVG_COST = {avg_cost_json};
      const OVERLAYS = {overlays_json};
      const OSCILLATORS = {oscillators_json};
      const FIB_LEVELS = {fib_levels_json};
      const STORAGE_KEY = "pt_drawings::{container_id}";
      const FIRST_TIME = CANDLES.length ? CANDLES[0].time : null;
      const LAST_TIME = CANDLES.length ? CANDLES[CANDLES.length - 1].time : null;

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
        avgSeries.setData([{{ time: FIRST_TIME, value: AVG_COST }}, {{ time: LAST_TIME, value: AVG_COST }}]);
      }}
      OVERLAYS.forEach(o => {{
        const s = chart.addLineSeries({{ color: o.color, lineWidth: o.width }});
        s.setData(o.data);
      }});
      new ResizeObserver(entries => {{
        chart.applyOptions({{ width: entries[0].contentRect.width }});
      }}).observe(container);

      // Oscillator sub-panes (RSI/Stochastic RSI/MACD) - separate mini charts stacked below,
      // time-scale-synced to the main pane both ways, the same way any multi-pane charting UI
      // keeps its panes moving together.
      const oscHost = document.getElementById("{container_id}_osc");
      const subCharts = [];
      OSCILLATORS.forEach(osc => {{
        const label = document.createElement("div");
        label.className = "osc-label";
        label.textContent = osc.title;
        oscHost.appendChild(label);
        const paneDiv = document.createElement("div");
        paneDiv.style.height = "150px";
        paneDiv.style.width = "100%";
        oscHost.appendChild(paneDiv);
        const sc = LightweightCharts.createChart(paneDiv, {{
          width: paneDiv.clientWidth, height: 150,
          layout: {{ background: {{ color: "{ui_theme.BLACK}" }}, textColor: "{ui_theme.MUTED}" }},
          grid: {{ vertLines: {{ color: "{ui_theme.BORDER}" }}, horzLines: {{ color: "{ui_theme.BORDER}" }} }},
          rightPriceScale: {{ borderColor: "{ui_theme.BORDER}" }},
          timeScale: {{ borderColor: "{ui_theme.BORDER}", timeVisible: true }},
        }});
        osc.series.forEach(spec => {{
          const s = sc.addLineSeries({{ color: spec.color, lineWidth: spec.width }});
          s.setData(spec.data);
        }});
        subCharts.push(sc);
        new ResizeObserver(entries => sc.applyOptions({{ width: entries[0].contentRect.width }})).observe(paneDiv);
      }});
      let syncingPanes = false;
      function syncFrom(source) {{
        if (syncingPanes) return;
        syncingPanes = true;
        const range = source.timeScale().getVisibleLogicalRange();
        if (range) {{
          [chart, ...subCharts].forEach(c => {{ if (c !== source) c.timeScale().setVisibleLogicalRange(range); }});
        }}
        syncingPanes = false;
      }}
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => syncFrom(chart));
      subCharts.forEach(sc => sc.timeScale().subscribeVisibleLogicalRangeChange(() => syncFrom(sc)));

      // --- Drawing tools -----------------------------------------------------------------
      function timeToIndex(time) {{
        for (let i = 0; i < CANDLES.length; i++) {{ if (CANDLES[i].time === time) return i; }}
        return -1;
      }}
      function timeIsBefore(a, b) {{ return timeToIndex(a) <= timeToIndex(b); }}
      function priceAt(p1, p2, targetTime) {{
        const i1 = timeToIndex(p1.time), i2 = timeToIndex(p2.time), it = timeToIndex(targetTime);
        if (i1 < 0 || i2 < 0 || it < 0 || i1 === i2) return p2.price;
        const slope = (p2.price - p1.price) / (i2 - i1);
        return p1.price + slope * (it - i1);
      }}

      let saved = [];
      try {{ saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }} catch (e) {{ saved = []; }}
      let drawnSeries = [];
      let drawnPriceLines = [];

      function persist() {{
        try {{ localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }} catch (e) {{ /* storage unavailable - drawing still works this session */ }}
      }}

      function paintDrawing(d) {{
        if (d.type === "trendline") {{
          const s = chart.addLineSeries({{ color: "{ui_theme.NAVY_LIGHT}", lineWidth: 2 }});
          s.setData([{{ time: d.p1.time, value: d.p1.price }}, {{ time: d.p2.time, value: d.p2.price }}]);
          drawnSeries.push(s);
        }} else if (d.type === "ray") {{
          const extPrice = priceAt(d.p1, d.p2, LAST_TIME);
          const s = chart.addLineSeries({{ color: "{ui_theme.NAVY_LIGHT}", lineWidth: 2 }});
          s.setData([{{ time: d.p1.time, value: d.p1.price }}, {{ time: LAST_TIME, value: extPrice }}]);
          drawnSeries.push(s);
        }} else if (d.type === "extline") {{
          const rightPrice = priceAt(d.p1, d.p2, LAST_TIME);
          const leftPrice = priceAt(d.p2, d.p1, FIRST_TIME);
          const s = chart.addLineSeries({{ color: "{ui_theme.NAVY_LIGHT}", lineWidth: 1, lineStyle: 1 }});
          s.setData([{{ time: FIRST_TIME, value: leftPrice }}, {{ time: LAST_TIME, value: rightPrice }}]);
          drawnSeries.push(s);
        }} else if (d.type === "hline") {{
          const pl = candleSeries.createPriceLine({{
            price: d.price, color: "{ui_theme.CYAN}", lineWidth: 1, lineStyle: 2,
            axisLabelVisible: true, title: "Level",
          }});
          drawnPriceLines.push(pl);
        }} else if (d.type === "hray") {{
          const s = chart.addLineSeries({{ color: "{ui_theme.CYAN}", lineWidth: 1, lineStyle: 2 }});
          s.setData([{{ time: d.time, value: d.price }}, {{ time: LAST_TIME, value: d.price }}]);
          drawnSeries.push(s);
        }} else if (d.type === "channel") {{
          const s1 = chart.addLineSeries({{ color: "{ui_theme.NAVY_LIGHT}", lineWidth: 2 }});
          s1.setData([{{ time: d.p1.time, value: d.p1.price }}, {{ time: d.p2.time, value: d.p2.price }}]);
          drawnSeries.push(s1);
          const s2 = chart.addLineSeries({{ color: "{ui_theme.NAVY_LIGHT}", lineWidth: 1, lineStyle: 2 }});
          s2.setData([{{ time: d.p1.time, value: d.p1.price + d.offset }}, {{ time: d.p2.time, value: d.p2.price + d.offset }}]);
          drawnSeries.push(s2);
        }} else if (d.type === "rect") {{
          const top = Math.max(d.p1.price, d.p2.price);
          const bottom = Math.min(d.p1.price, d.p2.price);
          const first = timeIsBefore(d.p1.time, d.p2.time) ? d.p1.time : d.p2.time;
          const last = timeIsBefore(d.p1.time, d.p2.time) ? d.p2.time : d.p1.time;
          const area = chart.addAreaSeries({{
            topColor: "rgba(166,132,255,0.28)", bottomColor: "rgba(166,132,255,0.06)",
            lineColor: "{ui_theme.NAVY_LIGHT}", lineWidth: 1, baseValue: {{ type: "price", price: bottom }},
          }});
          area.setData([{{ time: first, value: top }}, {{ time: last, value: top }}]);
          drawnSeries.push(area);
        }} else if (d.type === "fib") {{
          FIB_LEVELS.forEach(pct => {{
            const price = d.p1.price + (d.p2.price - d.p1.price) * pct;
            const pl = candleSeries.createPriceLine({{
              price, color: "{ui_theme.WARN}", lineWidth: 1, lineStyle: 2,
              axisLabelVisible: true, title: (pct * 100).toFixed(1) + "%",
            }});
            drawnPriceLines.push(pl);
          }});
        }} else if (d.type === "vwap") {{
          const idx = timeToIndex(d.anchorTime);
          if (idx < 0) return;
          let cumPV = 0, cumV = 0;
          const data = [];
          for (let i = idx; i < CANDLES.length; i++) {{
            const c = CANDLES[i];
            const typical = (c.high + c.low + c.close) / 3;
            const vol = VOLUMES[i] || 0;
            cumPV += typical * vol; cumV += vol;
            data.push({{ time: c.time, value: cumV > 0 ? cumPV / cumV : typical }});
          }}
          const s = chart.addLineSeries({{ color: "{ui_theme.WARN}", lineWidth: 2 }});
          s.setData(data);
          drawnSeries.push(s);
        }} else if (d.type === "position") {{
          const idx = timeToIndex(d.entryTime);
          if (idx < 0) return;
          const endTime = CANDLES[Math.min(idx + 20, CANDLES.length - 1)].time;
          const riskArea = chart.addAreaSeries({{
            topColor: "rgba(255,138,118,0.32)", bottomColor: "rgba(0,0,0,0)",
            lineColor: "rgba(0,0,0,0)", lineWidth: 1, baseValue: {{ type: "price", price: d.entry }},
          }});
          riskArea.setData([{{ time: d.entryTime, value: d.stop }}, {{ time: endTime, value: d.stop }}]);
          drawnSeries.push(riskArea);
          const rewardArea = chart.addAreaSeries({{
            topColor: "rgba(95,224,168,0.32)", bottomColor: "rgba(0,0,0,0)",
            lineColor: "rgba(0,0,0,0)", lineWidth: 1, baseValue: {{ type: "price", price: d.entry }},
          }});
          rewardArea.setData([{{ time: d.entryTime, value: d.target }}, {{ time: endTime, value: d.target }}]);
          drawnSeries.push(rewardArea);
          const rr = Math.abs(d.target - d.entry) / (Math.abs(d.entry - d.stop) || 1);
          const pl = candleSeries.createPriceLine({{
            price: d.entry, color: "{ui_theme.INK}", lineWidth: 1, lineStyle: 0, axisLabelVisible: true,
            title: (d.side === "long" ? "Long" : "Short") + " entry (R:R " + rr.toFixed(2) + ")",
          }});
          drawnPriceLines.push(pl);
        }} else if (d.type === "text") {{
          textMarkers.push({{ time: d.time, position: "aboveBar", color: "{ui_theme.WARN}", shape: "circle", text: d.text }});
          refreshMarkers();
        }}
      }}

      function redrawAll() {{
        drawnSeries.forEach(s => chart.removeSeries(s));
        drawnSeries = [];
        drawnPriceLines.forEach(pl => candleSeries.removePriceLine(pl));
        drawnPriceLines = [];
        textMarkers = [];
        for (const d of saved) paintDrawing(d);
        refreshMarkers();
      }}
      for (const d of saved) paintDrawing(d);

      const CLICKS_NEEDED = {{
        cursor: 0, trendline: 2, ray: 2, extline: 2, hline: 1, hray: 1,
        channel: 3, rect: 2, fib: 2, vwap: 1, longpos: 1, shortpos: 1, text: 1,
      }};
      const HINTS = {{
        cursor: "", trendline: "Click a start point, then an end point.",
        ray: "Click a start point, then a second - the line extends past it.",
        extline: "Click two points - the line extends beyond both.",
        hline: "Click a price for a level across the whole chart.",
        hray: "Click a point - the level extends only to the right.",
        channel: "Click two points for the trend line, then a third for the channel width.",
        rect: "Click one corner, then the opposite corner.",
        fib: "Click the swing high, then the swing low (or reverse).",
        vwap: "Click a bar to anchor VWAP from that point forward.",
        longpos: "Click your entry point, then enter stop-loss and target.",
        shortpos: "Click your entry point, then enter stop-loss and target.",
        text: "Click a point to add a text note.",
      }};
      let activeTool = "cursor";
      let clickBuffer = [];
      document.getElementById("dtool-hint").textContent = HINTS.cursor;
      document.getElementById("tool-select").addEventListener("change", e => {{
        activeTool = e.target.value;
        clickBuffer = [];
        document.getElementById("dtool-hint").textContent = HINTS[activeTool] || "";
      }});
      document.getElementById("tool-undo").addEventListener("click", () => {{
        if (!saved.length) return;
        saved.pop();
        redrawAll();
        persist();
      }});
      document.getElementById("tool-clear").addEventListener("click", () => {{
        saved = [];
        redrawAll();
        persist();
      }});

      function finalizeDrawing() {{
        const pts = clickBuffer;
        let d = null;
        if (activeTool === "trendline") d = {{ type: "trendline", p1: pts[0], p2: pts[1] }};
        else if (activeTool === "ray") d = {{ type: "ray", p1: pts[0], p2: pts[1] }};
        else if (activeTool === "extline") d = {{ type: "extline", p1: pts[0], p2: pts[1] }};
        else if (activeTool === "hline") d = {{ type: "hline", price: pts[0].price }};
        else if (activeTool === "hray") d = {{ type: "hray", time: pts[0].time, price: pts[0].price }};
        else if (activeTool === "channel") {{
          const onLine = priceAt(pts[0], pts[1], pts[2].time);
          d = {{ type: "channel", p1: pts[0], p2: pts[1], offset: pts[2].price - onLine }};
        }} else if (activeTool === "rect") d = {{ type: "rect", p1: pts[0], p2: pts[1] }};
        else if (activeTool === "fib") d = {{ type: "fib", p1: pts[0], p2: pts[1] }};
        else if (activeTool === "vwap") d = {{ type: "vwap", anchorTime: pts[0].time }};
        else if (activeTool === "longpos" || activeTool === "shortpos") {{
          const stop = parseFloat(prompt("Stop-loss price:"));
          const target = parseFloat(prompt("Take-profit price:"));
          if (!isFinite(stop) || !isFinite(target)) {{ clickBuffer = []; return; }}
          d = {{
            type: "position", side: activeTool === "longpos" ? "long" : "short",
            entryTime: pts[0].time, entry: pts[0].price, stop, target,
          }};
        }} else if (activeTool === "text") {{
          const label = prompt("Annotation text:");
          if (!label) {{ clickBuffer = []; return; }}
          d = {{ type: "text", time: pts[0].time, text: label }};
        }}
        if (d) {{
          paintDrawing(d);
          saved.push(d);
          persist();
        }}
        clickBuffer = [];
      }}

      chart.subscribeClick(param => {{
        if (activeTool === "cursor" || !param.point || !param.time) return;
        const price = candleSeries.coordinateToPrice(param.point.y);
        if (price === null) return;
        clickBuffer.push({{ time: param.time, price }});
        if (clickBuffer.length >= CLICKS_NEEDED[activeTool]) finalizeDrawing();
      }});
    </script>
    """
    st.components.v1.html(widget_html, height=total_height, scrolling=False)
    st.caption(
        "Trend line, ray, extended line, horizontal line/ray, parallel channel, rectangle, "
        "Fibonacci retracement, anchored VWAP, and a long/short position tool - a working "
        "subset of TradingView's own drawing catalog, not full parity with it. Drawings are "
        "saved per stock and timeframe in this browser and stay put across refreshes and tab "
        "switches; clearing the browser's site data (or a different browser/device) starts fresh."
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
    _render_unified_chart(ticker, timeframe, hist, indicators, transactions, held.avg_cost if held else None)

    interval, period = TIMEFRAME_PRESETS[timeframe]
    trade_note = " Past trades on this stock show as arrows on their candle" + (
        ", and the dashed line is your average cost." if held else "."
    )
    st.caption(f"Showing {period} of {interval} bars - Yahoo Finance's own maximum lookback at this resolution.{trade_note}")

    st.divider()
    _render_financials_panel(ticker)
