"""Live NSE / niftyindices / Yahoo checks. Run: pytest -m network"""
from __future__ import annotations

import pytest

from backend.trading.nse_universe import INDEX_SIZE_HINTS, get_universe, reset_universe_cache, search_universe
from backend.trading.yahoo_feed import fetch_ohlc, yahoo_symbol

pytestmark = pytest.mark.network


def test_live_nse_universe_contains_large_mid_small_and_full_board():
    reset_universe_cache()
    payload = get_universe(force=True)
    assert payload["items"], "NSE/niftyindices returned no stocks"
    counts = {entry["name"]: entry["count"] for entry in payload["indices"]}
    for name, (lo, hi) in INDEX_SIZE_HINTS.items():
        assert lo <= counts[name] <= hi, f"{name} count {counts[name]} not in [{lo}, {hi}]"
    symbols = {row["symbol"] for row in payload["items"]}
    assert len(symbols) >= 2000
    assert "RELIANCE" in symbols
    assert "TCS" in symbols
    assert "JKPAPER" in symbols

    nifty50 = next(entry for entry in payload["indices"] if entry["name"] == "Nifty 50")
    assert set(nifty50["symbols"]).issubset(symbols)
    small = next(entry for entry in payload["indices"] if entry["name"] == "Nifty Smallcap 250")
    assert set(small["symbols"]).issubset(symbols)
    mid = next(entry for entry in payload["indices"] if entry["name"] == "Nifty Midcap 150")
    assert set(mid["symbols"]).issubset(symbols)
    large_mid = next(entry for entry in payload["indices"] if entry["name"] == "Nifty LargeMidcap 250")
    assert set(large_mid["symbols"]).issubset(symbols)

    paper = search_universe(payload, q="JKPAPER")
    assert paper["items"][0]["symbol"] == "JKPAPER"
    sample_small = small["symbols"][0]
    found_small = search_universe(payload, q=sample_small)
    assert found_small["items"][0]["symbol"] == sample_small
    assert "Nifty Smallcap 250" in found_small["items"][0]["indices"]


def test_live_yahoo_maps_and_loads_sample_from_each_band():
    reset_universe_cache()
    payload = get_universe()
    by_index = {entry["name"]: entry["symbols"] for entry in payload["indices"]}
    samples = [
        by_index["Nifty 50"][0],
        by_index["Nifty Midcap 150"][0],
        by_index["Nifty LargeMidcap 250"][0],
        by_index["Nifty Smallcap 250"][0],
        "JKPAPER",
    ]
    for desk in samples:
        yahoo = yahoo_symbol(desk)
        assert yahoo == f"{desk}.NS"
        ohlc = fetch_ohlc(desk, "1D")
        assert ohlc["yahoo"] == yahoo
        assert ohlc["candles"], f"Yahoo returned no daily candles for {desk} ({yahoo})"
        last = ohlc["candles"][-1]
        assert last["c"] > 0
