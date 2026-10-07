"""Tests for the prioritised, non-advisory insights engine (backend/mutual_funds/insights.py)."""
from __future__ import annotations

import pytest

from ..mutual_funds import insights
from ..mutual_funds.insights import BANNED_PHRASES, InvestorProfile, build_insights, reference_range


def row(code, name, category, house, value, plan="Direct", ok=True):
    return {
        "scheme_code": code, "scheme_name": name, "scheme_category": category, "fund_house": house,
        "value": value, "plan": plan, "data_available": ok,
    }


EQ_LARGE = "Equity Scheme - Large Cap Fund"
EQ_SMALL = "Equity Scheme - Small Cap Fund"
EQ_FLEXI = "Equity Scheme - Flexi Cap Fund"
DEBT = "Debt Scheme - Liquid Fund"
HYBRID = "Hybrid Scheme - Balanced Hybrid Fund"


def ids(result):
    return [i["id"] for i in result["insights"] + result["also_noted"]]


def by_id(result, id_):
    return next(i for i in result["insights"] + result["also_noted"] if i["id"] == id_)


def all_text(result):
    parts = []
    for i in result["insights"] + result["also_noted"]:
        parts += [i["title"], i["why"], i["review"], *i["evidence"]]
    if result.get("suitability"):
        parts.append(result["suitability"]["text"])
    return " ".join(parts).lower()


# --------------------------------------------------------------------------- concentration

def test_single_fund_portfolio_is_high_priority():
    r = build_insights([row(1, "A Fund", EQ_FLEXI, "AMC1", 100_000)], InvestorProfile())
    assert by_id(r, "single-fund")["severity"] == "high"


def test_one_fund_over_40_percent_is_high_and_over_25_is_medium():
    big = [row(1, "A", EQ_FLEXI, "AMC1", 50_000), row(2, "B", EQ_LARGE, "AMC2", 30_000), row(3, "C", DEBT, "AMC3", 20_000)]
    assert by_id(build_insights(big, InvestorProfile()), "fund-1")["severity"] == "high"
    medium = [row(1, "A", EQ_FLEXI, "AMC1", 30_000), row(2, "B", EQ_LARGE, "AMC2", 25_000), row(3, "C", DEBT, "AMC3", 25_000), row(4, "D", DEBT, "AMC4", 20_000)]
    assert by_id(build_insights(medium, InvestorProfile()), "fund-1")["severity"] == "medium"


def test_fund_house_concentration_across_different_funds():
    rows = [row(1, "A", EQ_FLEXI, "HDFC", 40_000), row(2, "B", EQ_LARGE, "HDFC", 30_000), row(3, "C", DEBT, "SBI", 30_000)]
    got = by_id(build_insights(rows, InvestorProfile()), "amc")
    assert got["severity"] == "high" and "70%" in got["title"]


def test_three_funds_in_one_category_is_flagged():
    rows = [row(i, f"F{i}", EQ_FLEXI, f"AMC{i}", 20_000) for i in range(1, 4)] + [row(9, "D", DEBT, "AMC9", 40_000)]
    assert any(i.startswith("category-") for i in ids(build_insights(rows, InvestorProfile())))


def test_balanced_portfolio_raises_no_concentration_flags():
    rows = [row(1, "A", EQ_FLEXI, "AMC1", 20_000), row(2, "B", EQ_LARGE, "AMC2", 20_000), row(3, "C", DEBT, "AMC3", 20_000),
            row(4, "D", HYBRID, "AMC4", 20_000), row(5, "E", "Equity Scheme - Mid Cap Fund", "AMC5", 20_000)]
    got = ids(build_insights(rows, InvestorProfile()))
    assert not any(i.startswith(("fund-", "amc", "single")) for i in got)


# --------------------------------------------------------------------------- suitability

def test_reference_range_follows_risk_and_horizon():
    assert reference_range(InvestorProfile()) is None
    assert reference_range(InvestorProfile(risk="moderate")) == (40.0, 65.0)
    lo, hi = reference_range(InvestorProfile(risk="aggressive", horizon="lt3"))
    assert hi == 30.0 and lo <= hi
    assert reference_range(InvestorProfile(risk="aggressive", horizon="10+"))[1] == 95.0
    assert reference_range(InvestorProfile(risk="moderate", objective="preservation"))[1] == 40.0


