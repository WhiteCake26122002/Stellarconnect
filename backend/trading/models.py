"""Data models for the paper-trading feature: virtual accounts, holdings, and
the transactions that move cash into and out of a position. All money here is
simulated - no real order is ever placed, no real cash ever moves."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

STARTING_CASH = 1_000_000.0  # Rs. 10,00,000 virtual starting balance


class TradeUser(BaseModel):
    user_key: str  # stable identity: the viewer's authenticated email on Streamlit Cloud, or a chosen guest name locally
    display_name: str
    cash: float
    created_at: str


class Holding(BaseModel):
    ticker: str
    quantity: float
    avg_cost: float  # volume-weighted average price paid per share, in the ticker's own currency


class Transaction(BaseModel):
    id: int
    user_key: str
    ticker: str
    side: str  # "BUY" | "SELL"
    quantity: float
    price: float
    timestamp: str
    realized_pnl: float | None = None  # set on SELL only


class PortfolioSnapshot(BaseModel):
    user: TradeUser
    holdings: list[Holding]
    holdings_value: float
    net_worth: float
    total_return_pct: float
