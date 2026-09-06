import pytest

from ..engine.forecast import glide_path, project_financials


def test_glide_path_endpoints():
    path = glide_path(0.10, 0.04, 5)
    assert path[0] == pytest.approx(0.10)
    assert path[-1] == pytest.approx(0.04)
    assert len(path) == 5


def test_glide_path_single_step_returns_end():
    assert glide_path(0.10, 0.04, 1) == [0.04]


def test_glide_path_monotonic_decreasing():
    path = glide_path(0.10, 0.04, 6)
    assert all(path[i] >= path[i + 1] for i in range(len(path) - 1))


def test_forecast_ebitda_equals_gross_profit_minus_opex(forecast):
    for y in forecast.years:
        assert y.ebitda == pytest.approx(y.gross_profit - y.total_opex_ex_da)


def test_forecast_ebit_equals_ebitda_minus_da(forecast):
    for y in forecast.years:
        assert y.ebit == pytest.approx(y.ebitda - y.da)


def test_forecast_nopat_equals_ebit_minus_taxes(forecast):
    for y in forecast.years:
        assert y.nopat == pytest.approx(y.ebit - y.taxes_on_ebit)


def test_forecast_taxes_use_tax_rate(forecast):
    for y in forecast.years:
        if y.ebit > 0:
            assert y.taxes_on_ebit == pytest.approx(y.ebit * y.tax_rate)


def test_fcff_formula(forecast):
    # FCFF = NOPAT + D&A - Capex - Change in NWC (spec section 10)
    for y in forecast.years:
        assert y.fcff == pytest.approx(y.nopat + y.da - y.capex - y.change_in_nwc)


def test_revenue_compounds_from_growth(hist, forecast):
    base_revenue = hist.income_statements[-1].revenue
    expected = base_revenue
    for y in forecast.years:
        expected *= 1 + y.revenue_growth
        assert y.revenue == pytest.approx(expected)


def test_first_forecast_year_change_in_nwc_uses_last_historical_nwc(hist, forecast):
    prior_nwc = hist.balance_sheets[-1].net_working_capital
    first_year = forecast.years[0]
    assert first_year.change_in_nwc == pytest.approx(first_year.nwc - prior_nwc)


def test_user_override_changes_forecast(hist, assumptions):
    overridden = assumptions.model_copy(deep=True)
    overridden.revenue_growth[0] = overridden.revenue_growth[0].overridden(0.50)
    new_forecast = project_financials(hist, overridden)
    base_revenue = hist.income_statements[-1].revenue
    assert new_forecast.years[0].revenue == pytest.approx(base_revenue * 1.50)


def test_forecast_years_count_matches_horizon(hist, summary):
    from ..engine.forecast import build_default_assumptions

    for n in (3, 5, 7, 10):
        a = build_default_assumptions(hist, summary, forecast_years=n)
        assert len(a.forecast_years) == n
        f = project_financials(hist, a)
        assert len(f.years) == n


def test_extreme_recent_growth_default_is_capped(hist, summary):
    """
    Regression test for the MCX case: a company recovering from a one-off
    disruption (there, a platform migration) can show a 2-year-average
    "recent run-rate" north of 90% - a lagging figure that was already well
    above even that company's own most recent quarterly trend. Silently
    extrapolating that as the Base Case default overstates the forecast
    (cascading into "large unexplained revenue jump" / margin warnings that
    are really just an echo of this one root assumption). The auto-populated
    starting growth rate must be capped; a deliberate user override is not
    affected.
    """
    from ..engine.forecast import build_default_assumptions

    extreme_summary = summary.model_copy(update={"recent_2y_avg_growth": 0.917})
    assumptions = build_default_assumptions(hist, extreme_summary, forecast_years=5)
    assert assumptions.revenue_growth[0].effective_value == pytest.approx(0.40)
    assert "capped to 40%" in assumptions.revenue_growth[0].rationale


def test_ordinary_recent_growth_default_is_not_capped(hist, summary):
    from ..engine.forecast import build_default_assumptions

    ordinary_summary = summary.model_copy(update={"recent_2y_avg_growth": 0.08})
    assumptions = build_default_assumptions(hist, ordinary_summary, forecast_years=5)
    assert assumptions.revenue_growth[0].effective_value == pytest.approx(0.08)
    assert "capped" not in assumptions.revenue_growth[0].rationale


def test_extreme_nwc_reinvestment_is_capped_relative_to_nopat(hist, assumptions):
    """
    Regression test for the DLF case: a company whose net working capital
    (e.g. a real-estate developer's land/WIP "inventory") runs to several
    multiples of revenue can otherwise see change-in-NWC alone swing FCFF to
    an absurd (even deeply negative) number every forecast year. Total
    reinvestment (capex net of D&A, plus the NWC build) must never exceed a
    generous fraction of NOPAT - the standard Damodaran reinvestment-rate
    guard rail - so one runaway ratio can't single-handedly wreck FCFF.
    """
    huge_nwc = assumptions.model_copy(deep=True)
    huge_nwc.nwc_pct_revenue = [a.overridden(3.0) for a in huge_nwc.nwc_pct_revenue]  # 300% of revenue
    forecast = project_financials(hist, huge_nwc)
    for y in forecast.years:
        if y.nopat > 0:
            assert y.change_in_nwc <= 0.75 * y.nopat + 1e-6


def test_capex_glides_toward_da_by_terminal_year(hist, summary):
    """
    Regression test: a company mid capacity build-out (e.g. Reliance's Jio/
    Retail expansion) can run historical capex far above D&A. Holding that
    elevated capex % of revenue flat all the way through the terminal year
    used to feed a permanently over-investing company into the Gordon Growth
    perpetuity, mechanically crushing FCFF and producing an unrealistic (even
    negative) equity value for a healthy, profitable company. Capex must now
    glide from the recent historical average toward the historical D&A % of
    revenue by the final forecast year, consistent with the standard DCF
    assumption that reinvestment normalizes once growth reaches its stable
    long-run rate.
    """
    from ..engine.forecast import build_default_assumptions

    summary = summary.model_copy(update={"avg_capex_pct_revenue": 0.15, "avg_da_pct_revenue": 0.05})
    a = build_default_assumptions(hist, summary, forecast_years=5)
    values = [x.value for x in a.capex_pct_revenue]
    assert values[0] == pytest.approx(0.15)
    assert values[-1] == pytest.approx(0.05)
    assert all(values[i] >= values[i + 1] for i in range(len(values) - 1))
