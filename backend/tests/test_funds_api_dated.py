"""API coverage for dated purchases, per-purchase transactions, redemptions and insights. NAV fetches are stubbed."""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from ..api.config import get_settings
from ..api.db import get_engine, reset_engine
from ..api.main import create_app
from ..api.orm import MfHolding
from ..mutual_funds import costs, nav


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


def _daily_detail(days=200, start_nav=100.0, step=0.2):
    today = dt.date.today()
    hist = [(today - dt.timedelta(days=i), start_nav + (days - i) * step) for i in range(days + 1)]
    return {
        "fund_house": "HDFC Mutual Fund",
        "scheme_category": "Equity Scheme - Flexi Cap Fund",
        "scheme_name": "HDFC Flexi Cap Fund - Direct Growth",
        "nav_history": hist,
    }


@pytest.fixture
def rich(client, monkeypatch):
    detail = _daily_detail()
    monkeypatch.setattr(nav, "get_scheme_detail", lambda code: detail if code == 119598 else None)
    monkeypatch.setattr(nav, "get_all_schemes", lambda: [{"code": 119598, "name": detail["scheme_name"]}])
    monkeypatch.setattr(nav, "get_index_history", lambda ticker: [
        (dt.date.today() - dt.timedelta(days=i), 20_000.0 + (250 - i) * 10) for i in range(250)
    ])
    client.post("/v1/auth/register", json={"email": "rich@example.com", "password": "password1", "display_name": "Rich"})
    return detail


def _published(detail, days_ago):
    return dict(detail["nav_history"])[dt.date.today() - dt.timedelta(days=days_ago)]


def _ago(days):
    return (dt.date.today() - dt.timedelta(days=days)).isoformat()


def _paid(units, nav_, day):
    """Amount paid for `units` at `nav_`: the units' value plus the stamp duty taken out of the money."""
    return units * nav_ + costs.gross_from_units(units, nav_, day)["stamp_duty"]


def test_historical_purchase_uses_that_dates_nav_never_todays(client, rich):
    r = client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 10, "purchase_date": _ago(60)})
    assert r.status_code == 201, r.text
    row = r.json()["holdings"][0]
    assert row["avg_nav"] == pytest.approx(_published(rich, 60), abs=1e-3)
    assert row["avg_nav"] != pytest.approx(_published(rich, 0), abs=1e-3)
    assert row["purchase_date"] == _ago(60)


def test_buying_at_the_current_nav_uses_the_navs_own_date(client, rich):
    r = client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 5})
    row = r.json()["holdings"][0]
    assert row["avg_nav"] == pytest.approx(_published(rich, 0), abs=1e-3)
    assert row["purchase_date"] == _ago(0)


def test_a_manually_entered_nav_is_kept_as_entered(client, rich):
    r = client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 5, "avg_nav": 111.11, "purchase_date": _ago(30)})
    assert r.json()["holdings"][0]["avg_nav"] == pytest.approx(111.11)


def test_purchase_dated_before_the_scheme_existed_is_rejected_with_the_reason(client, rich):
    r = client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 5, "purchase_date": _ago(900)})
    assert r.status_code == 400 and "history starts" in r.json()["message"]


def test_future_and_malformed_dates_are_rejected(client, rich):
    future = (dt.date.today() + dt.timedelta(days=3)).isoformat()
    assert client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 5, "purchase_date": future}).status_code == 400
    assert client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 5, "purchase_date": "05/10/2026"}).status_code == 400


def test_nav_on_date_endpoint_returns_the_published_nav(client, rich):
    r = client.get("/v1/funds/schemes/119598/nav", params={"date": _ago(45)})
    assert r.status_code == 200
    assert r.json()["nav"] == pytest.approx(_published(rich, 45), abs=1e-3)
    assert client.get("/v1/funds/schemes/119598/nav", params={"date": "2020-01-01"}).status_code == 400
    assert client.get("/v1/funds/schemes/119598").json()["inception_date"]


def test_each_purchase_is_its_own_dated_transaction(client, rich):
    client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 10, "purchase_date": _ago(100)})
    r = client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 5, "purchase_date": _ago(40)})
    row = r.json()["holdings"][0]
    assert row["units"] == 15
    assert row["purchase_date"] == _ago(100)  # the holding's first purchase
    report = client.get("/v1/funds/analysis").json()
    assert report["portfolio"]["transactions"] == 2
    assert report["portfolio"]["transactions_source"] == "recorded"
    assert report["portfolio"]["single_date"] is False
    assert report["portfolio"]["total_invested"] == pytest.approx(_paid(10, _published(rich, 100), _ago(100)) + _paid(5, _published(rich, 40), _ago(40)))


