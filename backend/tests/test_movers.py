"""
Tests for backend/trading/movers.py - live network (yfinance batch download).
Marked `network`, excluded by default (see pytest.ini); run explicitly with
`pytest -m network`.
"""
import pytest

from ..trading.movers import get_movers

pytestmark = pytest.mark.network


def test_nifty_50_movers_are_sorted_and_shaped_correctly():
    result = get_movers("Nifty 50", top_n=5)
    assert result.universe_size > 40  # allow a handful of bad/missing symbols
    assert len(result.gainers) <= 5
    assert len(result.losers) <= 5

    gainer_pcts = [r.change_pct for r in result.gainers]
    assert gainer_pcts == sorted(gainer_pcts, reverse=True)
    assert all(p > 0 for p in gainer_pcts)

    loser_pcts = [r.change_pct for r in result.losers]
    assert loser_pcts == sorted(loser_pcts)
    assert all(p < 0 for p in loser_pcts)

    gainer_tickers = {r.ticker for r in result.gainers}
    loser_tickers = {r.ticker for r in result.losers}
    assert gainer_tickers.isdisjoint(loser_tickers)


def test_unknown_index_returns_empty_result():
    result = get_movers("Not A Real Index", top_n=5)
    assert result.universe_size == 0
    assert result.gainers == []
    assert result.losers == []
