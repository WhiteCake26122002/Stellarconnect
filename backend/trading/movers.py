"""
Top gainers/losers for an NSE index, for the Markets dashboard.

The obvious approach - loop over every constituent calling yfinance's
per-ticker `fast_info` (the pattern `quotes.py` already uses for a 6-ticker
watchlist) - was measured directly against a real 500-ticker index before
writing this: ~20 seconds per 100 tickers, so ~100+ seconds for Nifty 500.
Completely unusable for an interactive page load.

Batched `yf.download(tickers, ..., threads=True)` fetches all ~500 tickers'
last two daily closes in ~11 seconds instead - a ~10x difference - because it
issues one threaded batch request instead of ~500 sequential ones. That's the
only viable way to compute movers for a broad index with this data source,
and it still needs a multi-minute cache (see MOVERS_TTL_* below), not a
20-second one like the watchlist.
"""
from __future__ import annotations

import datetime as dt

import pandas as pd
import streamlit as st
import yfinance as yf
from pydantic import BaseModel

from .index_constituents import get_index_constituents

# Broad indices (Nifty 500/Midcap150/Smallcap250) take longer to fetch and change less
# meaningfully minute-to-minute than a 50-stock index, so they get a longer cache TTL -
# refreshing them every 20s (like the watchlist) would mean an 11s+ blocking fetch on almost
# every rerun, which is a worse experience than a slightly-less-fresh list.
MOVERS_TTL_SMALL_SECONDS = 60  # Nifty 50 / Next 50 / Bank / IT (≤50 tickers, fast)
MOVERS_TTL_LARGE_SECONDS = 5 * 60  # Nifty 500 / Midcap 150 / Smallcap 250
LARGE_INDEX_THRESHOLD = 60


class MoverRow(BaseModel):
    ticker: str  # bare NSE symbol, e.g. "RELIANCE" (not "RELIANCE.NS")
    name: str
    price: float
    change: float
    change_pct: float
    volume: float


class MoversResult(BaseModel):
    gainers: list[MoverRow]
    losers: list[MoverRow]
    as_of: dt.datetime
    universe_size: int  # how many constituents actually had usable data


def _compute_movers(index_name: str, top_n: int) -> MoversResult:
    constituents = get_index_constituents(index_name)
    names_by_symbol = {c["symbol"]: c["name"] for c in constituents}
    tickers = [f"{c['symbol']}.NS" for c in constituents]

    if not tickers:
        return MoversResult(gainers=[], losers=[], as_of=dt.datetime.now(), universe_size=0)

    try:
        data = yf.download(
            tickers, period="5d", interval="1d", group_by="ticker",
            threads=True, progress=False, auto_adjust=False,
        )
    except Exception as e:
        print(f"[movers] yf.download failed for {index_name!r}: {type(e).__name__}: {e}")
        return MoversResult(gainers=[], losers=[], as_of=dt.datetime.now(), universe_size=0)

    rows: list[MoverRow] = []
    for ticker in tickers:
        symbol = ticker.removesuffix(".NS")
        try:
            # yfinance returns a flat frame (no ticker level) when only one ticker's data
            # came back usable, and a (ticker, field) MultiIndex otherwise - handle both.
            sub = data[ticker] if isinstance(data.columns, pd.MultiIndex) else data
            closes = sub["Close"].dropna()
            if len(closes) < 2:
                continue
            prev_close, last_close = float(closes.iloc[-2]), float(closes.iloc[-1])
            if prev_close <= 0:
                continue
            volume = float(sub["Volume"].dropna().iloc[-1]) if "Volume" in sub else 0.0
            change = last_close - prev_close
            rows.append(MoverRow(
                ticker=symbol, name=names_by_symbol.get(symbol, symbol), price=last_close,
                change=change, change_pct=(change / prev_close) * 100, volume=volume,
            ))
        except Exception:
            continue  # one bad/delisted symbol should never take down the whole index's movers

    rows.sort(key=lambda r: r.change_pct, reverse=True)
    gainers = [r for r in rows if r.change_pct > 0][:top_n]
    losers = sorted((r for r in rows if r.change_pct < 0), key=lambda r: r.change_pct)[:top_n]

    return MoversResult(gainers=gainers, losers=losers, as_of=dt.datetime.now(), universe_size=len(rows))


@st.cache_data(ttl=MOVERS_TTL_SMALL_SECONDS, show_spinner=False)
def _get_movers_small(index_name: str, top_n: int) -> MoversResult:
    return _compute_movers(index_name, top_n)


@st.cache_data(ttl=MOVERS_TTL_LARGE_SECONDS, show_spinner=False)
def _get_movers_large(index_name: str, top_n: int) -> MoversResult:
    return _compute_movers(index_name, top_n)


def get_movers(index_name: str, top_n: int = 10) -> MoversResult:
    """Top `top_n` gainers and losers for `index_name` (see index_constituents.INDEX_CSV_URLS
    for supported names). Empty gainers/losers (never an exception) if the index or the
    underlying data fetch is unavailable."""
    constituents = get_index_constituents(index_name)
    if len(constituents) > LARGE_INDEX_THRESHOLD:
        return _get_movers_large(index_name, top_n)
    return _get_movers_small(index_name, top_n)