def test_equity_above_the_reference_range_is_described_as_possibly_aggressive_not_wrong():
    rows = [row(1, "A", EQ_FLEXI, "AMC1", 40_000), row(2, "B", EQ_SMALL, "AMC2", 40_000), row(3, "C", DEBT, "AMC3", 20_000)]
    r = build_insights(rows, InvestorProfile(risk="moderate", horizon="3-5"))
    got = by_id(r, "equity-above")
    assert "may be a relatively aggressive allocation" in got["why"]
    assert got["review"].startswith("Consider reviewing")
    assert r["suitability"]["status"] == "above"
    assert r["suitability"]["equity_pct"] == pytest.approx(80.0)


def test_within_range_has_no_risk_flag():
    rows = [row(1, "A", EQ_FLEXI, "AMC1", 30_000), row(2, "B", EQ_LARGE, "AMC2", 25_000), row(3, "C", DEBT, "AMC3", 45_000)]
    r = build_insights(rows, InvestorProfile(risk="moderate", horizon="5-10"))
    assert r["suitability"]["status"] == "within"
    assert "equity-above" not in ids(r)


def test_small_cap_and_thematic_share_is_compared_with_the_risk_tolerance():
    rows = [row(1, "A", EQ_SMALL, "AMC1", 30_000), row(2, "B", "Equity Scheme - Sectoral/Thematic", "AMC2", 20_000),
            row(3, "C", DEBT, "AMC3", 50_000)]
    r = build_insights(rows, InvestorProfile(risk="conservative", horizon="5-10"))
    assert by_id(r, "high-risk-categories")["severity"] == "medium"
    assert "high-risk-categories" not in ids(build_insights(rows, InvestorProfile(risk="aggressive", horizon="10+")))  # 50% is within an aggressive reference
    heavy = [row(1, "A", EQ_SMALL, "AMC1", 70_000), row(2, "C", DEBT, "AMC3", 30_000)]
    assert by_id(build_insights(heavy, InvestorProfile(risk="aggressive", horizon="10+")), "high-risk-categories")["severity"] == "info"


def test_hybrid_share_is_reported_separately_not_guessed_as_equity():
    rows = [row(1, "A", HYBRID, "AMC1", 60_000), row(2, "B", EQ_FLEXI, "AMC2", 40_000)]
    r = build_insights(rows, InvestorProfile(risk="moderate", horizon="5-10"))
    assert r["suitability"]["equity_pct"] == pytest.approx(40.0)
    assert r["suitability"]["hybrid_pct"] == pytest.approx(60.0)
    assert "not known" in r["suitability"]["text"]


def test_missing_profile_prompts_for_context_instead_of_judging():
    r = build_insights([row(1, "A", EQ_FLEXI, "AMC1", 50_000), row(2, "B", DEBT, "AMC2", 50_000)], InvestorProfile())
    assert "profile-missing" in ids(r) and r["suitability"] is None


# --------------------------------------------------------------------------- performance honesty

def _report(verdicts):
    return {
        "period": {"days": 10 if all(v == "too_early" for v in verdicts) else 400},
        "funds": [
            {"scheme_name": f"F{i}", "verdict": v, "relative_pp": rel, "benchmark": {"label": "Nifty 500"}, "period": {"label": "x"}}
            for i, (v, rel) in enumerate(zip(verdicts, [-3.0, 1.0, -1.5, 2.0][: len(verdicts)]))
        ],
    }


def test_short_history_gets_no_performance_judgement():
    r = build_insights([row(1, "A", EQ_FLEXI, "AMC1", 100)], InvestorProfile(), _report(["too_early"]))
    got = by_id(r, "perf-early")
    assert got["severity"] == "info" and "10 days" in got["why"]


def test_underperformance_is_reported_with_the_gap_but_not_as_a_reason_to_exit():
    rows = [row(1, "A", EQ_FLEXI, "AMC1", 50), row(2, "B", EQ_LARGE, "AMC2", 50)]
    r = build_insights(rows, InvestorProfile(), _report(["underperformed", "outperformed"]))
    got = by_id(r, "perf-under")
    assert "1 of 2" in got["title"]
    assert "not on its own a reason" in got["why"]
    assert "-3.0 pts" in got["evidence"][0]


# --------------------------------------------------------------------------- cost, efficiency, unavailable

def test_regular_plans_are_noted_without_a_recommendation_to_switch():
    rows = [row(1, "A", EQ_FLEXI, "AMC1", 50_000, plan="Regular"), row(2, "B", EQ_LARGE, "AMC2", 50_000, plan="Regular")]
    r = build_insights(rows, InvestorProfile(horizon="10+"))
    got = by_id(r, "regular-plans")
    assert got["severity"] == "medium"
    assert "not connected" in got["why"]
    assert "switch" not in all_text(r)


