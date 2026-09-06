"""
SQLite persistence for the Mutual Fund tracker. Shares the same database
file (and therefore the same `users` table / Account ID system) as the
paper-trading store (backend/trading/store.py) - one account unlocks every
feature mode, this module just adds one more table to that same file.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import date

from ..trading.store import DB_PATH
from .models import MFHolding


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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS mf_holdings (
                user_key TEXT NOT NULL REFERENCES users(user_key),
                scheme_code INTEGER NOT NULL,
                scheme_name TEXT NOT NULL,
                units REAL NOT NULL,
                avg_nav REAL NOT NULL,
                purchase_date TEXT NOT NULL,
                PRIMARY KEY (user_key, scheme_code)
            )
            """
        )


class MFError(ValueError):
    """Raised for a rejected entry (bad units/NAV) - always safe to show to the user."""


def add_holding(
    user_key: str, scheme_code: int, scheme_name: str, units: float, nav: float, purchase_date: str | None = None
) -> None:
    """Adds units of a scheme to the user's tracker, merging into a weighted-average NAV if the
    user already tracks that scheme (e.g. topping up an existing SIP-style holding)."""
    if units <= 0:
        raise MFError("Units must be greater than zero.")
    if nav is None or nav <= 0:
        raise MFError("A valid NAV is required.")
    purchase_date = purchase_date or date.today().isoformat()
    with _connect() as conn:
        existing = conn.execute(
            "SELECT units, avg_nav FROM mf_holdings WHERE user_key = ? AND scheme_code = ?",
            (user_key, scheme_code),
        ).fetchone()
        if existing:
            new_units = existing["units"] + units
            new_avg_nav = (existing["units"] * existing["avg_nav"] + units * nav) / new_units
            conn.execute(
                "UPDATE mf_holdings SET units = ?, avg_nav = ?, scheme_name = ? WHERE user_key = ? AND scheme_code = ?",
                (new_units, new_avg_nav, scheme_name, user_key, scheme_code),
            )
        else:
            conn.execute(
                "INSERT INTO mf_holdings (user_key, scheme_code, scheme_name, units, avg_nav, purchase_date) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (user_key, scheme_code, scheme_name, units, nav, purchase_date),
            )


def remove_holding(user_key: str, scheme_code: int) -> None:
    with _connect() as conn:
        conn.execute(
            "DELETE FROM mf_holdings WHERE user_key = ? AND scheme_code = ?",
            (user_key, scheme_code),
        )


def get_holdings(user_key: str) -> list[MFHolding]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM mf_holdings WHERE user_key = ? ORDER BY scheme_name",
            (user_key,),
        ).fetchall()
        return [
            MFHolding(
                user_key=r["user_key"], scheme_code=r["scheme_code"], scheme_name=r["scheme_name"],
                units=r["units"], avg_nav=r["avg_nav"], purchase_date=r["purchase_date"],
            )
            for r in rows
        ]
