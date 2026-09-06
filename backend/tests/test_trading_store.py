"""
Tests for the paper-trading persistence layer (backend/trading/store.py).
Each test points the store at a fresh temp SQLite file via monkeypatching
DB_PATH, so these never touch the real trading.db used by the running app.
"""
import pytest

from ..trading import store
from ..trading.models import STARTING_CASH


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "test_trading.db")
    store.init_db()


def test_get_user_returns_none_for_unknown_key():
    assert store.get_user("nobody@example.com") is None


def test_get_user_does_not_create_an_account():
    assert store.get_user("ghost@example.com") is None
    assert store.get_all_users() == []


def test_get_user_finds_an_existing_account_without_recreating_it():
    store.get_or_create_user("alice@example.com", "Alice")
    store.execute_buy("alice@example.com", "AAPL", 1, 100.0)

    found = store.get_user("alice@example.com")
    assert found is not None
    assert found.display_name == "Alice"
    assert found.cash == STARTING_CASH - 100.0


def test_new_user_starts_with_starting_cash():
    user = store.get_or_create_user("alice@example.com", "Alice")
    assert user.cash == STARTING_CASH
    assert user.display_name == "Alice"


def test_get_or_create_user_is_idempotent():
    store.get_or_create_user("alice@example.com", "Alice")
    store.execute_buy("alice@example.com", "AAPL", 10, 100.0)
    user_again = store.get_or_create_user("alice@example.com", "Alice")
    assert user_again.cash == STARTING_CASH - 1000.0


def test_buy_deducts_cash_and_creates_holding():
    store.get_or_create_user("alice@example.com", "Alice")
    store.execute_buy("alice@example.com", "AAPL", 10, 150.0)

    user = store.get_or_create_user("alice@example.com", "Alice")
    holdings = store.get_holdings("alice@example.com")
    assert user.cash == pytest.approx(STARTING_CASH - 1500.0)
    assert len(holdings) == 1
    assert holdings[0].ticker == "AAPL"
    assert holdings[0].quantity == 10
    assert holdings[0].avg_cost == pytest.approx(150.0)


def test_second_buy_updates_weighted_average_cost():
    store.get_or_create_user("alice@example.com", "Alice")
    store.execute_buy("alice@example.com", "AAPL", 10, 100.0)  # cost basis 1000
    store.execute_buy("alice@example.com", "AAPL", 10, 200.0)  # cost basis 2000

    holdings = store.get_holdings("alice@example.com")
    assert holdings[0].quantity == 20
    assert holdings[0].avg_cost == pytest.approx(150.0)  # (1000 + 2000) / 20


def test_buy_rejects_insufficient_cash():
    store.get_or_create_user("alice@example.com", "Alice")
    with pytest.raises(store.TradeError, match="Insufficient cash"):
        store.execute_buy("alice@example.com", "AAPL", 1_000_000, 100.0)


def test_buy_rejects_zero_or_negative_quantity():
    store.get_or_create_user("alice@example.com", "Alice")
    with pytest.raises(store.TradeError):
        store.execute_buy("alice@example.com", "AAPL", 0, 100.0)


def test_buy_rejects_missing_price():
    store.get_or_create_user("alice@example.com", "Alice")
    with pytest.raises(store.TradeError, match="No valid live price"):
        store.execute_buy("alice@example.com", "AAPL", 10, None)


def test_sell_credits_cash_and_realizes_pnl():
    store.get_or_create_user("alice@example.com", "Alice")
    store.execute_buy("alice@example.com", "AAPL", 10, 100.0)
    store.execute_sell("alice@example.com", "AAPL", 10, 120.0)

    user = store.get_or_create_user("alice@example.com", "Alice")
    assert user.cash == pytest.approx(STARTING_CASH + 200.0)  # -1000 + 1200
    assert store.get_holdings("alice@example.com") == []

    txns = store.get_transactions("alice@example.com")
    sell_txn = next(t for t in txns if t.side == "SELL")
    assert sell_txn.realized_pnl == pytest.approx(200.0)


def test_partial_sell_keeps_remaining_position_at_same_avg_cost():
    store.get_or_create_user("alice@example.com", "Alice")
    store.execute_buy("alice@example.com", "AAPL", 10, 100.0)
    store.execute_sell("alice@example.com", "AAPL", 4, 120.0)

    holdings = store.get_holdings("alice@example.com")
    assert holdings[0].quantity == 6
    assert holdings[0].avg_cost == pytest.approx(100.0)


def test_sell_rejects_more_shares_than_held():
    store.get_or_create_user("alice@example.com", "Alice")
    store.execute_buy("alice@example.com", "AAPL", 5, 100.0)
    with pytest.raises(store.TradeError, match="only hold"):
        store.execute_sell("alice@example.com", "AAPL", 10, 100.0)


def test_sell_with_no_position_is_rejected():
    store.get_or_create_user("alice@example.com", "Alice")
    with pytest.raises(store.TradeError, match="only hold"):
        store.execute_sell("alice@example.com", "AAPL", 1, 100.0)


def test_transactions_are_returned_most_recent_first():
    store.get_or_create_user("alice@example.com", "Alice")
    store.execute_buy("alice@example.com", "AAPL", 1, 100.0)
    store.execute_buy("alice@example.com", "MSFT", 1, 200.0)

    txns = store.get_transactions("alice@example.com")
    assert [t.ticker for t in txns] == ["MSFT", "AAPL"]


def test_get_all_users_lists_every_account():
    store.get_or_create_user("alice@example.com", "Alice")
    store.get_or_create_user("bob@example.com", "Bob")

    users = {u.user_key for u in store.get_all_users()}
    assert users == {"alice@example.com", "bob@example.com"}


def test_holdings_are_isolated_per_user():
    store.get_or_create_user("alice@example.com", "Alice")
    store.get_or_create_user("bob@example.com", "Bob")
    store.execute_buy("alice@example.com", "AAPL", 5, 100.0)

    assert len(store.get_holdings("alice@example.com")) == 1
    assert store.get_holdings("bob@example.com") == []
