"""
NSE index constituent lists, for the Markets/movers dashboard.

Sourced live from niftyindices.com's own published CSV files (the same index
administrator NSE uses) - a plain, unauthenticated CSV download, not a
scraped or unofficial endpoint. Verified directly against each URL below
before wiring this up. Index composition changes at most quarterly, so a
24-hour cache is appropriate (cheap, and never meaningfully stale).
"""
from __future__ import annotations

import io

import pandas as pd
import requests
import streamlit as st

CONSTITUENTS_TTL_SECONDS = 24 * 3600
_REQUEST_HEADERS = {"User-Agent": "Mozilla/5.0"}

INDEX_CSV_URLS: dict[str, str] = {
    "Nifty 50": "https://niftyindices.com/IndexConstituent/ind_nifty50list.csv",
    "Nifty Next 50": "https://niftyindices.com/IndexConstituent/ind_niftynext50list.csv",
    "Nifty Midcap 50": "https://niftyindices.com/IndexConstituent/ind_niftymidcap50list.csv",
    "Nifty Midcap 100": "https://niftyindices.com/IndexConstituent/ind_niftymidcap100list.csv",
    "Nifty Midcap 150": "https://niftyindices.com/IndexConstituent/ind_niftymidcap150list.csv",
    "Nifty LargeMidcap 250": "https://niftyindices.com/IndexConstituent/ind_niftylargemidcap250list.csv",
    "Nifty Smallcap 50": "https://niftyindices.com/IndexConstituent/ind_niftysmallcap50list.csv",
    "Nifty Smallcap 100": "https://niftyindices.com/IndexConstituent/ind_niftysmallcap100list.csv",
    "Nifty Smallcap 250": "https://niftyindices.com/IndexConstituent/ind_niftysmallcap250list.csv",
    "Nifty MidSmallcap 400": "https://niftyindices.com/IndexConstituent/ind_niftymidsmallcap400list.csv",
    "Nifty 500": "https://niftyindices.com/IndexConstituent/ind_nifty500list.csv",
    "Nifty Total Market": "https://niftyindices.com/IndexConstituent/ind_niftytotalmarket_list.csv",
    "Nifty Bank": "https://niftyindices.com/IndexConstituent/ind_niftybanklist.csv",
    "Nifty IT": "https://niftyindices.com/IndexConstituent/ind_niftyitlist.csv",
}


def _fetch_constituents(index_name: str) -> list[dict]:
    url = INDEX_CSV_URLS.get(index_name)
    if url is None:
        return []
    try:
        resp = requests.get(url, headers=_REQUEST_HEADERS, timeout=15)
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.text))
        return [
            {
                "symbol": str(row["Symbol"]).strip(),
                "name": str(row["Company Name"]).strip(),
                "industry": str(row.get("Industry", "")).strip(),
            }
            for _, row in df.iterrows()
            if pd.notna(row.get("Symbol"))
        ]
    except Exception as e:
        print(f"[index_constituents] fetch({index_name!r}) failed: {type(e).__name__}: {e}")
        return []


@st.cache_data(ttl=CONSTITUENTS_TTL_SECONDS, show_spinner=False)
def get_index_constituents(index_name: str) -> list[dict]:
    """[{"symbol", "name", "industry"}, ...] for `index_name` (see INDEX_CSV_URLS for the
    supported names). Bare NSE symbols, no ".NS" suffix. Empty list on any failure - callers
    should treat that as "index data temporarily unavailable", not crash."""
    return _fetch_constituents(index_name)
