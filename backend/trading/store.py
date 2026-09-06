"""
SQLite persistence for the paper-trading feature.

A short-lived connection is opened per call rather than held open across
Streamlit reruns - this is a low-traffic, small-group feature, so the extra
connect/close overhead is negligible and it sidesteps sqlite3's
not-thread-safe-by-default connection objects across Streamlit's session
threads entirely.

Storage caveat (disclosed in the UI too): Streamlit Community Cloud's
filesystem is not durable across app reboots/redeploys on the free tier, so
this SQLite file - and every portfolio in it - resets when the app restarts.
Fine for a friendly paper-trading game; not a place to keep anything that
must survive indefinitely.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .models import STARTING_CASH, Holding, PortfolioSnapshot, Transaction, TradeUser

DB_PATH = Path(__file__).parent / "trading.db"


@contextmanager
def _connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_key TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                cash REAL NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS holdings (
                user_key TEXT NOT NULL REFERENCES users(user_key),
                ticker TEXT NOT NULL,
                quantity REAL NOT NULL,
                avg_cost REAL NOT NULL,
                PRIMARY KEY (user_key, ticker)
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_key TEXT NOT NULL REFERENCES users(user_key),
                ticker TEXT NOT NULL,
                side TEXT NOT NULL,
                quantity REAL NOT NULL,
                price REAL NOT NULL,
                timestamp TEXT NOT NULL,
                realized_pnl REAL
            );
            """
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_user(user_key: str) -> TradeUser | None:
    """Read-only lookup - does NOT create an account. Used to validate a returning player's account
    ID before resuming, so a typo can't silently spin up a phantom new account under the mistyped ID."""
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE user_key = ?", (user_key,)).fetchone()
        if row is None:
            return None
        return TradeUser(user_key=row["user_key"], display_name=row["display_name"], cash=row["cash"], created_at=row["created_at"])


def get_or_create_user(user_key: str, display_name: str) -> TradeUser:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE user_key = ?", (user_key,)).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO users (user_key, display_name, cash, created_at) VALUES (?, ?, ?, ?)",
                (user_key, display_name, STARTING_CASH, _now()),
            )
            return TradeUser(user_key=user_key, display_name=display_name, cash=STARTING_CASH, created_at=_now())
        return TradeUser(user_key=row["user_key"], display_name=row["display_name"], cash=row["cash"], created_at=row["created_at"])


def get_holdings(user_key: str) -> list[Holding]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT ticker, quantity, avg_cost FROM holdings WHERE user_key = ? AND quantity > 0 ORDER BY ticker",
            (user_key,),
        ).fetchall()
        return [Holding(ticker=r["ticker"], quantity=r["quantity"], avg_cost=r["avg_cost"]) for r in rows]


def get_transactions(user_key: str, limit: int = 50) -> list[Transaction]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM transactions WHERE user_key = ? ORDER BY id DESC LIMIT ?",
            (user_key, limit),
        ).fetchall()
        return [
            Transaction(
                id=r["id"], user_key=r["user_key"], ticker=r["ticker"], side=r["side"],
                quantity=r["quantity"], price=r["price"], timestamp=r["timestamp"], realized_pnl=r["realized_pnl"],
            )
            for r in rows
        ]


class TradeError(ValueError):
    """Raised for a rejected order (insufficient cash, insufficient shares, etc.) - always safe to show to the user."""


def execute_buy(user_key: str, ticker: str, quantity: float, price: float) -> None:
    if quantity <= 0:
        raise TradeError("Quantity must be greater than zero.")
    if price is None or price <= 0:
        raise TradeError(f"No valid live price available for {ticker} right now - try again in a moment.")
    cost = quantity * price
    with _connect() as conn:
        user = conn.execute("SELECT cash FROM users WHERE user_key = ?", (user_key,)).fetchone()
        if user is None:
            raise TradeError("Account not found - reload the page.")
        if cost > user["cash"] + 1e-6:
            raise TradeError(f"Insufficient cash: this order costs {cost:,.2f} but you have {user['cash']:,.2f} available.")

        existing = conn.execute(
            "SELECT quantity, avg_cost FROM holdings WHERE user_key = ? AND ticker = ?", (user_key, ticker)
        ).fetchone()
        if existing:
            new_qty = existing["quantity"] + quantity
            new_avg_cost = (existing["quantity"] * existing["avg_cost"] + cost) / new_qty
            conn.execute(
                "UPDATE holdings SET quantity = ?, avg_cost = ? WHERE user_key = ? AND ticker = ?",
                (new_qty, new_avg_cost, user_key, ticker),
            )
        else:
            conn.execute(
                "INSERT INTO holdings (user_key, ticker, quantity, avg_cost) VALUES (?, ?, ?, ?)",
                (user_key, ticker, quantity, price),
            )

        conn.execute("UPDATE users SET cash = cash - ? WHERE user_key = ?", (cost, user_key))
        conn.execute(
            "INSERT INTO transactions (user_key, ticker, side, quantity, price, timestamp) VALUES (?, ?, 'BUY', ?, ?, ?)",
            (user_key, ticker, quantity, price, _now()),
        )


def execute_sell(user_key: str, ticker: str, quantity: float, price: float) -> None:
    if quantity <= 0:
        raise TradeError("Quantity must be greater than zero.")
    if price is None or price <= 0:
        raise TradeError(f"No valid live price available for {ticker} right now - try again in a moment.")
    with _connect() as conn:
        existing = conn.execute(
            "SELECT quantity, avg_cost FROM holdings WHERE user_key = ? AND ticker = ?", (user_key, ticker)
        ).fetchone()
        if existing is None or quantity > existing["quantity"] + 1e-6:
            held = existing["quantity"] if existing else 0.0
            raise TradeError(f"You only hold {held:g} shares of {ticker}, can't sell {quantity:g}.")

        proceeds = quantity * price
        realized_pnl = (price - existing["avg_cost"]) * quantity
        remaining = existing["quantity"] - quantity
        if remaining < 1e-9:
            conn.execute("DELETE FROM holdings WHERE user_key = ? AND ticker = ?", (user_key, ticker))
        else:
            conn.execute(
                "UPDATE holdings SET quantity = ? WHERE user_key = ? AND ticker = ?",
                (remaining, user_key, ticker),
            )

        conn.execute("UPDATE users SET cash = cash + ? WHERE user_key = ?", (proceeds, user_key))
        conn.execute(
            "INSERT INTO transactions (user_key, ticker, side, quantity, price, timestamp, realized_pnl) "
            "VALUES (?, ?, 'SELL', ?, ?, ?, ?)",
            (user_key, ticker, quantity, price, _now(), realized_pnl),
        )


def get_all_users() -> list[TradeUser]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM users").fetchall()
        return [TradeUser(user_key=r["user_key"], display_name=r["display_name"], cash=r["cash"], created_at=r["created_at"]) for r in rows]
