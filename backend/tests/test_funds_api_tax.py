"""API coverage for fund costs and tax: purchases by amount, SIPs, redemption preview and charges, settings, the tax view."""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from ..api.config import get_settings
from ..api.db import get_engine, reset_engine
from ..api.main import create_app
from ..api.orm import MfTransaction
from ..mutual_funds import insights, nav

CODE = 119598


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


def _detail(days: int = 900, start_nav: float = 100.0, step: float = 0.1, category: str = "Equity Scheme - Flexi Cap Fund"):
    today = dt.date.today()
    hist = [(today - dt.timedelta(days=i), start_nav + (days - i) * step) for i in range(days + 1)]
    return {"fund_house": "HDFC Mutual Fund", "scheme_category": category, "scheme_name": "HDFC Flexi Cap Fund - Direct Growth", "nav_history": hist}


@pytest.fixture
def book(client, monkeypatch):
    detail = _detail()
    monkeypatch.setattr(nav, "get_scheme_detail", lambda code: detail if code == CODE else None)
    monkeypatch.setattr(nav, "get_all_schemes", lambda: [{"code": CODE, "name": detail["scheme_name"]}])
    monkeypatch.setattr(nav, "get_index_history", lambda ticker: [(dt.date.today() - dt.timedelta(days=i), 20_000.0 + (950 - i) * 10) for i in range(950)])
    client.post("/v1/auth/register", json={"email": "tax@example.com", "password": "password1", "display_name": "Tara"})
    return detail


def _ago(days: int) -> str:
    return (dt.date.today() - dt.timedelta(days=days)).isoformat()


def _published(detail, days_ago: int) -> float:
    return dict(detail["nav_history"])[dt.date.today() - dt.timedelta(days=days_ago)]


def _buy(client, days_ago: int, units: float = 100.0):
    r = client.post("/v1/funds/holdings", json={"scheme_code": CODE, "units": units, "purchase_date": _ago(days_ago)})
    assert r.status_code == 201, r.text
    return r.json()


# --------------------------------------------------------------------------- stamp duty

def test_a_purchase_by_amount_takes_stamp_duty_out_of_the_units(client, book):
    r = client.post("/v1/funds/holdings", json={"scheme_code": CODE, "amount": 10_000})
    assert r.status_code == 201, r.text
    row = r.json()["holdings"][0]
    price = row["current_nav"]
    assert row["units"] == pytest.approx((10_000 - 0.5) / price, rel=1e-6)  # units are allotted on the amount after duty
    assert row["invested"] == pytest.approx(10_000.0, abs=0.01)  # the investor paid Rs 10,000, once


def test_units_and_amount_are_alternatives(client, book):
    both = client.post("/v1/funds/holdings", json={"scheme_code": CODE, "units": 10, "amount": 1000})
    neither = client.post("/v1/funds/holdings", json={"scheme_code": CODE})
    assert both.status_code == 422 and neither.status_code == 422  # request validation


# --------------------------------------------------------------------------- SIP

def test_a_sip_is_one_dated_lot_per_instalment(client, book):
    r = client.post("/v1/funds/sip", json={"scheme_code": CODE, "amount": 5000, "day_of_month": 5, "start_date": _ago(400), "installments": 12})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["sip"]["instalments"] == 12
    assert body["totals"]["invested"] == pytest.approx(60_000, abs=1.0)  # 12 x Rs 5,000 paid
    tax = client.get("/v1/funds/tax").json()
    fund = tax["funds"][0]
    assert fund["lot_count"] == 12
    assert [lot["term"] for lot in fund["lots"]][0] == "long"  # the oldest instalments are over a year old
    assert {lot["term"] for lot in fund["lots"]} == {"long", "short"}
    assert all(lot["source"] == "sip" for lot in fund["lots"])


def test_a_sip_never_runs_into_the_future(client, book):
    future = (dt.date.today() + dt.timedelta(days=30)).isoformat()
    assert client.post("/v1/funds/sip", json={"scheme_code": CODE, "amount": 1000, "day_of_month": 5, "start_date": future}).status_code == 400
    r = client.post("/v1/funds/sip", json={"scheme_code": CODE, "amount": 1000, "day_of_month": 5, "start_date": _ago(100)})
    assert r.status_code == 201
    assert r.json()["sip"]["instalments"] <= 4


# --------------------------------------------------------------------------- redemption

