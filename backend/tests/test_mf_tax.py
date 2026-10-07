"""
Mutual-fund costs and tax: stamp duty that reduces units, classification, lot-level (SIP) taxation,
exit load, STT, redemption preview and the shared estimator vectors.
"""
from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path

import pytest

from backend import regulatory

from ..mutual_funds import costs, lots as lotlib, nav, tax

D = dt.date
TODAY = D(2026, 10, 5)
FY = "FY2026-27"


@dataclass
class H:
    scheme_code: int
    scheme_name: str
    units: float
    avg_nav: float
    purchase_date: str


@dataclass
class T:
    scheme_code: int
    kind: str
    trade_date: str
    units: float
    nav: float
    source: str = "entered"
    exit_load: float | None = None
    stt: float | None = None


def _history(rate: float = 0.0, base: float = 100.0, start: D = D(2017, 1, 1)):
    """A daily NAV history from `start` to TODAY growing `rate` per day from `base`."""
    out, day, i = [], start, 0
    while day <= TODAY:
        out.append((day, base * (1 + rate) ** i))
        day += dt.timedelta(days=1)
        i += 1
    return sorted(out, key=lambda p: p[0], reverse=True)


def _detail(category: str, name: str, rate: float = 0.0, base: float = 100.0):
    return {"fund_house": "Test AMC", "scheme_category": category, "scheme_name": name, "nav_history": _history(rate, base)}


@pytest.fixture
def funds(monkeypatch):
    details: dict[int, dict] = {}
    monkeypatch.setattr(nav, "get_scheme_detail", lambda code: details.get(code))
    return details


def _nav(details, code, day: D) -> float:
    return dict(details[code]["nav_history"])[day]


def _ago(days: int) -> D:
    return TODAY - dt.timedelta(days=days)


def _buy(details, code, days_ago: int, units: float) -> T:
    day = _ago(days_ago)
    return T(code, "buy", day.isoformat(), units, _nav(details, code, day))


def _view(holdings, txs, settings=None, profile=None, fy=FY):
    return tax.calculate_mutual_fund_tax(holdings, txs, settings or {}, profile or tax.EMPTY_PROFILE, fy, TODAY)


def _hold(code, name, txs):
    units = sum(t.units if t.kind == "buy" else -t.units for t in txs if t.scheme_code == code)
    first = min(t.trade_date for t in txs if t.scheme_code == code)
    return H(code, name, units, 100.0, first)


EQUITY = "Equity Scheme - Flexi Cap Fund"
LIQUID = "Debt Scheme - Liquid Fund"
GOLD = "Other Scheme - Gold ETF"


# --------------------------------------------------------------------------- stamp duty

def test_stamp_duty_comes_out_of_the_amount_and_reduces_units():
    p = costs.units_from_amount(10_000, 50.0, "2026-10-05")
    assert p["stamp_duty"] == 0.5  # 0.005%
    assert p["net_invested"] == 9999.5
    assert p["units"] == pytest.approx(9999.5 / 50.0)
    assert p["gross"] == 10_000  # what the investor paid


def test_units_on_a_statement_are_net_of_duty_so_the_amount_paid_is_grossed_up():
    g = costs.gross_from_units(199.99, 50.0, "2026-10-05")
    assert g["net_invested"] == 9999.5
    assert g["stamp_duty"] == 0.5
    assert g["gross"] == 10_000.0


def test_no_stamp_duty_before_it_existed_and_none_charged_on_a_redemption():
    assert costs.calculate_stamp_duty(10_000, "2020-06-30") == 0
    assert costs.calculate_stamp_duty(10_000, "2020-07-01") == 0.5
    sell = lotlib.Lot(1, TODAY, -10, 100.0)
    assert sell.stamp_duty == 0
    assert sell.amount == 1000.0


