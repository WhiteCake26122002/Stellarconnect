"""
Live company/ticker autocomplete via Yahoo Finance's own search endpoint
(through yfinance's Search class) - backs the search box in both DCF
Valuation and Paper Trading, so typing a company name ("TCS", "Reliance")
resolves to the right suffixed ticker the same way a mainstream finance
site's search box does, instead of requiring the exact ticker up front.

Nothing here is a bundled/static ticker list: every suggestion is a live
Yahoo Finance result, so it stays correct as companies list, delist, or
rename (e.g. Zomato -> Eternal) without this file ever needing an update.
"""
from __future__ import annotations

import streamlit as st
import yfinance as yf

SEARCH_TTL_SECONDS = 24 * 3600
MIN_QUERY_LEN = 2


def _search_companies_uncached(query: str, limit: int) -> list[dict]:
    results = yf.Search(query, max_results=limit, raise_errors=False).quotes
    matches = []
    for r in results:
        if r.get("quoteType") != "EQUITY":
            continue
        symbol = r.get("symbol")
        name = r.get("longname") or r.get("shortname")
        if not symbol or not name:
            continue
        matches.append({"symbol": symbol, "name": name, "exchange": r.get("exchDisp") or r.get("exchange") or ""})
    return matches


@st.cache_data(ttl=SEARCH_TTL_SECONDS, show_spinner=False)
def _search_companies_cached(query: str, limit: int) -> list[dict]:
    return _search_companies_uncached(query, limit)


def search_companies(query: str, limit: int = 6) -> list[dict]:
    """
    Returns up to `limit` equity matches for `query`, each a dict with
    `symbol`, `name`, and `exchange`. Empty list for a too-short query.

    A successful call (even one with zero matches) is cached for a full day -
    tickers don't change often. A failed call (network hiccup, endpoint down)
    is retried on the next keystroke rather than caching an empty result for
    a day, so a transient failure can't make search look permanently broken.
    """
    query = query.strip()
    if len(query) < MIN_QUERY_LEN:
        return []
    try:
        return _search_companies_cached(query, limit)
    except Exception as e:
        print(f"[company_search] search_companies({query!r}) failed: {type(e).__name__}: {e}")
        return []