def test_the_preview_records_nothing_and_shows_every_step(client, book):
    _buy(client, 500, 100.0)
    before = client.get("/v1/funds").json()["holdings"][0]["units"]
    r = client.post(f"/v1/funds/holdings/{CODE}/redeem-preview", json={"units": 40})
    assert r.status_code == 200, r.text
    pv = r.json()
    assert pv["units"] == 40 and pv["gross"] == pytest.approx(40 * pv["nav"], abs=0.01)
    assert pv["exit_load"]["status"] == "unavailable" and pv["exit_load"]["text"] == "Exit load information unavailable."
    assert pv["stt"]["amount"] == pytest.approx(pv["gross"] * 0.00001, abs=0.01)
    assert pv["classification"]["tax_class"] == "equity"
    assert pv["confidence"]["level"] in ("estimated", "high", "incomplete")
    assert pv["lots"][0]["term"] == "long" and pv["estimated_tax"] is not None
    assert "not tax advice" in pv["disclosure"].lower()
    assert client.get("/v1/funds").json()["holdings"][0]["units"] == before  # nothing changed


def test_a_redemption_stores_its_exit_load_and_stt_and_they_reach_the_returns(client, book):
    _buy(client, 100, 100.0)
    put = client.put(f"/v1/funds/schemes/{CODE}/settings", json={"exit_load": [{"days": 365, "pct": 1.0}]})
    assert put.status_code == 200
    pv = client.post(f"/v1/funds/holdings/{CODE}/redeem-preview", json={"units": 50}).json()
    assert pv["exit_load"]["status"] == "applied"
    assert pv["exit_load"]["amount"] == pytest.approx(pv["gross"] * 0.01, abs=0.01)

    r = client.post(f"/v1/funds/holdings/{CODE}/redeem", json={"units": 50})
    assert r.status_code == 200, r.text
    with Session(get_engine()) as s:
        sell = s.query(MfTransaction).filter(MfTransaction.kind == "sell").one()
        assert sell.exit_load == pytest.approx(pv["exit_load"]["amount"], abs=0.01)
        assert sell.stt == pytest.approx(pv["stt"]["amount"], abs=0.01)
    analysis = client.get("/v1/funds/analysis").json()
    # the cash that came back is net of the load and STT, so the return reflects them once
    assert analysis["portfolio"]["realised_proceeds"] == pytest.approx(pv["gross"] - pv["exit_load"]["amount"] - pv["stt"]["amount"], abs=0.02)
    tax = client.get("/v1/funds/tax").json()
    assert tax["realized"]["costs"]["exit_load"] == pytest.approx(pv["exit_load"]["amount"], abs=0.01)


def test_redeem_all_closes_the_position_and_a_second_attempt_is_refused(client, book):
    _buy(client, 300, 20.0)
    r = client.post(f"/v1/funds/holdings/{CODE}/redeem", json={"all": True})
    assert r.status_code == 200 and r.json()["holdings"] == []
    assert client.post(f"/v1/funds/holdings/{CODE}/redeem", json={"all": True}).status_code == 404


def test_redemption_input_is_validated(client, book):
    _buy(client, 300, 20.0)
    assert client.post(f"/v1/funds/holdings/{CODE}/redeem", json={"units": 50}).status_code == 400  # more than held
    assert client.post(f"/v1/funds/holdings/{CODE}/redeem", json={"units": 5, "all": True}).status_code == 422
    assert client.post(f"/v1/funds/holdings/{CODE}/redeem", json={}).status_code == 422
    assert client.post(f"/v1/funds/holdings/{CODE}/redeem-preview", json={"units": 50}).status_code == 400


def test_a_partial_redemption_uses_the_oldest_lot_and_leaves_the_rest(client, book):
    _buy(client, 700, 60.0)
    _buy(client, 100, 40.0)
    client.post(f"/v1/funds/holdings/{CODE}/redeem", json={"units": 30})
    fund = client.get("/v1/funds/tax").json()["funds"][0]
    assert [(lot["units"], lot["term"]) for lot in fund["lots"]] == [(pytest.approx(30.0), "long"), (pytest.approx(40.0), "short")]
    assert client.get("/v1/funds").json()["holdings"][0]["units"] == pytest.approx(70.0)
    # redeeming past the oldest lot reaches into the next one
    client.post(f"/v1/funds/holdings/{CODE}/redeem", json={"units": 40})
    fund = client.get("/v1/funds/tax").json()["funds"][0]
    assert [(lot["units"], lot["term"]) for lot in fund["lots"]] == [(pytest.approx(30.0), "short")]


# --------------------------------------------------------------------------- the tax view

def test_the_tax_view_separates_realised_from_unrealised(client, book):
    _buy(client, 600, 100.0)
    client.post(f"/v1/funds/holdings/{CODE}/redeem", json={"units": 30})
    t = client.get("/v1/funds/tax").json()
    assert t["fy"] == t["current_fy"] and t["years"][0]["fy"] == t["current_fy"]
    assert len(t["realized"]["items"]) == 1
    assert t["realized"]["estimate"]["supported"] is True
    assert t["unrealized"]["gain"] > 0 and "not taxed until units are redeemed" in t["unrealized"]["note"]
    assert t["unrealized"]["potential_tax"] is not None
    assert t["history_note"].startswith("Based on available transaction history")
    assert "not tax advice" in t["disclosure"].lower()
    fund = t["funds"][0]
    assert fund["classification"]["tax_class"] == "equity"
    assert fund["unrealized_gain"] == pytest.approx(fund["value"] - fund["invested"], abs=0.02)


