from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from ..api.config import get_settings
from ..api.db import reset_engine
from ..api.main import create_app


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


def _auth(client: TestClient, email="ana@example.com", name="Ana"):
    r = client.post("/v1/auth/register", json={"email": email, "password": "password1", "display_name": name})
    assert r.status_code == 201, r.text
    return r.json()["user"]


def test_auth_required(client):
    assert client.get("/v1/models").status_code == 401
    assert client.get("/v1/auth/me").status_code == 401


def test_register_login_me(client):
    _auth(client)
    me = client.get("/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "ana@example.com"
    client.post("/v1/auth/logout")
    login = client.post("/v1/auth/login", json={"email": "ana@example.com", "password": "password1"})
    assert login.status_code == 200


def test_register_profile_fields(client):
    created = client.post(
        "/v1/auth/register",
        json={
            "email": "pat@example.com",
            "password": "password1",
            "first_name": "Pat",
            "last_name": "Rao",
            "designation": "analyst",
        },
    )
    assert created.status_code == 201, created.text
    user = created.json()["user"]
    assert user["display_name"] == "Pat Rao"
    assert user["first_name"] == "Pat"
    assert user["last_name"] == "Rao"
    assert user["designation"] == "analyst"
    me = client.get("/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["designation"] == "analyst"


def test_register_rejects_unknown_designation(client):
    bad = client.post(
        "/v1/auth/register",
        json={
            "email": "bad@example.com",
            "password": "password1",
            "first_name": "Bad",
            "last_name": "Role",
            "designation": "hacker",
        },
    )
    assert bad.status_code == 422


def test_create_sample_model_and_get(client):
    _auth(client)
    created = client.post("/v1/models", json={"source": "sample"})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["ticker"] == "ORCS"
    assert body["valuation"] is not None
    assert body["valuation"]["equity_bridge"]["equity_value_per_share"] is not None
    assert body["integrity"]["score"] >= 0
    got = client.get(f"/v1/models/{body['id']}")
    assert got.status_code == 200
    assert got.json()["id"] == body["id"]
    listed = client.get("/v1/models")
    assert listed.status_code == 200
    assert listed.json()["items"][0]["id"] == body["id"]


def test_idor_hidden(client):
    _auth(client, "owner@example.com", "Owner")
    model_id = client.post("/v1/models", json={"source": "sample"}).json()["id"]
    client.post("/v1/auth/logout")
    _auth(client, "intruder@example.com", "Intruder")
    r = client.get(f"/v1/models/{model_id}")
    assert r.status_code == 404
    r = client.patch(f"/v1/models/{model_id}/assumptions", json={"beta": 1.2})
    assert r.status_code == 404
    r = client.post(f"/v1/models/{model_id}/ingest")
    assert r.status_code == 404
    r = client.patch(f"/v1/models/{model_id}/historicals", json={"historicals": {"income_statements": [], "balance_sheets": [], "cash_flows": []}})
    assert r.status_code == 404


def test_refresh_ingest_rewrites_historicals(client, monkeypatch):
    from backend.api.valuation_service import sample_company

    def fake_ingest(ticker: str, cogs: float):
        company, hist, _notes, warnings = sample_company()
        hist.income_statements[0].cogs = cogs
        return company, hist, [f"refreshed {ticker}"], warnings

    monkeypatch.setattr("backend.api.routers.models.ingest_ticker", lambda ticker: fake_ingest(ticker, 111.0))
    assert client.post("/v1/models/mod_missing/ingest").status_code == 401
    _auth(client)
    created = client.post("/v1/models", json={"source": "ticker", "ticker": "TCS.NS"}).json()
    assert created["historicals"]["income_statements"][0]["cogs"] == 111.0
    monkeypatch.setattr("backend.api.routers.models.ingest_ticker", lambda ticker: fake_ingest(ticker, 222.0))
    refreshed = client.post(f"/v1/models/{created['id']}/ingest")
    assert refreshed.status_code == 200
    body = refreshed.json()
    assert body["historicals"]["income_statements"][0]["cogs"] == 222.0
    assert any(note.startswith("refreshed ") for note in body["ingest_notes"])


def test_wacc_gate(client):
    _auth(client)
    model_id = client.post("/v1/models", json={"source": "sample"}).json()["id"]
    r = client.patch(f"/v1/models/{model_id}/assumptions", json={"terminal_growth": 0.99})
    assert r.status_code == 200
    body = r.json()
    assert body["valuation"] is None
    assert body["valuation_error"]
    assert "WACC" in body["valuation_error"]
    export = client.post(f"/v1/models/{model_id}/exports", json={"format": "xlsx"})
    assert export.status_code == 400


def test_assumption_patch_recalculates(client):
    _auth(client)
    created = client.post("/v1/models", json={"source": "sample"}).json()
    base_ev = created["valuation"]["enterprise_value"]
    patched = client.patch(f"/v1/models/{created['id']}/assumptions", json={"beta": 0.5}).json()
    assert patched["valuation"]["enterprise_value"] != base_ev


def test_idempotent_create(client):
    _auth(client)
    a = client.post("/v1/models", json={"source": "sample"}, headers={"Idempotency-Key": "k1"})
    b = client.post("/v1/models", json={"source": "sample"}, headers={"Idempotency-Key": "k1"})
    assert a.status_code == 201
    assert b.status_code == 201
    assert a.json()["id"] == b.json()["id"]


def test_export_xlsx(client):
    _auth(client)
    model_id = client.post("/v1/models", json={"source": "sample"}).json()["id"]
    r = client.post(f"/v1/models/{model_id}/exports", json={"format": "xlsx"})
    assert r.status_code == 200
    assert "spreadsheet" in r.headers["content-type"]
    assert len(r.content) > 1000


def test_market_quotes_authz_and_contract(client, monkeypatch):
    assert client.get("/v1/market/quotes?symbols=NIFTY").status_code == 401
    _auth(client)

    def fake_quotes(symbols):
        return [
            {
                "symbol": symbols[0],
                "yahoo": "^NSEI",
                "last": 25100.0,
                "prev_close": 25000.0,
                "open": 25010.0,
                "high": 25150.0,
                "low": 24980.0,
                "change": 100.0,
                "change_pct": 0.004,
                "volume": 1.0,
                "currency": "INR",
                "ts": 1,
                "live": True,
            }
        ]

    monkeypatch.setattr("backend.api.routers.market.fetch_quotes", fake_quotes)
    r = client.get("/v1/market/quotes?symbols=NIFTY")
    assert r.status_code == 200
    body = r.json()
    assert body["quotes"][0]["symbol"] == "NIFTY"
    assert body["quotes"][0]["live"] is True

    posted = client.post("/v1/market/quotes", json={"symbols": ["NIFTY", "RELIANCE"]})
    assert posted.status_code == 200
    assert posted.json()["quotes"][0]["symbol"] == "NIFTY"


def test_market_world_authz_and_contract(client, monkeypatch):
    assert client.get("/v1/market/world").status_code == 401
    _auth(client)

    def fake_world():
        return {
            "quotes": [
                {
                    "symbol": "NIFTY",
                    "yahoo": "^NSEI",
                    "last": 23346.4,
                    "prev_close": 23200.0,
                    "open": 23210.0,
                    "high": 23400.0,
                    "low": 23180.0,
                    "change": 146.4,
                    "change_pct": 0.0063,
                    "volume": 1.0,
                    "currency": "INR",
                    "ts": 1,
                    "live": True,
                },
                {
                    "symbol": "SPX",
                    "yahoo": "^GSPC",
                    "last": 7650.5,
                    "prev_close": 7600.0,
                    "open": 7610.0,
                    "high": 7660.0,
                    "low": 7590.0,
                    "change": 50.5,
                    "change_pct": 0.0066,
                    "volume": 1.0,
                    "currency": "USD",
                    "ts": 1,
                    "live": True,
                },
                {
                    "symbol": "TASI",
                    "yahoo": "^TASI.SR",
                    "last": 10777.94,
                    "prev_close": 10700.0,
                    "open": 10710.0,
                    "high": 10800.0,
                    "low": 10680.0,
                    "change": 77.94,
                    "change_pct": 0.0073,
                    "volume": 1.0,
                    "currency": "SAR",
                    "ts": 1,
                    "live": True,
                },
            ],
            "live": True,
            "count": 3,
        }

    monkeypatch.setattr("backend.api.routers.market.fetch_world_quotes", fake_world)
    r = client.get("/v1/market/world")
    assert r.status_code == 200
    body = r.json()
    assert body["live"] is True
    assert {row["symbol"] for row in body["quotes"]} >= {"NIFTY", "SPX", "TASI"}


def test_market_quotes_post_authz_and_empty(client):
    assert client.post("/v1/market/quotes", json={"symbols": ["RELIANCE"]}).status_code == 401
    _auth(client)
    bad = client.post("/v1/market/quotes", json={"symbols": []})
    assert bad.status_code in (400, 422)


def test_market_universe_authz_and_search(client, monkeypatch):
    assert client.get("/v1/market/universe").status_code == 401
    _auth(client)

    fake = {
        "source": "test",
        "fetched_at": 1,
        "stale": False,
        "indices": [
            {"name": "Nifty 50", "count": 1, "symbols": ["RELIANCE"]},
            {"name": "Nifty Smallcap 250", "count": 1, "symbols": ["JKPAPER"]},
            {"name": "Nifty LargeMidcap 250", "count": 1, "symbols": ["PERSISTENT"]},
        ],
        "items": [
            {
                "symbol": "RELIANCE",
                "name": "Reliance Industries Limited",
                "industry": "Oil Gas",
                "lot_size": 1,
                "indices": ["Nifty 50"],
            },
            {
                "symbol": "JKPAPER",
                "name": "JK Paper Limited",
                "industry": "Forest Materials",
                "lot_size": 1,
                "indices": ["Nifty Smallcap 250"],
            },
            {
                "symbol": "PERSISTENT",
                "name": "Persistent Systems Limited",
                "industry": "IT",
                "lot_size": 1,
                "indices": ["Nifty LargeMidcap 250"],
            },
        ],
    }
    monkeypatch.setattr("backend.api.routers.market.get_universe", lambda: fake)

    all_rows = client.get("/v1/market/universe")
    assert all_rows.status_code == 200
    body = all_rows.json()
    assert body["count"] == 3
    assert {row["symbol"] for row in body["items"]} == {"RELIANCE", "JKPAPER", "PERSISTENT"}

    small = client.get("/v1/market/universe", params={"index": "Nifty Smallcap 250"})
    assert small.status_code == 200
    assert [row["symbol"] for row in small.json()["items"]] == ["JKPAPER"]

    aliased = client.get("/v1/market/universe", params={"index": "Nifty Midcap 250"})
    assert aliased.status_code == 200
    assert [row["symbol"] for row in aliased.json()["items"]] == ["PERSISTENT"]

    q = client.get("/v1/market/universe", params={"q": "jk paper"})
    assert q.status_code == 200
    assert q.json()["items"][0]["symbol"] == "JKPAPER"


def test_market_ohlc_fallback_shape(client, monkeypatch):
    _auth(client)
    monkeypatch.setattr(
        "backend.api.routers.market.fetch_ohlc",
        lambda symbol, timeframe: {
            "symbol": symbol,
            "timeframe": timeframe,
            "yahoo": "RELIANCE.NS",
            "live": False,
            "candles": [],
        },
    )
    r = client.get("/v1/market/ohlc?symbol=RELIANCE&timeframe=1D")
    assert r.status_code == 200
    body = r.json()
    assert body["candles"] == []
    assert body["live"] is False


def test_market_heatmap_authz_and_contract(client, monkeypatch):
    assert client.get("/v1/market/heatmap").status_code == 401
    _auth(client)

    def fake_heatmap(index, range_code):
        return {
            "index": index,
            "range": range_code,
            "live": True,
            "tiles": [
                {
                    "symbol": "RELIANCE",
                    "name": "Reliance Industries",
                    "industry": "Oil Gas",
                    "last": 1384.0,
                    "change_pct": 0.012,
                    "market_cap": 18_000_000_000_000,
                    "live": True,
                }
            ],
        }

    monkeypatch.setattr("backend.api.routers.market.fetch_heatmap", fake_heatmap)
    r = client.get("/v1/market/heatmap", params={"index": "Nifty Smallcap", "range": "W"})
    assert r.status_code == 200
    body = r.json()
    assert body["tiles"][0]["market_cap"] == 18_000_000_000_000
    assert body["tiles"][0]["change_pct"] == pytest.approx(0.012)


def test_market_financials_authz_and_contract(client, monkeypatch):
    assert client.get("/v1/market/financials?symbol=RELIANCE").status_code == 401
    _auth(client)

    def fake_financials(symbol):
        return {
            "symbol": symbol,
            "yahoo": "RELIANCE.NS",
            "name": "Reliance Industries",
            "currency": "INR",
            "live": True,
            "message": None,
            "ratios": [
                {"id": "roe", "label": "ROE", "value": 0.09, "format": "pct"},
                {"id": "roce", "label": "ROCE", "value": 0.11, "format": "pct"},
                {"id": "pe", "label": "PE", "value": 24.1, "format": "number"},
                {"id": "pb", "label": "PB", "value": 2.2, "format": "number"},
                {"id": "dividend_yield", "label": "Dividend yield", "value": 0.005, "format": "pct"},
            ],
            "income": {"columns": ["2025"], "rows": [{"id": "revenue", "label": "Revenue", "values": [9e11]}]},
            "balance": {"columns": ["2025"], "rows": [{"id": "total_assets", "label": "Total assets", "values": [1.5e12]}]},
            "cashflow": {"columns": ["2025"], "rows": [{"id": "ocf", "label": "Operating cash flow", "values": [1.2e11]}]},
        }

    monkeypatch.setattr("backend.api.routers.market.fetch_financials", fake_financials)
    r = client.get("/v1/market/financials?symbol=RELIANCE")
    assert r.status_code == 200
    body = r.json()
    assert body["live"] is True
    labels = {row["id"] for row in body["ratios"]}
    assert {"roe", "roce", "pe", "pb", "dividend_yield"} <= labels
    assert body["income"]["rows"][0]["id"] == "revenue"
    assert body["balance"]["rows"][0]["id"] == "total_assets"
    assert body["cashflow"]["rows"][0]["id"] == "ocf"


def test_sample_model_reports_growth_intelligence_fallback(client):
    _auth(client)
    body = client.post("/v1/models", json={"source": "sample"}).json()
    intel = body["growth_intelligence"]
    assert intel["status"] == "evidence"
    assert body["assumptions"]["revenue_growth"][0]["source"] == "calculated"
    assert body["assumptions"]["revenue_growth"][-1]["value"] == pytest.approx(body["drivers"]["terminal_growth"])
    assert body["growth_evidence"]["regime"]
    assert body["assumption_ledger"]


def test_llm_growth_method_uses_injected_provider(client, monkeypatch):
    from backend.engine.growth_llm import ScriptedGrowthLLMProvider

    fake = ScriptedGrowthLLMProvider(
        {
            "abstain": False,
            "abstain_reason": "",
            "revenue_growth": [0.12, 0.10, 0.08, 0.06, 0.04],
            "year_rationales": ["y1", "y2", "y3", "y4", "y5"],
            "confidence": "Medium",
            "thesis": "Fade from the supplied CAGRs toward 4%.",
        }
    )
    monkeypatch.setattr("backend.api.valuation_service.get_growth_provider", lambda: fake)
    _auth(client)
    created = client.post("/v1/models", json={"source": "sample"}).json()
    body = client.patch(
        f"/v1/models/{created['id']}/assumptions", json={"growth_method": "llm"}
    ).json()
    assert body["growth_intelligence"]["status"] == "llm"
    assert body["assumptions"]["revenue_growth"][0]["source"] == "calculated"
    assert body["growth_intelligence"]["llm_suggested_year1"] == pytest.approx(0.12)
    assert fake.calls == 1

    switched = client.patch(
        f"/v1/models/{body['id']}/assumptions", json={"growth_method": "historical"}
    ).json()
    assert switched["growth_intelligence"]["status"] == "historical"
    assert switched["assumptions"]["revenue_growth"][0]["source"] == "calculated"


def _manual_payload(**bs_extra):
    return {
        "source": "manual",
        "company": {
            "name": "Paste Co",
            "ticker": None,
            "company_type": "public",
            "currency": "INR",
            "country": "India",
            "diluted_shares_outstanding": 100.0,
            "current_share_price": 10.0,
            "shares_status": "available",
        },
        "historicals": {
            "income_statements": [
                {
                    "period": "FY2025",
                    "revenue": 1000.0,
                    "cogs": 400.0,
                    "rnd": 20.0,
                    "sm": 30.0,
                    "ga": 50.0,
                    "other_opex": 0.0,
                    "da": 40.0,
                    "interest_expense": 10.0,
                    "taxes": 80.0,
                },
                {
                    "period": "FY2026",
                    "revenue": 1100.0,
                    "cogs": 430.0,
                    "rnd": 22.0,
                    "sm": 32.0,
                    "ga": 52.0,
                    "other_opex": 0.0,
                    "da": 42.0,
                    "interest_expense": 11.0,
                    "taxes": 90.0,
                },
            ],
            "balance_sheets": [
                {
                    "period": "FY2025",
                    "cash": 0.0,
                    "cash_status": "unavailable",
                    "cash_reported": False,
                    "accounts_receivable": 80.0,
                    "accounts_payable": 40.0,
                    "ppe": 200.0,
                    "shareholders_equity": 500.0,
                    "nwc_status": "available",
                    "operating_wc_complete": True,
                    "debt_status": "unavailable",
                    "long_term_debt": 0.0,
                    **bs_extra,
                },
                {
                    "period": "FY2026",
                    "cash": 0.0,
                    "cash_status": "unavailable",
                    "cash_reported": False,
                    "accounts_receivable": 90.0,
                    "accounts_payable": 45.0,
                    "ppe": 220.0,
                    "shareholders_equity": 540.0,
                    "nwc_status": "available",
                    "operating_wc_complete": True,
                    "debt_status": "unavailable",
                    "long_term_debt": 0.0,
                },
            ],
            "cash_flows": [
                {"period": "FY2025", "net_income": 80.0, "da": 40.0, "capex": 30.0, "change_in_nwc": 5.0},
                {"period": "FY2026", "net_income": 90.0, "da": 42.0, "capex": 32.0, "change_in_nwc": 6.0},
            ],
        },
    }


def test_manual_model_blank_cash_is_unavailable_not_zero(client):
    _auth(client)
    created = client.post("/v1/models", json=_manual_payload())
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["source"] == "manual"
    latest = body["historicals"]["balance_sheets"][-1]
    assert latest["cash_status"] == "unavailable"
    assert latest["cash_reported"] is False
    assert latest["debt_status"] == "unavailable"
    assert body["statement_source"] == "manual"
    assert any("unavailable" in note.lower() for note in body["ingest_notes"])
    latest_inc = body["historicals"]["income_statements"][-1]
    assert latest_inc["cogs"] == 430.0
    assert latest_inc["rnd"] == 22.0
    refresh = client.post(f"/v1/models/{body['id']}/ingest")
    assert refresh.status_code == 400
    assert "Edit Financials" in refresh.json()["message"]


def test_patch_historicals_recalculates(client):
    _auth(client)
    created = client.post("/v1/models", json=_manual_payload()).json()
    hist = created["historicals"]
    hist["income_statements"][-1]["revenue"] = 2000.0
    hist["income_statements"][-1]["cogs"] = 800.0
    patched = client.patch(f"/v1/models/{created['id']}/historicals", json={"historicals": hist})
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["historicals"]["income_statements"][-1]["revenue"] == 2000.0
    assert any("edited" in note.lower() for note in body["ingest_notes"])


def test_search_listing_labels_adr_vs_nse(monkeypatch):
    from backend.api.market import _annotate_listings

    out = _annotate_listings(
        [
            {"symbol": "INFY", "name": "Infosys Limited", "exchange": "NMS"},
            {"symbol": "INFY.NS", "name": "Infosys Limited", "exchange": "NSE"},
        ]
    )
    by_sym = {row["symbol"]: row for row in out}
    assert by_sym["INFY.NS"]["listing"] == "NSE, INR"
    assert by_sym["INFY"]["nse_equivalent"] == "INFY.NS"
    assert "ADR" in by_sym["INFY"]["listing"] or "not NSE" in by_sym["INFY"]["listing"]
