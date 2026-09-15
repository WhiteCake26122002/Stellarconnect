"""
Live price fetching for paper trading, with safeguards against hammering
Yahoo Finance from a shared Streamlit Cloud IP - the same underlying data
source the DCF engine depends on, so an outage here would break that too:

1. `st.cache_data(ttl=...)` caches a quote across ALL sessions on the server,
   not per-viewer - if five people are watching the same ticker, Yahoo gets
   one request per refresh window, not five.
2. Batched fetches (`yf.Tickers`) pull an entire watchlist/portfolio in one
   call instead of one call per ticker.

Every price this module returns is converted to INR. The wallet is a single
INR balance, so a US stock quoted in USD and left unconverted would let you
"buy" $1 worth of AAPL for Rs. 1 - a straight currency-mixing bug, the same
class of bug the DCF engine's ingestion layer already guards against for
ADR-style mismatches. Conversion uses a live spot rate (not a hedge-quality
rate), which is disclosed in the UI.
"""
from __future__ import annotations

import datetime as dt

import pandas as pd
import streamlit as st
import yfinance as yf

QUOTE_TTL_SECONDS = 20
HISTORY_TTL_SECONDS = 60
FX_TTL_SECONDS = 300  # FX moves slowly enough that a 5-minute cache is plenty fresh
PRICE_HISTORY_TTL_SECONDS = 6 * 3600
PRICE_HISTORY_PERIOD = "2y"  # covers both the benchmark "what if" comparison since account
                             # creation and the ~1y window the beta regression uses
KEY_STATS_TTL_SECONDS = 3600  # fundamentals (market cap, P/E, ...) move far slower than price - no need for the 20s quote TTL

NIFTY_TICKER = "^NSEI"
SENSEX_TICKER = "^BSESN"

# Sectoral / volatility indices shown alongside NIFTY and SENSEX in the top bar - the ones an
# Indian retail trader checks most often for a market-mood read at a glance.
SECTOR_INDICES: list[tuple[str, str]] = [
    ("BANK", "^NSEBANK"),
    ("IT", "^CNXIT"),
    ("AUTO", "^CNXAUTO"),
    ("FMCG", "^CNXFMCG"),
    ("PHARMA", "^CNXPHARMA"),
    ("METAL", "^CNXMETAL"),
    ("VIX", "^INDIAVIX"),
]

# Broad-market benchmarks for the portfolio-vs-index comparison and the beta/alpha calculation.
# NIFTY 50 is the default "the market" proxy for beta/alpha; the other three let a user compare
# their return against a broader (500) or size-tilted (mid/small cap) slice of the market too.
BENCHMARK_INDICES: dict[str, str] = {
    "NIFTY 50": NIFTY_TICKER,
    "NIFTY 500": "^CRSLDX",
    "NIFTY MIDCAP 150": "NIFTYMIDCAP150.NS",
    "NIFTY SMALLCAP 250": "NIFTYSMLCAP250.NS",
}


@st.cache_data(ttl=FX_TTL_SECONDS, show_spinner=False)
def get_fx_rate_to_inr(currency: str) -> float:
    """Live spot rate to convert 1 unit of `currency` into INR. 1.0 for INR itself, or on lookup failure."""
    currency = (currency or "INR").upper()
    if currency == "INR":
        return 1.0
    try:
        return float(yf.Ticker(f"{currency}INR=X").fast_info["last_price"])
    except Exception:
        return 1.0  # fail safe to "no conversion" rather than crash a trade - the currency badge still discloses the mismatch


@st.cache_data(ttl=QUOTE_TTL_SECONDS, show_spinner=False)
def get_live_quotes(tickers: tuple[str, ...]) -> dict[str, dict | None]:
    """
    Batched quote lookup, always converted to INR:
    {ticker: {"price", "prev_close", "change", "change_pct", "currency", "fx_rate"}}.
    `price`/`prev_close`/`change` are INR; `currency`/`fx_rate` disclose the
    original currency and the rate used, for tickers that needed converting.
    """
    if not tickers:
        return {}
    quotes: dict[str, dict | None] = {}
    try:
        basket = yf.Tickers(" ".join(tickers))
        for t in tickers:
            try:
                fi = basket.tickers[t].fast_info
                currency = (fi["currency"] or "INR").upper()
                fx_rate = get_fx_rate_to_inr(currency)

                native_price = float(fi["last_price"])
                # NOTE: FastInfo's dict-like `.get()` does NOT apply the same snake_case/camelCase
                # key aliasing that `[]` indexing does (e.g. fi.get("previous_close") silently
                # returns None even though fi["previous_close"] works) - index directly instead.
                try:
                    native_prev = float(fi["previous_close"])
                except Exception:
                    native_prev = native_price

                price = native_price * fx_rate
                prev = native_prev * fx_rate
                change = price - prev
                change_pct = (change / prev) if prev else 0.0
                quotes[t] = {
                    "price": price, "prev_close": prev, "change": change, "change_pct": change_pct,
                    "currency": currency, "fx_rate": fx_rate,
                }
            except Exception:
                quotes[t] = None
    except Exception:
        for t in tickers:
            quotes[t] = None
    return quotes


def get_live_prices(tickers: tuple[str, ...]) -> dict[str, float | None]:
    """INR-converted price-only view of get_live_quotes, for order execution."""
    quotes = get_live_quotes(tickers)
    return {t: (q["price"] if q else None) for t, q in quotes.items()}


