"""
Tests for the mutual-fund persistence layer (backend/mutual_funds/store.py).
Each test points BOTH the mutual-fund store and the trading store (which
owns the shared `users` table) at a fresh temp SQLite file, so these never
touch the real trading.db used by the running app.
"""
import pytest

from ..mutual_funds import store as mf_store
from ..trading import store as trading_store


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test_trading.db"
    monkeypatch.setattr(trading_store, "DB_PATH", db_path)
    monkeypatch.setattr(mf_store, "DB_PATH", db_path)
    trading_store.init_db()
    mf_store.init_db()
    trading_store.get_or_create_user("alice@example.com", "Alice")


def test_new_holding_is_added():
    mf_store.add_holding("alice@example.com", 100027, "Test Fund - Growth", 10, 50.0)
    holdings = mf_store.get_holdings("alice@example.com")
    assert len(holdings) == 1
    assert holdings[0].scheme_code == 100027
    assert holdings[0].units == 10
    assert holdings[0].avg_nav == 50.0


def test_second_purchase_of_same_scheme_uses_weighted_average_nav():
    mf_store.add_holding("alice@example.com", 100027, "Test Fund - Growth", 10, 50.0)  # cost basis 500
    mf_store.add_holding("alice@example.com", 100027, "Test Fund - Growth", 10, 100.0)  # cost basis 1000

    holdings = mf_store.get_holdings("alice@example.com")
    assert len(holdings) == 1
    assert holdings[0].units == 20
    assert holdings[0].avg_nav == pytest.approx(75.0)  # (500 + 1000) / 20


def test_add_holding_rejects_zero_or_negative_units():
    with pytest.raises(mf_store.MFError):
        mf_store.add_holding("alice@example.com", 100027, "Test Fund", 0, 50.0)


def test_add_holding_rejects_missing_nav():
    with pytest.raises(mf_store.MFError, match="valid NAV"):
        mf_store.add_holding("alice@example.com", 100027, "Test Fund", 10, None)


def test_remove_holding_deletes_the_row():
    mf_store.add_holding("alice@example.com", 100027, "Test Fund", 10, 50.0)
    mf_store.remove_holding("alice@example.com", 100027)
    assert mf_store.get_holdings("alice@example.com") == []


def test_holdings_are_isolated_per_user():
    trading_store.get_or_create_user("bob@example.com", "Bob")
    mf_store.add_holding("alice@example.com", 100027, "Test Fund", 10, 50.0)

    assert len(mf_store.get_holdings("alice@example.com")) == 1
    assert mf_store.get_holdings("bob@example.com") == []


def test_holdings_are_sorted_by_scheme_name():
    mf_store.add_holding("alice@example.com", 2, "Zebra Fund", 1, 10.0)
    mf_store.add_holding("alice@example.com", 1, "Alpha Fund", 1, 10.0)

    names = [h.scheme_name for h in mf_store.get_holdings("alice@example.com")]
    assert names == ["Alpha Fund", "Zebra Fund"]
