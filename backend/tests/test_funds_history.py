"""The NAV history a fund page draws: thinned for size, never invented, benchmark only when one exists."""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from ..api.config import get_settings
from ..api.db import reset_engine
from ..api.main import create_app
from ..api.routers import funds as funds_router
from ..mutual_funds import nav

CODE = 119598


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'api.db').as_posix()}")
    get_settings.cache_clear()
    reset_engine()
    with TestClient(create_app()) as c:
        c.post("/v1/auth/register", json={"email": "hist@example.com", "password": "password1", "display_name": "Hist"})
        yield c
    get_settings.cache_clear()
    reset_engine()


def _detail(days: int, category: str = "Equity Scheme - Flexi Cap Fund"):
    today = dt.date.today()
    hist = [(today - dt.timedelta(days=i), 100.0 + (days - i) * 0.1) for i in range(days + 1)]  # newest first, like the feed
    return {"fund_house": "HDFC Mutual Fund", "scheme_category": category, "scheme_name": "HDFC Flexi Cap Fund - Direct Growth", "nav_history": hist}


def test_thin_keeps_recent_days_and_one_mark_per_old_week():
    today = dt.date.today()
    history = [(today - dt.timedelta(days=i), float(i)) for i in range(2000, -1, -1)]  # oldest first
    thin = funds_router._thin(history)
    assert thin[-1] == history[-1]  # the latest mark survives
    recent = [d for d, _ in thin if d >= today - dt.timedelta(days=400)]
    assert len(recent) == 401  # every recent day
    old = [d for d, _ in thin if d < today - dt.timedelta(days=400)]
    weeks = {(d.isocalendar()[0], d.isocalendar()[1]) for d in old}
    assert len(old) == len(weeks)  # one per week
    assert len(thin) < len(history) / 2


def test_history_returns_nav_and_a_benchmark_for_an_equity_fund(client, monkeypatch):
    monkeypatch.setattr(nav, "get_scheme_detail", lambda code: _detail(900) if code == CODE else None)
    monkeypatch.setattr(nav, "get_index_history", lambda ticker: [(dt.date.today() - dt.timedelta(days=i), 20_000.0 + (950 - i) * 10) for i in range(950, -1, -1)])
    r = client.get(f"/v1/funds/schemes/{CODE}/history")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["benchmark"]["label"]
    assert body["points"][-1]["nav"] == pytest.approx(100.0 + 900 * 0.1)
    assert all(p["bench"] is not None for p in body["points"])
    assert [p["date"] for p in body["points"]] == sorted(p["date"] for p in body["points"])


def test_a_debt_fund_gets_no_benchmark_and_says_why(client, monkeypatch):
    monkeypatch.setattr(nav, "get_scheme_detail", lambda code: _detail(500, "Debt Scheme - Corporate Bond Fund"))
    r = client.get(f"/v1/funds/schemes/{CODE}/history")
    body = r.json()
    assert body["benchmark"] is None
    assert body["benchmark_reason"]
    assert all(p["bench"] is None for p in body["points"])


def test_an_unknown_scheme_is_a_404(client, monkeypatch):
    monkeypatch.setattr(nav, "get_scheme_detail", lambda code: None)
    assert client.get("/v1/funds/schemes/1/history").status_code == 404


def test_history_needs_a_signed_in_user():
    with TestClient(create_app()) as anon:
        assert anon.get(f"/v1/funds/schemes/{CODE}/history").status_code == 401
