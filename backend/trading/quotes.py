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

import pandas as pd
import streamlit as st
import yfinance as yf

QUOTE_TTL_SECONDS = 20
HISTORY_TTL_SECONDS = 60
FX_TTL_SECONDS = 300  # FX moves slowly enough that a 5-minute cache is plenty fresh

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
