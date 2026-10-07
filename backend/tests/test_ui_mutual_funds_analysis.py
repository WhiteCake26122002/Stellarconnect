"""Smoke test for the legacy Streamlit mutual-fund analysis tab: a short holding must not be annualized."""
from __future__ import annotations

import datetime as dt
import os

import pytest
from streamlit.testing.v1 import AppTest

import ui_mutual_funds
from ..mutual_funds import nav


def _index(days: int, start: float, end: float):
    today = dt.date.today()
    return [(today - dt.timedelta(days=days - i), start * (end / start) ** (i / days)) for i in range(days + 1)]


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setattr(nav, "get_index_history", lambda ticker: _index(900, 20_000.0, 19_400.0))
    monkeypatch.setattr(ui_mutual_funds, "_portfolio_growth_series", lambda available, histories: None)


def _run(held_days: int) -> AppTest:
    def app():
        import datetime as dt
        import os

        import ui_mutual_funds

        today = dt.date.today()
        days = int(os.environ["MF_HELD_DAYS"])
        ui_mutual_funds._analysis_tab([{
            "scheme_name": "Test Flexi Cap Fund", "scheme_category": "Equity Scheme - Flexi Cap Fund",
            "fund_house": "Test AMC", "invested": 10_000.0, "value": 9_800.0,
            "purchase_date": today - dt.timedelta(days=days), "data_available": True,
        }])

    os.environ["MF_HELD_DAYS"] = str(held_days)
    at = AppTest.from_function(app, default_timeout=30)
    return at.run()


def _text(at: AppTest) -> str:
    parts = [m.value for m in at.markdown] + [c.value for c in at.caption] + [f"{m.label} {m.value}" for m in at.metric]
    return "\n".join(str(p) for p in parts)


def test_ten_day_holding_shows_a_plain_return_not_an_annual_rate():
    at = _run(10)
    assert not at.exception, at.exception
    text = _text(at)
    assert "Portfolio return vs Benchmarks" in text
    assert "not annualized" in text
    assert "Too early to call" in text
    assert "Portfolio XIRR vs Benchmarks" not in text
    assert "Your XIRR" not in text
    returns = [float(m.value.rstrip("%")) for m in at.metric if m.value.endswith("%")]
    assert returns and all(abs(r) < 20 for r in returns), returns  # a ten-day move, never "-40% a year"


def test_two_year_holding_is_annualized_and_judged():
    at = _run(730)
    assert not at.exception, at.exception
    text = _text(at)
    assert "Portfolio XIRR vs Benchmarks" in text
    assert "Annualized (XIRR) over 730 days" in text
    assert "Too early to call" not in text
    assert any(m.label == "Your XIRR" for m in at.metric)
