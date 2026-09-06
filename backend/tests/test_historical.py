import pytest

from ..engine.historical import analyze_historicals, cagr


def test_cagr_basic():
    assert cagr(100, 200, 5) == pytest.approx(2 ** (1 / 5) - 1)


def test_cagr_zero_start_returns_none():
    assert cagr(0, 100, 5) is None


def test_cagr_zero_years_returns_none():
    assert cagr(100, 200, 0) is None


def test_revenue_cagr_5y_matches_manual_calc(hist, summary):
    manual = (hist.income_statements[-1].revenue / hist.income_statements[-6].revenue) ** (1 / 5) - 1
    assert summary.revenue_cagr_5y == pytest.approx(manual)


def test_first_year_has_no_growth(summary):
    assert summary.years[0].revenue_growth is None


def test_yoy_growth_matches_manual_calc(hist, summary):
    for i in range(1, len(hist.income_statements)):
        expected = hist.income_statements[i].revenue / hist.income_statements[i - 1].revenue - 1
        assert summary.years[i].revenue_growth == pytest.approx(expected)


def test_ebitda_margin_matches_definition(hist, summary):
    for inc, y in zip(hist.income_statements, summary.years):
        expected = (inc.revenue - inc.cogs - inc.rnd - inc.sm - inc.ga) / inc.revenue
        assert y.ebitda_margin == pytest.approx(expected)


def test_trend_commentary_nonempty(summary):
    assert len(summary.trend_commentary) > 0


def test_analyze_historicals_raises_on_empty():
    from ..engine.models import HistoricalFinancials

    with pytest.raises(ValueError):
        analyze_historicals(HistoricalFinancials(income_statements=[], balance_sheets=[], cash_flows=[]))