@st.cache_data(ttl=HISTORY_TTL_SECONDS, show_spinner=False)
def get_intraday_history(ticker: str) -> pd.DataFrame:
    """Today's minute-by-minute price series for a single ticker (native currency - fine for a shape-only sparkline). Empty frame on failure."""
    try:
        hist = yf.Ticker(ticker).history(period="1d", interval="5m")
        return hist[["Close"]].reset_index() if not hist.empty else pd.DataFrame()
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=PRICE_HISTORY_TTL_SECONDS, show_spinner=False)
def get_price_history(ticker: str, period: str = PRICE_HISTORY_PERIOD) -> list[tuple[dt.date, float]]:
    """
    Daily closing prices for `ticker`, oldest first, in its native currency (no FX conversion -
    the benchmark "what if" comparison and the beta regression only need a series to be
    internally consistent with itself, and adding day-by-day historical FX would need a second
    data source). Empty list on failure.
    """
    try:
        hist = yf.Ticker(ticker).history(period=period, interval="1d")
        if hist.empty:
            return []
        return [(idx.date(), float(close)) for idx, close in hist["Close"].items()]
    except Exception:
        return []


@st.cache_data(ttl=KEY_STATS_TTL_SECONDS, show_spinner=False)
def get_key_stats(ticker: str) -> dict | None:
    """
    A lightweight fundamentals snapshot for a stock detail page's Financials panel - market
    cap, valuation ratios, 52-week range, sector, and a short business description - straight
    from yfinance's `.info`. This is deliberately NOT the DCF engine's full 3-statement
    ingestion (backend.ingestion.yfinance_ingestion.fetch_company): that path is far heavier
    (income statement + balance sheet + cash flow, several seconds per call) and outright
    refuses banks/insurers/NBFCs, which would make "view financials" on a random stock in
    Paper Trading fail for an entire sector. `None` on lookup failure (unknown ticker, no
    `.info` data) - callers should treat that as "financials unavailable", not a crash.
    """
    try:
        info = yf.Ticker(ticker).info
        if not info or info.get("quoteType") is None:
            return None
        return {
            "currency": info.get("currency") or "USD",
            "market_cap": info.get("marketCap"),
            "pe_trailing": info.get("trailingPE"),
            "pe_forward": info.get("forwardPE"),
            "eps_trailing": info.get("trailingEps"),
            "dividend_yield": info.get("dividendYield"),
            "beta": info.get("beta"),
            "week52_high": info.get("fiftyTwoWeekHigh"),
            "week52_low": info.get("fiftyTwoWeekLow"),
            "avg_volume": info.get("averageVolume"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "employees": info.get("fullTimeEmployees"),
            "website": info.get("website"),
            "summary": info.get("longBusinessSummary"),
        }
    except Exception:
        return None


def resolve_company_name(ticker: str) -> str:
    try:
        info = yf.Ticker(ticker).info
        return info.get("shortName") or info.get("longName") or ticker
    except Exception:
        return ticker


def exchange_label(ticker: str) -> str:
    if ticker.endswith(".NS"):
        return "NSE"
    if ticker.endswith(".BO"):
        return "BSE"
    if ticker.startswith("^"):
        return "INDEX"
    return "US"


# UI-facing timeframe label -> (yfinance interval, period) at Yahoo's own safe max lookback
# for that interval. Finer intervals have real Yahoo-imposed lookback caps (1m: ~7d, 5m/15m:
# ~60d, 1h: ~2y) - using anything longer just gets silently truncated by Yahoo, so these are
# each interval's actual usable window, not an arbitrary choice.
TIMEFRAME_PRESETS: dict[str, tuple[str, str]] = {
    "1m": ("1m", "5d"),
    "5m": ("5m", "60d"),
    "15m": ("15m", "60d"),
    "1h": ("1h", "2y"),
    "1D": ("1d", "5y"),
    "1W": ("1wk", "10y"),
    "1M": ("1mo", "max"),
}
OHLC_TTL_INTRADAY_SECONDS = 30  # 1m/5m/15m/1h - close to live
OHLC_TTL_DAILY_SECONDS = 3600  # 1D/1W/1M - changes at most once a session


@st.cache_data(ttl=OHLC_TTL_INTRADAY_SECONDS, show_spinner=False)
def _get_ohlc_history_intraday(ticker: str, interval: str, period: str) -> pd.DataFrame:
    try:
        hist = yf.Ticker(ticker).history(period=period, interval=interval)
        return hist.reset_index() if not hist.empty else pd.DataFrame()
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=OHLC_TTL_DAILY_SECONDS, show_spinner=False)
def _get_ohlc_history_daily(ticker: str, interval: str, period: str) -> pd.DataFrame:
    try:
        hist = yf.Ticker(ticker).history(period=period, interval=interval)
        return hist.reset_index() if not hist.empty else pd.DataFrame()
    except Exception:
        return pd.DataFrame()


def get_ohlc_history(ticker: str, timeframe: str) -> pd.DataFrame:
    """
    Full OHLCV history for `ticker` at one of the TIMEFRAME_PRESETS labels
    ("1m","5m","15m","1h","1D","1W","1M"), each at Yahoo's own safe max lookback for that
    interval. Empty DataFrame (never an exception) if the timeframe is unknown or the fetch
    fails - callers should treat that as "no data available for this timeframe", not a crash.
    Cached separately for intraday vs. daily+ intervals since they warrant very different TTLs.
    """
    preset = TIMEFRAME_PRESETS.get(timeframe)
    if preset is None:
        return pd.DataFrame()
    interval, period = preset
    if timeframe in ("1D", "1W", "1M"):
        return _get_ohlc_history_daily(ticker, interval, period)
    return _get_ohlc_history_intraday(ticker, interval, period)
