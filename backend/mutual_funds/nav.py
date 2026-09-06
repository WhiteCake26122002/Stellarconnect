"""
Live NAV data for the Mutual Fund tracker, sourced from mfapi.in - a free
wrapper around AMFI's own daily NAV file (amfiindia.com), the official
source every Indian mutual fund publishes its NAV to once a day. AMFI itself
only exposes that data as one bulk ~40,000-line text dump; mfapi.in
re-publishes the same underlying figures per scheme, which is what makes a
per-scheme lookup and a full searchable scheme list practical here.

Caching mirrors the real update cadence: AMFI (and therefore mfapi) refreshes
NAVs once per business day, so there is no reason to hit the network more
than a few times a day per scheme, or more than once a day for the full
scheme list (which barely changes).
"""
from __future__ import annotations

import datetime as dt

import requests
import streamlit as st
import yfinance as yf

MFAPI_BASE = "https://api.mfapi.in/mf"
SCHEME_LIST_TTL_SECONDS = 24 * 3600
SCHEME_DETAIL_TTL_SECONDS = 6 * 3600
REQUEST_TIMEOUT_SECONDS = 15

# NIFTY 500 - the benchmark index used for the "what if you'd invested in the index instead"
# XIRR comparison. Broader than NIFTY 50, and the same benchmark most Indian portfolio trackers
# compare an actively-managed equity portfolio against.
BENCHMARK_TICKER = "^CRSLDX"
BENCHMARK_TTL_SECONDS = 6 * 3600


@st.cache_data(ttl=SCHEME_LIST_TTL_SECONDS, show_spinner=False)
def get_all_schemes() -> list[dict]:
    """Every AMFI scheme currently tracked by mfapi.in: [{"code": int, "name": str}, ...]."""
    try:
        resp = requests.get(MFAPI_BASE, timeout=REQUEST_TIMEOUT_SECONDS)
        resp.raise_for_status()
        return [
            {"code": row["schemeCode"], "name": row["schemeName"]}
            for row in resp.json()
            if row.get("schemeName")
        ]
    except Exception:
        return []


def search_schemes(query: str, schemes: list[dict], limit: int = 20) -> list[dict]:
    """Case-insensitive substring search over an already-fetched scheme list."""
    q = query.strip().lower()
    if not q:
        return []
    matches = [s for s in schemes if q in s["name"].lower()]
    return matches[:limit]


@st.cache_data(ttl=SCHEME_DETAIL_TTL_SECONDS, show_spinner=False)
def get_scheme_detail(scheme_code: int) -> dict | None:
    """
    {"fund_house", "scheme_category", "scheme_name", "nav_history": [(date, nav), ...]}
    nav_history is sorted most-recent-first. None on any fetch/parse failure.
    """
    try:
        resp = requests.get(f"{MFAPI_BASE}/{scheme_code}", timeout=REQUEST_TIMEOUT_SECONDS)
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("status") != "SUCCESS":
            return None
        meta = payload["meta"]
        history = [
            (dt.datetime.strptime(row["date"], "%d-%m-%Y").date(), float(row["nav"]))
            for row in payload["data"]
            if row.get("nav")
        ]
        history.sort(key=lambda pair: pair[0], reverse=True)
        if not history:
            return None
        return {
            "fund_house": meta.get("fund_house") or "Unknown",
            "scheme_category": meta.get("scheme_category") or "Unknown",
            "scheme_name": meta.get("scheme_name") or str(scheme_code),
            "nav_history": history,
        }
    except Exception:
        return None


@st.cache_data(ttl=BENCHMARK_TTL_SECONDS, show_spinner=False)
def get_benchmark_history() -> list[tuple[dt.date, float]]:
    """Daily NIFTY 500 closing levels over the last 10 years, sorted oldest-first. Empty list on
    failure - callers should treat that as "benchmark comparison unavailable", not crash."""
    try:
        hist = yf.Ticker(BENCHMARK_TICKER).history(period="10y", interval="1d")
        if hist.empty:
            return []
        return [(idx.date(), float(close)) for idx, close in hist["Close"].items()]
    except Exception:
        return []


def latest_nav(detail: dict) -> tuple[dt.date, float]:
    return detail["nav_history"][0]


def trailing_return_pct(detail: dict, days: int) -> float | None:
    """
    % change in NAV over the trailing `days` calendar days. Annualized (CAGR)
    for periods of a year or more, simple % change for shorter ones - matches
    how fund fact sheets usually present 1Y+ vs sub-1Y returns. None if the
    history doesn't reach back far enough.
    """
    history = detail["nav_history"]
    if len(history) < 2:
        return None
    latest_date, latest_price = history[0]
    target_date = latest_date - dt.timedelta(days=days)
    if history[-1][0] > target_date:
        return None  # history doesn't go back far enough for this window
    past_price = next((price for date, price in history if date <= target_date), None)
    if past_price is None or past_price <= 0:
        return None
    growth = latest_price / past_price
    if days >= 365:
        years = days / 365
        return (growth ** (1 / years) - 1) * 100
    return (growth - 1) * 100