def test_a_lot_costs_its_units_plus_the_duty_inside_it_once():
    buy = lotlib.build_lots([], [T(1, "buy", "2026-06-01", 100.0, 100.0)])[0]
    assert buy.stamp_duty == costs.gross_from_units(100.0, 100.0, "2026-06-01")["stamp_duty"]
    assert buy.amount == pytest.approx(10_000 + buy.stamp_duty)
    book = lotlib.replay([buy])
    assert sum(o.cost for o in book.open_lots) == pytest.approx(buy.amount)  # not charged a second time


def test_distributor_transaction_charge_is_gone():
    cfg = regulatory.charges()["mutualFunds"]["distributorTransactionCharge"]
    assert cfg["status"] == "discontinued" and cfg["amount"] == 0


def test_stt_applies_to_equity_oriented_redemptions_only():
    assert costs.stt_on_redemption(75_000, "equity", "2026-10-05") == 0.75
    assert costs.stt_on_redemption(75_000, "specified", "2026-10-05") == 0
    assert costs.stt_on_redemption(75_000, "other", "2026-10-05") == 0


def test_exit_load_applies_per_lot_age_and_is_unavailable_until_entered():
    tiers = costs.normalize_exit_load([{"days": 365, "pct": 1.0}])
    assert costs.calculate_exit_load(10_000, 100, tiers) == 100
    assert costs.calculate_exit_load(10_000, 365, tiers) == 0  # the 365 days have passed
    assert costs.calculate_exit_load(10_000, 100, None) == 0
    assert costs.exit_load_text(None) == "Exit load information unavailable."
    assert "1% if redeemed within 365 days" in costs.exit_load_text(tiers)
    two = costs.normalize_exit_load([{"days": 30, "pct": 0.5}, {"days": 365, "pct": 1.0}])
    assert costs.exit_load_pct_for(10, two) == 0.5 and costs.exit_load_pct_for(100, two) == 1.0
    with pytest.raises(ValueError):
        costs.normalize_exit_load([{"days": 0, "pct": 1}])


# --------------------------------------------------------------------------- classification

@pytest.mark.parametrize("category,name,expected,certainty", [
    ("Equity Scheme - Flexi Cap Fund", "Some Flexi Cap Fund", "equity", "category"),
    ("Equity Scheme - ELSS", "Some Tax Saver", "equity", "category"),
    ("Hybrid Scheme - Arbitrage Fund", "Some Arbitrage", "equity", "category"),
    ("Hybrid Scheme - Aggressive Hybrid Fund", "Some Hybrid", "equity", "category"),
    ("Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage", "Some BAF", "equity", "depends"),
    ("Debt Scheme - Liquid Fund", "Some Liquid", "specified", "category"),
    ("Debt Scheme - Corporate Bond Fund", "Some Bond", "specified", "category"),
    ("Hybrid Scheme - Conservative Hybrid Fund", "Some Conservative", "specified", "category"),
    ("Other Scheme - Gold ETF", "Some Gold ETF", "other", "category"),
    ("Other Scheme - FoF Overseas", "Some US Fund of Fund", "other", "category"),
    ("Hybrid Scheme - Multi Asset Allocation", "Some Multi Asset", "other", "depends"),
    ("Hybrid Scheme - Balanced Hybrid Fund", "Some Balanced", "other", "category"),
    ("Other Scheme - Index Funds", "UTI Nifty 50 Index Fund", "equity", "category"),
    ("Other Scheme - Index Funds", "Bharat Bond Gilt Index Fund", "specified", "category"),
    ("Other Scheme - Index Funds", "Some Nasdaq 100 Index Fund", "other", "depends"),
    ("Solution Oriented Scheme - Retirement Fund", "Some Retirement", "unknown", "depends"),
    ("Unknown", "Whatever", "unknown", "depends"),
])
def test_scheme_classification(category, name, expected, certainty):
    c = tax.classify_scheme(category, name)
    assert c["tax_class"] == expected, c
    assert c["certainty"] == certainty, c


