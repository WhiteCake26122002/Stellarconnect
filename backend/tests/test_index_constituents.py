"""
Tests for backend/trading/index_constituents.py - live network (niftyindices.com
CSV downloads). Marked `network`, excluded by default (see pytest.ini) since these
hit a live external service; run explicitly with `pytest -m network`.
"""
import pytest

from ..trading.index_constituents import INDEX_CSV_URLS, get_index_constituents

pytestmark = pytest.mark.network


@pytest.mark.parametrize("index_name", list(INDEX_CSV_URLS.keys()))
def test_every_supported_index_returns_constituents(index_name):
    constituents = get_index_constituents(index_name)
    assert len(constituents) > 0
    for row in constituents[:5]:
        assert row["symbol"]
        assert row["name"]


def test_nifty_50_has_roughly_fifty_constituents():
    constituents = get_index_constituents("Nifty 50")
    assert 45 <= len(constituents) <= 55


def test_unknown_index_returns_empty_list_not_an_error():
    assert get_index_constituents("Not A Real Index") == []