def test_a_legacy_holding_keeps_its_units_when_first_topped_up(client, rich):
    uid = client.get("/v1/auth/me").json()["id"]
    with Session(get_engine()) as s:
        s.add(MfHolding(user_id=uid, scheme_code=119598, scheme_name="HDFC Flexi Cap Fund - Direct Growth",
                        units=20.0, avg_nav=_published(rich, 150), purchase_date=_ago(150)))
        s.commit()
    before = client.get("/v1/funds/analysis").json()
    assert before["portfolio"]["transactions_source"] == "aggregated"
    client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 5, "purchase_date": _ago(20)})
    after = client.get("/v1/funds/analysis").json()
    assert after["portfolio"]["transactions"] == 2
    assert after["portfolio"]["total_invested"] == pytest.approx(_paid(20, _published(rich, 150), _ago(150)) + _paid(5, _published(rich, 20), _ago(20)))
    assert client.get("/v1/funds").json()["holdings"][0]["units"] == 25


def test_redeeming_part_of_a_holding_records_a_sale_and_keeps_the_rest(client, rich):
    client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 10, "purchase_date": _ago(120)})
    r = client.post("/v1/funds/holdings/119598/redeem", json={"units": 4, "date": _ago(30)})
    assert r.status_code == 200, r.text
    row = r.json()["holdings"][0]
    assert row["units"] == 6
    assert row["avg_nav"] == pytest.approx(_published(rich, 120), abs=1e-3)  # remaining units keep their cost
    p = client.get("/v1/funds/analysis").json()["portfolio"]
    assert p["realised_proceeds"] == pytest.approx(4 * _published(rich, 30), abs=1e-2)


def test_redeeming_everything_removes_the_holding(client, rich):
    client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 10, "purchase_date": _ago(120)})
    r = client.post("/v1/funds/holdings/119598/redeem", json={"units": 10})
    assert r.status_code == 200 and r.json()["holdings"] == []


def test_redemption_guards(client, rich):
    client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 10, "purchase_date": _ago(60)})
    assert client.post("/v1/funds/holdings/119598/redeem", json={"units": 11}).status_code == 400
    assert client.post("/v1/funds/holdings/119598/redeem", json={"units": 1, "date": _ago(65)}).status_code == 400
    assert client.post("/v1/funds/holdings/119598/redeem", json={"units": 0}).status_code == 422
    assert client.post("/v1/funds/holdings/555/redeem", json={"units": 1}).status_code == 404


def test_removing_a_scheme_also_forgets_its_transactions(client, rich):
    client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 10, "purchase_date": _ago(90)})
    assert client.delete("/v1/funds/holdings/119598").status_code == 200
    client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 3, "purchase_date": _ago(90)})
    assert client.get("/v1/funds/analysis").json()["portfolio"]["transactions"] == 1


def test_portfolio_totals_carry_weights_and_the_nav_date(client, rich):
    client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 10})
    body = client.get("/v1/funds").json()
    assert body["holdings"][0]["weight_pct"] == pytest.approx(100.0)
    assert body["holdings"][0]["plan"] == "Direct"
    assert body["totals"]["as_of"] == _ago(0)
    assert "flags" not in body  # observations now come from /v1/funds/insights


def test_insights_endpoint_returns_prioritised_observations_and_validates_the_profile(client, rich):
    client.post("/v1/funds/holdings", json={"scheme_code": 119598, "units": 10, "purchase_date": _ago(90)})
    r = client.get("/v1/funds/insights", params={"risk": "moderate", "horizon": "5-10", "age": "bogus"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["profile"]["risk"] == "moderate" and body["profile"]["age"] is None and body["profile"]["complete"] is True
    assert len(body["insights"]) <= 5
    assert body["suitability"]["reference_low"] == 40.0
    assert any(i["id"] == "single-fund" for i in body["insights"])
    assert body["disclaimer"]


def test_new_routes_require_auth(client):
    assert client.get("/v1/funds/insights").status_code == 401
    assert client.post("/v1/funds/holdings/1/redeem", json={"units": 1}).status_code == 401
    assert client.get("/v1/funds/schemes/1/nav", params={"date": "2026-01-01"}).status_code == 401
