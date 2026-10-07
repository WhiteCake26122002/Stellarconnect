"""The central charge and tax configuration: dated rates, versioned rules, and the frontend mirror staying identical."""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

import pytest

from backend import regulatory

ROOT = Path(__file__).resolve().parents[2]


def test_the_frontend_mirror_is_byte_for_byte_the_same():
    mirror = ROOT / "frontend" / "lib" / "regulatory"
    if not mirror.exists():
        pytest.skip("frontend not present")
    for name in ("charges.json", "tax_rules.json", "tax_vectors.json"):
        assert (mirror / name).read_bytes() == (Path(regulatory.__file__).parent / name).read_bytes(), f"{name} drifted: run `npm run sync:regulatory` in frontend/"


def test_every_schedule_is_dated_and_in_order():
    def walk(node, path=""):
        if isinstance(node, list) and node and isinstance(node[0], dict) and "from" in node[0]:
            dates = [e["from"] for e in node]
            assert dates == sorted(dates), f"{path} is out of order"
            for e in node:
                dt.date.fromisoformat(e["from"])
                assert e["pct"] >= 0
        elif isinstance(node, dict):
            for k, v in node.items():
                walk(v, f"{path}.{k}")

    walk(regulatory.charges())


def test_rate_on_follows_the_date():
    sched = regulatory.charges()["futures"]["stt"]["sell"]
    assert regulatory.rate_on(sched, "2026-03-31") == 0.02
    assert regulatory.rate_on(sched, "2026-04-01") == 0.05
    assert regulatory.rate_on(sched, dt.date(2030, 1, 1)) == 0.05  # latest known rate carries on
    assert regulatory.rate_on(sched, "2000-01-01") == 0.02  # earliest known rate before the first entry


def test_each_charge_depends_on_segment_and_side():
    c = regulatory.charges()
    assert regulatory.rate_on(c["equityDelivery"]["stt"]["buy"], "2026-10-05") == 0.1
    assert regulatory.rate_on(c["equityDelivery"]["stt"]["sell"], "2026-10-05") == 0.1
    assert regulatory.rate_on(c["equityIntraday"]["stt"]["buy"], "2026-10-05") == 0
    assert regulatory.rate_on(c["equityIntraday"]["stt"]["sell"], "2026-10-05") == 0.025
    stamp = c["stampDuty"]
    rates = {k: regulatory.rate_on(stamp[k]["buy"], "2026-10-05") for k in ("equityDelivery", "equityIntraday", "futures", "options")}
    assert rates["equityDelivery"] != rates["equityIntraday"] != rates["futures"]  # never one rate for every trade
    assert len(set(rates.values())) >= 3
    assert all(regulatory.rate_on(stamp[k]["sell"], "2026-10-05") == 0 for k in rates)
    assert regulatory.rate_on(c["mutualFunds"]["stampDuty"]["ratePct"], "2026-10-05") == 0.005
    assert regulatory.rate_on(c["mutualFunds"]["stampDuty"]["ratePct"], "2020-06-30") == 0


def test_financial_year_helpers():
    assert regulatory.financial_year_of("2026-03-31") == "FY2025-26"
    assert regulatory.financial_year_of("2026-04-01") == "FY2026-27"
    assert regulatory.fy_bounds("FY2026-27") == (dt.date(2026, 4, 1), dt.date(2027, 3, 31))
    assert regulatory.fy_label("FY2026-27") == "FY 2026-27"


def test_rules_are_versioned_by_financial_year():
    cfg = regulatory.tax_rules()
    assert set(cfg["financialYears"]) >= {"FY2025-26", "FY2026-27"}
    r = regulatory.rules_for("FY2026-27")
    assert r["equity"]["stcgRatePct"] == 20 and r["equity"]["ltcgRatePct"] == 12.5 and r["equity"]["ltcgExemption"] == 125000
    assert not r.assumed
    future = regulatory.rules_for("FY2027-28")
    assert future.assumed and "carried forward" in future.note and future.source_fy == "FY2026-27"
    assert regulatory.rules_for("FY2027-28", carry_forward=False) is None
    assert regulatory.rules_for("FY2024-25") is None and "changed" in regulatory.unsupported_reason("FY2024-25")
    assert regulatory.unsupported_reason("FY2020-21")


def test_distributor_charge_is_recorded_as_discontinued():
    d = regulatory.charges()["mutualFunds"]["distributorTransactionCharge"]
    assert d["status"] == "discontinued" and d["since"] == "2025-08-08" and d["amount"] == 0


def test_broker_profiles_are_configurable_and_the_default_exists():
    b = regulatory.charges()["brokerProfiles"]
    assert b["default"] in b["profiles"]
    for p in b["profiles"].values():
        for seg in ("equityDelivery", "equityIntraday", "futures", "options"):
            assert set(p[seg]) <= {"pct", "flat", "cap", "min"}
    assert b["profiles"]["discount-flat"]["equityDelivery"] == {"flat": 0}  # some brokers charge nothing on delivery


def test_no_tax_or_charge_rate_is_hard_coded_outside_the_configuration():
    """The rates live in backend/regulatory/*.json. A literal for one in the tax and cost code would be a second source of truth."""
    forbidden = re.compile(r"(?<![\w.])(0\.125|12\.5|125000|1_25_000|0\.00297|0\.00307|0\.00005|0\.00001)(?![\w])")
    for rel in ("backend/mutual_funds/tax.py", "backend/mutual_funds/costs.py", "backend/mutual_funds/lots.py", "backend/mutual_funds/sip.py"):
        text = (ROOT / rel).read_text(encoding="utf-8")
        code = re.sub(r'"""[\s\S]*?"""', "", text)  # docstrings explain the rules; they are not rules
        code = re.sub(r"#.*", "", code)
        hits = [m.group(0) for m in forbidden.finditer(code)]
        assert not hits, f"{rel} contains a hard-coded rate: {hits}"