def test_a_user_override_wins_and_is_marked():
    c = tax.classify_scheme("Hybrid Scheme - Multi Asset Allocation", "Some Multi Asset", override="equity")
    assert c["tax_class"] == "equity" and c["certainty"] == "override" and c["source"] == "override"


def test_a_debt_fund_is_not_taxed_like_equity():
    assert tax.classify_scheme(LIQUID, "x")["tax_class"] != "equity"


# --------------------------------------------------------------------------- holding period

def test_holding_period_boundaries():
    assert tax.classify_holding_period(D(2025, 1, 10), D(2026, 1, 10), 12)["term"] == "short"
    assert tax.classify_holding_period(D(2025, 1, 10), D(2026, 1, 11), 12)["term"] == "long"
    assert tax.classify_holding_period(D(2024, 2, 29), D(2025, 2, 28), 12)["term"] == "short"
    assert tax.classify_holding_period(D(2024, 6, 1), D(2026, 6, 1), 24)["term"] == "short"
    assert tax.classify_holding_period(D(2024, 6, 1), D(2026, 6, 2), 24)["term"] == "long"
    p = tax.classify_holding_period(D(2025, 1, 10), D(2025, 7, 10), 12)
    assert p["long_term_from"] == D(2026, 1, 11) and p["text"] == "6 months"


# --------------------------------------------------------------------------- the estimator (shared vectors)

