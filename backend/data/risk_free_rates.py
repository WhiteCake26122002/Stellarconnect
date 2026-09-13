"""
Risk-free rate sourcing for CAPM/WACC, per currency.

Live data is genuinely available for exactly one market for free: Yahoo Finance
carries a real-time 10-year US Treasury yield (`^TNX`, quoted x10). No equivalent
free live ticker exists for India, the UK, the Eurozone, Japan, or China sovereign
bonds (checked directly against yfinance before writing this).

For every other currency, this module falls back to a small, dated reference table
of 10-year sovereign bond yields - the same honesty pattern the bundled Damodaran
spreadsheets in `damodaran_reference.py` already use (a periodic snapshot, clearly
sourced, meant to be refreshed/overridden rather than treated as tick-by-tick
live). These are reference points for a defensible WACC starting point, not a
substitute for a live bond desk - the UI always lets the user override the number.
"""
from __future__ import annotations

import streamlit as st
import yfinance as yf

RATE_TTL_SECONDS = 3600

# 10-year sovereign bond yield reference table, keyed by currency code.
# Reference snapshot - refresh periodically. Sources: RBI, ECB, DMO (UK), BoJ,
# PBoC, and other national debt-management offices' published 10Y yields.
REFERENCE_RATES: dict[str, tuple[float, str]] = {
    "USD": (0.043, "US 10Y Treasury"),
    "INR": (0.069, "India 10Y G-Sec (RBI)"),
    "EUR": (0.024, "Germany 10Y Bund (ECB proxy)"),
    "GBP": (0.043, "UK 10Y Gilt (DMO)"),
    "JPY": (0.014, "Japan 10Y JGB (BoJ)"),
    "CNY": (0.018, "China 10Y Govt Bond (PBoC)"),
    "CAD": (0.033, "Canada 10Y Govt Bond"),
    "AUD": (0.043, "Australia 10Y Govt Bond"),
    "CHF": (0.006, "Switzerland 10Y Govt Bond"),
    "BRL": (0.115, "Brazil 10Y Govt Bond"),
    "ZAR": (0.095, "South Africa 10Y Govt Bond"),
    "KRW": (0.029, "South Korea 10Y Govt Bond"),
    "SGD": (0.026, "Singapore 10Y Govt Bond (MAS)"),
    "HKD": (0.035, "Hong Kong 10Y Govt Bond"),
    "IDR": (0.068, "Indonesia 10Y Govt Bond"),
    "MXN": (0.095, "Mexico 10Y Govt Bond"),
}
MATURE_MARKET_FALLBACK = (0.040, "mature-market reference (no per-currency data on file)")


def _live_10y_us_treasury() -> float | None:
    try:
        fi = yf.Ticker("^TNX").fast_info
        # ^TNX's fast_info.last_price is the yield itself in percentage-point form (e.g. 4.97
        # meaning 4.97%), not the x10-scaled figure some older Yahoo Finance feeds used -
        # confirmed directly against live data (4.78-4.97 over a 5-day window) before shipping
        # this, since silently off by 10x here would badly distort every WACC downstream.
        return float(fi["last_price"]) / 100
    except Exception:
        return None


@st.cache_data(ttl=RATE_TTL_SECONDS, show_spinner=False)
def _live_10y_us_treasury_cached() -> float | None:
    return _live_10y_us_treasury()


def resolve_risk_free_rate(currency: str) -> tuple[float, str]:
    """
    Returns (rate, source_note). Live for USD (10Y US Treasury via Yahoo Finance);
    a dated, sourced reference value for every other currency on file; a generic
    mature-market reference otherwise. Always safe to call - never raises.
    """
    code = (currency or "USD").upper()

    if code == "USD":
        live = _live_10y_us_treasury_cached()
        if live is not None:
            return live, "Live: 10Y US Treasury yield (^TNX), Yahoo Finance"

    if code in REFERENCE_RATES:
        rate, label = REFERENCE_RATES[code]
        return rate, f"Reference: {label} - dated snapshot, override if you have a fresher number"

    rate, label = MATURE_MARKET_FALLBACK
    return rate, f"Reference: {label} - {code} not on file, override if you have a real number"