def test_regular_plans_are_informational_for_a_short_horizon():
    rows = [row(1, "A", EQ_FLEXI, "AMC1", 50_000, plan="Regular"), row(2, "B", DEBT, "AMC2", 50_000)]
    assert by_id(build_insights(rows, InvestorProfile(horizon="lt3")), "regular-plans")["severity"] == "info"


def test_overlap_is_declared_unavailable_never_inferred():
    r = build_insights([row(1, "A", EQ_FLEXI, "AMC1", 50), row(2, "B", EQ_LARGE, "AMC2", 50)], InvestorProfile())
    got = by_id(r, "overlap-unavailable")
    assert got["title"] == "Holdings overlap unavailable"
    assert "not connected" in got["why"]


def test_many_funds_and_tiny_positions():
    rows = [row(i, f"F{i}", EQ_FLEXI if i % 2 else EQ_LARGE, f"AMC{i}", 100_000 if i < 4 else 1_000) for i in range(1, 13)]
    got = ids(build_insights(rows, InvestorProfile()))
    assert "many-funds" in got and "small-positions" in got


def test_scheme_without_a_nav_is_called_out_and_excluded():
    rows = [row(1, "A", EQ_FLEXI, "AMC1", 100_000), row(2, "Ghost", "Unknown", "Unknown", 0.0, ok=False)]
    r = build_insights(rows, InvestorProfile())
    assert by_id(r, "no-nav")["severity"] == "medium"
    assert r["stats"]["funds"] == 1


def test_empty_book_returns_nothing_to_say():
    r = build_insights([], InvestorProfile())
    assert r["insights"] == [] and r["suitability"] is None


# --------------------------------------------------------------------------- prioritisation and language

def test_at_most_five_insights_are_shown_highest_severity_first():
    rows = [row(i, f"F{i}", EQ_SMALL if i < 3 else EQ_FLEXI, "HDFC", 100_000 if i == 1 else 10_000, plan="Regular") for i in range(1, 13)]
    r = build_insights(rows, InvestorProfile(risk="conservative", horizon="lt3"), _report(["underperformed"] * 4))
    assert len(r["insights"]) <= 5
    order = [insights.SEVERITY_RANK[i["severity"]] for i in r["insights"]]
    assert order == sorted(order)
    assert r["insights"][0]["severity"] == "high"
    assert len(r["insights"]) + len(r["also_noted"]) >= 6  # the rest is kept, not dropped


def test_every_insight_explains_why_and_what_to_review_and_cites_evidence_where_numeric():
    rows = [row(1, "A", EQ_FLEXI, "HDFC", 70_000, plan="Regular"), row(2, "B", EQ_SMALL, "HDFC", 30_000)]
    r = build_insights(rows, InvestorProfile(risk="conservative", horizon="3-5"), _report(["underperformed", "outperformed"]))
    for i in r["insights"] + r["also_noted"]:
        assert i["title"] and i["why"] and i["review"]
        assert i["severity"] in ("high", "medium", "info")


@pytest.mark.parametrize("profile", [
    InvestorProfile(),
    InvestorProfile(risk="conservative", horizon="lt3", objective="preservation", age="55+"),
    InvestorProfile(risk="aggressive", horizon="10+", objective="wealth", age="u25"),
])
def test_no_advisory_or_absolute_language_anywhere(profile):
    rows = [row(1, "A", EQ_FLEXI, "HDFC", 60_000, plan="Regular"), row(2, "B", EQ_SMALL, "HDFC", 30_000),
            row(3, "C", HYBRID, "SBI", 10_000)]
    text = all_text(build_insights(rows, profile, _report(["underperformed", "outperformed", "in_line"])))
    for phrase in BANNED_PHRASES:
        assert phrase not in text
    for word in (" sell ", " buy ", " exit ", "bad fund", "safe portfolio"):
        assert word not in f" {text} "


def test_profile_params_are_validated():
    p = InvestorProfile.from_params(age="nope", horizon="10+", risk="moderate", objective="???")
    assert p.age is None and p.objective is None and p.horizon == "10+" and p.risk == "moderate"
    assert p.usable and not InvestorProfile.from_params().usable
    assert "Moderate" in p.label()


def test_a_book_of_index_funds_gets_no_performance_verdict_after_enough_days():
    rep = {"period": {"days": 400}, "funds": [{"scheme_name": "N50", "verdict": "tracking", "relative_pp": 1.1, "benchmark": {"label": "Nifty 50"}, "period": {"label": "x"}}]}
    r = build_insights([row(1, "N50 Index", "Other Scheme - Index Funds", "AMC1", 100_000)], InvestorProfile(), rep)
    assert "perf-early" not in ids(r) and "perf-under" not in ids(r)