VECTORS = json.loads((Path(regulatory.__file__).parent / "tax_vectors.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", VECTORS, ids=[c["id"] for c in VECTORS])
def test_shared_vectors(case):
    profile = tax.TaxProfile() if not case["profile"] else tax.TaxProfile(
        case["profile"]["slabRatePct"], case["profile"]["incomeBand"], case["profile"]["regime"])
    est = tax.calculate_estimated_tax(case["fy"], case["items"], profile)
    got = {
        "supported": est["supported"], "taxBeforeSurchargeCess": est["tax_before_surcharge_cess"], "surcharge": est["surcharge"],
        "cess": est["cess"], "total": est["total"], "includesSurchargeCess": est["includes_surcharge_cess"],
        "exemptionApplied": est["exemption_applied"], "exemptionRoom": est["exemption_room"], "stcg": est["stcg"],
        "ltcg": est["ltcg"], "slabGainNotEstimated": est["slab_gain_not_estimated"],
        "unabsorbedLossLong": est["unabsorbed_loss"]["long"], "rulesAssumed": bool(est["rules"] and est["rules"]["assumed"]),
    }
    for key, want in case["expect"].items():
        if isinstance(want, bool):
            assert got[key] is want, f"{case['id']}.{key}"
        else:
            assert got[key] == pytest.approx(want, abs=0.01), f"{case['id']}.{key}"


def test_the_estimator_says_what_it_left_out():
    est = tax.calculate_estimated_tax(FY, [{"id": "a", "bucket": "stcg111A", "gain": -1000}], None)
    assert any("Advanced tax-loss adjustment requires additional tax information" in n for n in est["notes"])
    assert est["headline"] == "Estimated tax before surcharge and cess"


def test_two_years_do_not_share_an_exemption():
    a = tax.calculate_estimated_tax("FY2025-26", [{"id": "a", "bucket": "ltcg112A", "gain": 125000}])
    b = tax.calculate_estimated_tax("FY2026-27", [{"id": "b", "bucket": "ltcg112A", "gain": 125000}])
    assert a["total"] == 0 and b["total"] == 0
    both = tax.calculate_estimated_tax("FY2026-27", [{"id": "a", "bucket": "ltcg112A", "gain": 125000}, {"id": "b", "bucket": "ltcg112A", "gain": 125000}])
    assert both["total"] == pytest.approx(15625)


# --------------------------------------------------------------------------- per fund, per lot

def test_equity_fund_short_term_gain_is_taxed_at_20_percent_on_the_gain(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.001)
    txs = [_buy(funds, 1, 150, 100.0)]
    sell_day = _ago(30)
    txs.append(T(1, "sell", sell_day.isoformat(), 100.0, _nav(funds, 1, sell_day), exit_load=0.0, stt=costs.stt_on_redemption(100.0 * _nav(funds, 1, sell_day), "equity", sell_day)))
    r = _view([], txs)
    item = r["realized"]["items"][0]
    assert item["bucket"] == "stcg111A" and item["term"] == "short"
    buy_amount = lotlib.build_lots([], txs)[0].amount
    proceeds = 100.0 * _nav(funds, 1, sell_day)
    assert item["gain"] == pytest.approx(proceeds - buy_amount, abs=0.01)  # STT is not deducted from the gain
    assert r["realized"]["estimate"]["tax_before_surcharge_cess"] == pytest.approx(item["gain"] * 0.2, abs=0.01)
    # net P&L takes the STT off; the taxable gain does not
    assert item["net"] == pytest.approx(item["gross"] - item["stt"], abs=0.01)


def test_equity_ltcg_pays_only_above_the_exemption(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.0)
    funds[1]["nav_history"] = sorted([(d, 100.0 if d < _ago(10) else 400.0) for d, _ in funds[1]["nav_history"]], key=lambda p: p[0], reverse=True)
    txs = [_buy(funds, 1, 800, 1000.0), T(1, "sell", _ago(5).isoformat(), 1000.0, 400.0, exit_load=0.0, stt=4.0)]
    r = _view([], txs)
    item = r["realized"]["items"][0]
    assert item["bucket"] == "ltcg112A" and item["term"] == "long"
    est = r["realized"]["estimate"]
    assert est["exemption_applied"] == 125000
    assert est["tax_before_surcharge_cess"] == pytest.approx((item["gain"] - 125000) * 0.125, abs=0.01)
    assert est["tax_before_surcharge_cess"] < item["gain"] * 0.125  # never the flat 12.5% of the whole gain


def test_specified_fund_bought_after_april_2023_is_short_term_at_slab_whatever_the_period(funds):
    funds[2] = _detail(LIQUID, "Test Liquid Fund - Direct Plan - Growth", rate=0.0002)
    txs = [_buy(funds, 2, 900, 100.0), T(2, "sell", _ago(2).isoformat(), 100.0, _nav(funds, 2, _ago(2)), exit_load=0.0, stt=0.0)]
    r = _view([], txs)
    item = r["realized"]["items"][0]
    assert item["bucket"] == "stcgSlab" and item["term"] == "short" and item["deemed_short_term"] is True
    est = r["realized"]["estimate"]
    assert est["tax_before_surcharge_cess"] == 0 and est["slab_gain_not_estimated"] == pytest.approx(item["gain"])
    priced = _view([], txs, profile=tax.TaxProfile(slab_rate_pct=30.0))["realized"]["estimate"]
    assert priced["tax_before_surcharge_cess"] == pytest.approx(item["gain"] * 0.3, abs=0.01)


def test_specified_fund_bought_before_april_2023_gets_the_24_month_rule(funds):
    funds[2] = _detail(LIQUID, "Test Liquid Fund - Direct Plan - Growth", rate=0.0002)
    day = D(2022, 6, 1)
    txs = [T(2, "buy", day.isoformat(), 100.0, _nav(funds, 2, day)), T(2, "sell", _ago(2).isoformat(), 100.0, _nav(funds, 2, _ago(2)), exit_load=0.0, stt=0.0)]
    item = _view([], txs)["realized"]["items"][0]
    assert item["bucket"] == "ltcg112" and item["term"] == "long" and item["deemed_short_term"] is False


def test_other_fund_is_slab_inside_24_months_and_12_5_percent_after(funds):
    funds[3] = _detail(GOLD, "Test Gold Fund", rate=0.0003)
    short = [_buy(funds, 3, 450, 10.0), T(3, "sell", _ago(1).isoformat(), 10.0, _nav(funds, 3, _ago(1)), exit_load=0.0, stt=0.0)]
    assert _view([], short)["realized"]["items"][0]["bucket"] == "stcgSlab"
    long_ = [_buy(funds, 3, 900, 10.0), T(3, "sell", _ago(1).isoformat(), 10.0, _nav(funds, 3, _ago(1)), exit_load=0.0, stt=0.0)]
    est = _view([], long_)["realized"]["estimate"]
    assert est["buckets"]["ltcg112"]["tax"] == pytest.approx(est["buckets"]["ltcg112"]["taxable"] * 0.125, abs=0.01)
    assert est["exemption_applied"] == 0  # no Rs 1.25 lakh exemption for these funds


def test_each_sip_instalment_is_its_own_lot_with_its_own_term(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.0008)
    txs = []
    for m in range(18):  # 18 monthly instalments, the oldest about 18 months old
        d = _ago(30 * (18 - m))
        txs.append(T(1, "buy", d.isoformat(), 50.0, _nav(funds, 1, d)))
    holdings = [_hold(1, "Test Flexi Cap Fund - Direct Plan - Growth", txs)]
    pv = tax.redemption_preview(holdings, txs, 1, units=None, today=TODAY)
    assert len(pv["lots"]) == 18
    terms = [row["term"] for row in pv["lots"]]
    assert terms.count("long") == 6 and terms.count("short") == 12  # instalments over a year old vs younger
    assert terms == sorted(terms, key=lambda t: t != "long")  # oldest first
    assert pv["long_term_gain"] > 0 and pv["short_term_gain"] > 0
    assert all(row["bucket"] in ("ltcg112A", "stcg111A") for row in pv["lots"])


def test_a_partial_redemption_uses_the_oldest_units_first(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.001)
    txs = [_buy(funds, 1, 700, 100.0), _buy(funds, 1, 100, 100.0)]
    holdings = [_hold(1, "Test Flexi Cap Fund - Direct Plan - Growth", txs)]
    pv = tax.redemption_preview(holdings, txs, 1, units=120.0, today=TODAY)
    assert [(row["units"], row["term"]) for row in pv["lots"]] == [(100.0, "long"), (20.0, "short")]
    assert pv["units"] == 120.0 and pv["all_units"] is False
    fund = _view(holdings, txs)["funds"][0]
    assert fund["lot_count"] == 2 and fund["long_term_units"] == 100.0


def test_redemption_preview_steps_and_no_double_counting(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.001)
    txs = [_buy(funds, 1, 100, 500.0)]
    holdings = [_hold(1, "Test Flexi Cap Fund - Direct Plan - Growth", txs)]
    settings = {1: {"exit_load": [{"days": 365, "pct": 1.0}]}}
    pv = tax.redemption_preview(holdings, txs, 1, units=500.0, settings=settings, today=TODAY)
    gross = 500.0 * pv["nav"]
    assert pv["gross"] == pytest.approx(gross, abs=0.01)
    assert pv["exit_load"]["status"] == "applied"  # 100 days is inside the 365-day window
    assert pv["exit_load"]["amount"] == pytest.approx(gross * 0.01, abs=0.01)
    assert pv["stt"]["amount"] == pytest.approx(gross * 0.00001, abs=0.01)
    # each step comes off once: gross, then exit load and STT, then the tax estimate
    assert pv["proceeds_after_charges"] == pytest.approx(gross - pv["exit_load"]["amount"] - pv["stt"]["amount"], abs=0.01)
    assert pv["estimated_net_proceeds"] == pytest.approx(pv["proceeds_after_charges"] - pv["estimated_tax"], abs=0.01)
    # the stamp duty was paid at purchase and sits inside the cost, so the gain is proceeds - exit load - cost
    buy_amount = lotlib.build_lots([], txs)[0].amount
    assert pv["cost"] == pytest.approx(buy_amount, abs=0.01)
    assert pv["taxable_gain"] == pytest.approx(gross - pv["exit_load"]["amount"] - buy_amount, abs=0.01)


def test_exit_load_applies_to_young_lots_only(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.001)
    txs = [_buy(funds, 1, 500, 100.0), _buy(funds, 1, 100, 100.0)]
    holdings = [_hold(1, "Test Flexi Cap Fund - Direct Plan - Growth", txs)]
    settings = {1: {"exit_load": [{"days": 365, "pct": 1.0}]}}
    pv = tax.redemption_preview(holdings, txs, 1, units=None, settings=settings, today=TODAY)
    young = [row for row in pv["lots"] if row["held_text"].endswith("days") or "month" in row["held_text"]]
    assert pv["exit_load"]["status"] == "applied"
    assert pv["exit_load"]["amount"] == pytest.approx(sum(row["exit_load"] for row in pv["lots"]), abs=0.01)
    assert [row["exit_load"] > 0 for row in pv["lots"]] == [False, True]  # the 500-day lot is past the window
    assert pv["exit_load"]["amount"] == pytest.approx(100.0 * pv["nav"] * 0.01, abs=0.01)
    # exit load is a transfer expense, so it reduces the gain
    base = tax.redemption_preview(holdings, txs, 1, units=None, today=TODAY)
    assert pv["taxable_gain"] == pytest.approx(base["taxable_gain"] - pv["exit_load"]["amount"], abs=0.01)
    assert young


def test_exit_load_is_unavailable_until_entered_and_never_invented(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.001)
    txs = [_buy(funds, 1, 100, 100.0)]
    holdings = [_hold(1, "Test Flexi Cap Fund - Direct Plan - Growth", txs)]
    pv = tax.redemption_preview(holdings, txs, 1, units=None, today=TODAY)
    assert pv["exit_load"]["status"] == "unavailable" and pv["exit_load"]["amount"] is None
    assert pv["exit_load"]["text"] == "Exit load information unavailable."
    assert any("Exit load information unavailable" in n for n in pv["notes"])


def test_redemption_preview_stt_and_labels(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.001)
    txs = [_buy(funds, 1, 100, 200.0)]
    holdings = [_hold(1, "Test Flexi Cap Fund - Direct Plan - Growth", txs)]
    pv = tax.redemption_preview(holdings, txs, 1, units=200.0, today=TODAY)
    assert pv["stt"]["amount"] == pytest.approx(pv["gross"] * 0.00001, abs=0.01)
    assert pv["proceeds_after_charges"] == pytest.approx(pv["gross"] - pv["stt"]["amount"], abs=0.01)  # no exit load entered: none deducted
    assert pv["after_tax"]["label"] == "Estimated after-tax value on redemption"
    assert "Stamp duty was taken out when the units were bought" in " ".join(pv["notes"])
    debt = {2: _detail(LIQUID, "Test Liquid Fund - Direct Plan - Growth", rate=0.0002)}
    funds.update(debt)
    t2 = [_buy(funds, 2, 100, 200.0)]
    pv2 = tax.redemption_preview([_hold(2, "Test Liquid Fund - Direct Plan - Growth", t2)], t2, 2, units=200.0, today=TODAY)
    assert pv2["stt"]["amount"] == 0  # STT is for equity-oriented units only


def test_the_exemption_is_shared_with_gains_already_realised_this_year(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.0)
    flat = [(d, 100.0) for d, _ in funds[1]["nav_history"]]
    funds[1]["nav_history"] = sorted([(d, 100.0 if d < _ago(60) else 300.0) for d, _ in flat], key=lambda p: p[0], reverse=True)
    funds[2] = _detail(EQUITY, "Other Flexi Cap Fund - Direct Plan - Growth", rate=0.0)
    funds[2]["nav_history"] = sorted([(d, 100.0 if d < _ago(60) else 120.0) for d, _ in flat], key=lambda p: p[0], reverse=True)
    # Fund 1: 600 units bought 800 days ago, 500 of them sold 40 days ago at 300 -> about 100,000 of long-term gain realised.
    txs = [
        T(1, "buy", _ago(800).isoformat(), 600.0, 100.0),
        T(1, "sell", _ago(40).isoformat(), 500.0, 300.0, exit_load=0.0, stt=0.0),
        T(2, "buy", _ago(800).isoformat(), 1000.0, 100.0),
    ]
    holdings = [H(1, "Test Flexi Cap Fund - Direct Plan - Growth", 100.0, 100.0, _ago(800).isoformat()),
                H(2, "Other Flexi Cap Fund - Direct Plan - Growth", 1000.0, 100.0, _ago(800).isoformat())]
    r = _view(holdings, txs)
    assert r["realized"]["estimate"]["exemption_room"] == pytest.approx(125000 - 100_000 - 0.0, abs=100)
    pv = tax.redemption_preview(holdings, txs, 2, units=None, today=TODAY)
    room_before = r["realized"]["estimate"]["exemption_room"]
    # the new gain (about 20,000) fits inside the room left, so the marginal tax is nil...
    assert pv["taxable_gain"] < room_before
    assert pv["estimated_tax"] == 0
    # ...and beyond it, 12.5% applies
    funds[2]["nav_history"] = sorted([(d, 100.0 if d < _ago(60) else 300.0) for d, _ in flat], key=lambda p: p[0], reverse=True)
    pv2 = tax.redemption_preview(holdings, txs, 2, units=None, today=TODAY)
    assert pv2["estimated_tax"] == pytest.approx((pv2["taxable_gain"] - room_before) * 0.125, abs=1.0)


def test_realised_gains_are_split_by_financial_year(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.001)
    mar, may = D(2026, 3, 20), D(2026, 5, 10)
    txs = [
        T(1, "buy", D(2025, 11, 1).isoformat(), 100.0, _nav(funds, 1, D(2025, 11, 1))),
        T(1, "sell", mar.isoformat(), 40.0, _nav(funds, 1, mar), exit_load=0.0, stt=0.0),
        T(1, "sell", may.isoformat(), 40.0, _nav(funds, 1, may), exit_load=0.0, stt=0.0),
    ]
    holdings = [H(1, "Test Flexi Cap Fund - Direct Plan - Growth", 20.0, 100.0, "2025-11-01")]
    assert [y["fy"] for y in _view(holdings, txs)["years"]] == ["FY2026-27", "FY2025-26"]
    assert len(_view(holdings, txs, fy="FY2025-26")["realized"]["items"]) == 1
    assert len(_view(holdings, txs, fy="FY2026-27")["realized"]["items"]) == 1
    assert _view(holdings, txs, fy="FY2024-25")["realized"]["estimate"]["supported"] is False


def test_unrealised_gain_is_not_presented_as_a_liability(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.001)
    txs = [_buy(funds, 1, 300, 100.0)]
    holdings = [_hold(1, "Test Flexi Cap Fund - Direct Plan - Growth", txs)]
    r = _view(holdings, txs)
    assert r["realized"]["estimate"]["total"] == 0 and r["realized"]["items"] == []
    assert r["unrealized"]["gain"] > 0
    assert "not taxed until units are redeemed" in r["unrealized"]["note"]
    fund = r["funds"][0]
    assert fund["unrealized_gain"] == pytest.approx(r["unrealized"]["gain"], abs=0.02)
    assert fund["tax_if_redeemed"] is not None and fund["note"]


def test_confidence_reflects_what_was_assumed_or_missing(funds):
    funds[1] = _detail(EQUITY, "Test Flexi Cap Fund - Direct Plan - Growth", rate=0.001)
    funds[9] = _detail("Solution Oriented Scheme - Retirement Fund", "Some Retirement Fund - Direct Plan - Growth", rate=0.001)
    txs = [_buy(funds, 1, 300, 100.0)]
    holdings = [_hold(1, "Test Flexi Cap Fund - Direct Plan - Growth", txs)]
    est = _view(holdings, txs)["unrealized"]["confidence"]
    assert est["level"] == "estimated"  # no income band set
    complete = _view(holdings, txs, profile=tax.TaxProfile(slab_rate_pct=30.0, income_band="up_to_50l"), settings={1: {"exit_load": [{"days": 365, "pct": 1}]}})
    assert complete["unrealized"]["confidence"]["level"] == "high"  # dated lots, settled class, profile and exit load all given
    txs2 = txs + [_buy(funds, 9, 200, 50.0)]
    holdings2 = holdings + [_hold(9, "Some Retirement Fund - Direct Plan - Growth", txs2)]
    low = _view(holdings2, txs2)["unrealized"]["confidence"]
    assert low["level"] == "incomplete" and low["coverage_pct"] < 100
    assert "Based on" in low["basis"]


def test_override_changes_the_estimate(funds):
    funds[9] = _detail("Solution Oriented Scheme - Retirement Fund", "Some Retirement Fund - Direct Plan - Growth", rate=0.001)
    txs = [_buy(funds, 9, 200, 50.0)]
    holdings = [_hold(9, "Some Retirement Fund - Direct Plan - Growth", txs)]
    unknown = _view(holdings, txs)["funds"][0]  # unknown class: shown, but no tax is guessed
    assert unknown["classification"]["tax_class"] == "unknown" and unknown["tax_if_redeemed"] is None and unknown["lots"] == []
    with pytest.raises(ValueError):
        tax.redemption_preview(holdings, txs, 5, units=None, today=TODAY)  # no such fund
    r = _view(holdings, txs, settings={9: {"tax_class": "equity"}})
    assert r["funds"][0]["classification"]["source"] == "override"
    assert r["funds"][0]["tax_if_redeemed"] is not None


def test_grandfathering_uses_the_31_jan_2018_nav_for_old_equity_units(funds):
    detail = _detail(EQUITY, "Old Flexi Cap Fund - Direct Plan - Growth", rate=0.0)
    detail["nav_history"] = sorted(
        [(d, 100.0 if d < D(2018, 1, 31) else (150.0 if d < _ago(10) else 200.0)) for d, _ in detail["nav_history"]],
        key=lambda p: p[0], reverse=True,
    )
    funds[1] = detail
    txs = [T(1, "buy", "2016-06-01", 100.0, 100.0), T(1, "sell", _ago(3).isoformat(), 100.0, 200.0, exit_load=0.0, stt=0.0)]
    item = _view([], txs)["realized"]["items"][0]
    # cost = the higher of what was paid (about 10,000) and the lower of the 31 Jan 2018 value (15,000) and the sale value (20,000)
    assert item["cost"] == pytest.approx(15_000.0, abs=0.01)
    assert item["gain"] == pytest.approx(5_000.0, abs=0.01)  # the gain before 2018 is not taxed


def test_after_tax_return_helpers():
    assert tax.calculate_net_pnl(25000, 1250) == {"gross": 25000, "charges": 1250, "net": 23750}
    r = tax.calculate_after_tax_return(100000, 14200, 350, 2400, realized=True)
    assert r["after_tax_return_pct"] == pytest.approx(11.45) and r["label"] == "After-tax return"
    open_ = tax.calculate_after_tax_return(100000, 14200, 350, 2400, realized=False)
    assert open_["after_tax_return_pct"] is None and open_["tax"] is None
    assert open_["label"] == "Estimated after-tax value on redemption"


def test_the_disclosures_are_present():
    assert "not tax advice" in tax.DISCLOSURE.lower()
    assert "Based on available transaction history" in tax.HISTORY_NOTE