def test_the_profile_changes_the_estimate_and_its_label(client, book):
    _buy(client, 100, 200.0)
    base = client.get("/v1/funds/tax").json()
    assert base["unrealized"]["potential_tax_basis"] == "Estimated tax before surcharge and cess"
    with_band = client.get("/v1/funds/tax", params={"band": "50l_to_1cr", "slab": "30"}).json()
    assert with_band["unrealized"]["potential_tax_basis"].startswith("Estimated tax including surcharge")
    assert with_band["unrealized"]["potential_tax"] >= base["unrealized"]["potential_tax"]
    assert client.get("/v1/funds/tax", params={"band": "nonsense"}).json()["profile"]["income_band"] is None


def test_a_year_with_changed_rates_is_not_estimated(client, book):
    _buy(client, 100, 10.0)
    t = client.get("/v1/funds/tax", params={"fy": "FY2024-25"}).json()
    assert t["realized"]["estimate"]["supported"] is False
    assert client.get("/v1/funds/tax", params={"fy": "nonsense"}).status_code == 422


def test_a_tax_class_override_changes_how_the_fund_is_taxed(client, book):
    _buy(client, 100, 100.0)
    assert client.put(f"/v1/funds/schemes/{CODE}/settings", json={"tax_class": "specified"}).status_code == 200
    fund = client.get("/v1/funds/tax").json()["funds"][0]
    assert fund["classification"]["tax_class"] == "specified" and fund["classification"]["source"] == "override"
    assert all(lot["deemed_short_term"] for lot in fund["lots"])  # units bought after 1 Apr 2023
    client.put(f"/v1/funds/schemes/{CODE}/settings", json={"tax_class": None})
    assert client.get("/v1/funds/tax").json()["funds"][0]["classification"]["tax_class"] == "equity"


def test_settings_are_validated(client, book):
    assert client.put(f"/v1/funds/schemes/{CODE}/settings", json={"tax_class": "debt"}).status_code == 422
    assert client.put(f"/v1/funds/schemes/{CODE}/settings", json={"exit_load": [{"days": 365, "pct": 50}]}).status_code == 422
    assert client.put("/v1/funds/schemes/999/settings", json={}).status_code == 404


def test_scheme_tax_works_for_a_fund_that_is_not_held(client, book):
    r = client.get(f"/v1/funds/schemes/{CODE}/tax")
    assert r.status_code == 200
    body = r.json()
    assert body["classification"]["tax_class"] == "equity"
    assert "12.5%" in body["rules"]["long_term"] and "₹1.25 lakh" in body["rules"]["long_term"]
    assert body["exit_load"]["status"] == "unavailable"
    assert "already reflected in the NAV" in body["expense_ratio_note"]


def test_insights_use_the_tax_view_without_telling_anyone_what_to_do(client, book):
    _buy(client, 700, 100.0)
    _buy(client, 330, 50.0)  # about to cross 12 months
    r = client.get("/v1/funds/insights")
    assert r.status_code == 200
    body = r.json()
    items = body["insights"] + body["also_noted"]
    ids = {i["id"] for i in items}
    assert "tax-threshold" in ids and "tax-holding-period" in ids
    text = " ".join(" ".join([i["title"], i["why"], i["review"], *i["evidence"]]) for i in items).lower().replace("exit load", "load")
    for phrase in insights.BANNED_PHRASES:
        assert phrase not in text
    for word in (" sell ", " buy ", " exit "):
        assert word not in f" {text} "
    threshold = next(i for i in items if i["id"] == "tax-threshold")
    assert "Tax alone is not a reason" in threshold["review"]


# --------------------------------------------------------------------------- migration

def test_an_existing_database_gets_the_redemption_columns(tmp_path, monkeypatch):
    db_path = tmp_path / "old.db"
    old = create_engine(f"sqlite:///{db_path.as_posix()}")
    with old.begin() as conn:
        conn.execute(text(
            "CREATE TABLE mf_transactions (id VARCHAR(32) PRIMARY KEY, user_id VARCHAR(32), scheme_code INTEGER, kind VARCHAR(8), "
            "trade_date VARCHAR(10), units FLOAT, nav FLOAT, source VARCHAR(16), created_at DATETIME)"
        ))
    old.dispose()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path.as_posix()}")
    get_settings.cache_clear()
    reset_engine()
    try:
        cols = {c["name"] for c in inspect(get_engine()).get_columns("mf_transactions")}
        assert {"exit_load", "stt"} <= cols
        assert inspect(get_engine()).has_table("mf_fund_settings")
    finally:
        get_settings.cache_clear()
        reset_engine()
