"""API coverage for the mutual-fund desk. NAV fetches are stubbed."""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from ..api.config import get_settings
from ..api.db import reset_engine
from ..api.main import create_app
from ..mutual_funds import nav


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "api.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path.as_posix()}")
    get_settings.cache_clear()
    reset_engine()
    with TestClient(create_app()) as c:
        yield c
    get_settings.cache_clear()
    reset_engine()


def _detail(code=119598):
    today = dt.date.today()
    return {
        "fund_house": "HDFC Mutual Fund",
        "scheme_category": "Equity Scheme - Flexi Cap Fund",
        "scheme_name": "HDFC Flexi Cap Fund - Direct Growth",
        "nav_history": [
            (today, 120.0),
            (today - dt.timedelta(days=400), 100.0),
        ],
    } if code == 119598 else None


def _stub(monkeypatch):
    monkeypatch.setattr(nav, "get_scheme_detail", lambda code: _detail(code))
    monkeypatch.setattr(nav, "get_all_schemes", lambda: [
        {"code": 119598, "name": "HDFC Flexi Cap Fund - Direct Growth"},
        {"code": 120716, "name": "ICICI Prudential Bluechip Fund"},
    ])
    monkeypatch.setattr(nav, "get_index_history", lambda ticker: [
        (dt.date.today() - dt.timedelta(days=500), 100.0),
        (dt.date.today(), 110.0),
    ])


def test_funds_require_auth(client):
    assert client.get("/v1/funds").status_code == 401
    assert client.post("/v1/funds/holdings", json={"scheme_code": 1, "units": 1}).status_code == 401


def test_funds_round_trip(client, monkeypatch):
    _stub(monkeypatch)
    client.post("/v1/auth/register", json={"email": "mf@example.com", "password": "password1", "display_name": "Meera"})
    bought = (dt.date.today() - dt.timedelta(days=400)).isoformat()
    created = client.post("/v1/funds/holdings", json={
        "scheme_code": 119598,
        "units": 10,
        "avg_nav": 100,
        "purchase_date": bought,
    })
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["totals"]["invested"] == 1000
    assert body["totals"]["value"] == 1200
    assert body["holdings"][0]["scheme_name"].startswith("HDFC")
    assert body["holdings"][0]["gain_pct"] == 20
    assert body["disclaimer"]

    search = client.get("/v1/funds/schemes", params={"q": "flexi"})
    assert search.status_code == 200
    assert search.json()["results"][0]["code"] == 119598

    quote = client.get("/v1/funds/schemes/119598")
    assert quote.status_code == 200
    assert quote.json()["nav"] == 120.0

    analysis = client.get("/v1/funds/analysis")
    assert analysis.status_code == 200
    report = analysis.json()
    assert report["ready"] is True
    assert report["xirr"] is not None
    assert report["asset_allocation"][0]["label"] == "Equity"

    topped = client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 10, "avg_nav": 140, "purchase_date": bought})
    assert topped.status_code == 201
    row = topped.json()["holdings"][0]
    assert row["units"] == 20
    assert row["avg_nav"] == 120

    removed = client.delete("/v1/funds/holdings/119598")
    assert removed.status_code == 200
    assert removed.json()["holdings"] == []
    assert client.delete("/v1/funds/holdings/119598").status_code == 404


def test_funds_are_private_to_the_account(client, monkeypatch):
    _stub(monkeypatch)
    client.post("/v1/auth/register", json={"email": "owner@example.com", "password": "password1", "display_name": "Owner"})
    assert client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 1}).status_code == 201
    client.post("/v1/auth/logout")
    client.post("/v1/auth/register", json={"email": "other@example.com", "password": "password1", "display_name": "Other"})
    assert client.get("/v1/funds").json()["holdings"] == []


def test_funds_reject_bad_units(client, monkeypatch):
    _stub(monkeypatch)
    client.post("/v1/auth/register", json={"email": "bad@example.com", "password": "password1", "display_name": "Bad"})
    rejected = client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 0})
    assert rejected.status_code == 422
    missing = client.post("/v1/funds/holdings", json={"scheme_code": 999, "units": 1})
    assert missing.status_code == 404
