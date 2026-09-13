"""
Live per-company beta from Yahoo Finance, for public companies outside India
(India already has a more reliable source: Damodaran's India industry-average
beta table in `backend/data/damodaran_reference.py`).

Checked directly before building this: Yahoo Finance's own `info["beta"]` field
is a plausible 5-year monthly regression beta for US tickers (AAPL ~1.1,
MSFT ~1.1, TSLA ~1.8 - all sane) but is unreliable for Indian tickers (TCS/
Reliance/Infosys all came back an implausible ~0.1-0.2), so this is deliberately
not used as a substitute for the India sector-beta table - only as a fallback
for companies that table doesn't cover.
"""
from __future__ import annotations

import streamlit as st
import yfinance as yf

BETA_TTL_SECONDS = 24 * 3600
MIN_PLAUSIBLE_BETA = 0.0
MAX_PLAUSIBLE_BETA = 5.0


def _fetch_beta(ticker: str) -> float | None:
    try:
        value = yf.Ticker(ticker).info.get("beta")
        if value is None:
            return None
        value = float(value)
        if value <= MIN_PLAUSIBLE_BETA or value > MAX_PLAUSIBLE_BETA:
            return None
        return value
    except Exception:
        return None


@st.cache_data(ttl=BETA_TTL_SECONDS, show_spinner=False)
def _fetch_beta_cached(ticker: str) -> float | None:
    return _fetch_beta(ticker)


def get_live_beta(ticker: str) -> float | None:
    """Yahoo Finance's own reported beta for `ticker`, or None if unavailable/implausible."""
    if not ticker or not ticker.strip():
        return None
    try:
        return _fetch_beta_cached(ticker.strip().upper())
    except Exception as e:
        print(f"[live_beta] get_live_beta({ticker!r}) failed: {type(e).__name__}: {e}")
        return None
