"""Tests for the long-term index context used to anchor planning scenarios."""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from ..api.config import get_settings
from ..api.db import reset_engine
from ..api.main import create_app
from ..mutual_funds import context, metrics, nav

END = dt.date(2026, 10, 5)


def _compounding(years: float, annual: float, *, step_days: int = 7):
    """Weekly closes growing at exactly `annual` a year, ending on END."""
    pts = []
    total_days = round(years * 365.25)
    d = END - dt.timedelta(days=total_days)
    level = 1000.0
    while d <= END:
        pts.append((d, level * (1 + annual) ** ((d - (END - dt.timedelta(days=total_days))).days / 365.25)))
        d += dt.timedelta(days=step_days)
    if pts[-1][0] != END:
        pts.append((END, level * (1 + annual) ** years))
    return pts


def test_window_cagr_recovers_a_known_growth_rate():
    s = metrics.Series(_compounding(10.1, 0.12))
    ten = context.window_cagr(s, 10)
    five = context.window_cagr(s, 5)
    assert ten["cagr_pct"] == pytest.approx(12.0, abs=0.3)
    assert five["cagr_pct"] == pytest.approx(12.0, abs=0.3)
    assert ten["end"] == END.isoformat() and ten["days"] > 3600


def test_window_cagr_is_none_when_history_is_too_short():
    s = metrics.Series(_compounding(4.0, 0.10))
    assert context.window_cagr(s, 5) is None
    assert context.window_cagr(s, 10) is None
    assert context.window_cagr(metrics.Series([]), 5) is None


def test_window_cagr_uses_a_negative_rate_honestly():
    s = metrics.Series(_compounding(5.2, -0.05))
    assert context.window_cagr(s, 5)["cagr_pct"] == pytest.approx(-5.0, abs=0.3)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'api.db').as_posix()}")
    get_settings.cache_clear()
    reset_engine()
    with TestClient(create_app()) as c:
        yield c
    get_settings.cache_clear()
    reset_engine()


def test_context_endpoint_needs_auth_and_reports_both_indices(client, monkeypatch):
    assert client.get("/v1/funds/context").status_code == 401
    monkeypatch.setattr(nav, "get_index_history", lambda ticker: _compounding(10.1, 0.11))
    client.post("/v1/auth/register", json={"email": "ctx@example.com", "password": "password1", "display_name": "Ctx"})
    r = client.get("/v1/funds/context")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [i["label"] for i in body["indices"]] == ["Nifty 50", "Nifty 500"]
    assert all(i["ten_year"]["cagr_pct"] == pytest.approx(11.0, abs=0.3) for i in body["indices"])
    assert "price" in body["basis"].lower() and "forecast" in body["note"].lower()


def test_context_degrades_to_null_windows_without_history(client, monkeypatch):
    monkeypatch.setattr(nav, "get_index_history", lambda ticker: [])
    client.post("/v1/auth/register", json={"email": "ctx2@example.com", "password": "password1", "display_name": "Ctx"})
    body = client.get("/v1/funds/context").json()
    assert body["as_of"] is None
    assert all(i["five_year"] is None and i["ten_year"] is None for i in body["indices"])
