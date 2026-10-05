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
    Legacy historical-glide still caps a 91% 2-year rebound so it cannot become
    the untouched base case. The evidence engine (default) does not use that 2y average.
    """
    from ..engine.forecast import build_default_assumptions

    extreme_summary = summary.model_copy(update={"recent_2y_avg_growth": 0.917})
    assumptions = build_default_assumptions(
        hist, extreme_summary, forecast_years=5, methodology="historical", terminal_growth=0.04
    )
    assert assumptions.revenue_growth[0].effective_value == pytest.approx(0.40)
    assert "capped to 40%" in assumptions.revenue_growth[0].rationale


def test_ordinary_recent_growth_default_is_not_capped(hist, summary):
    from ..engine.forecast import build_default_assumptions

    ordinary_summary = summary.model_copy(update={"recent_2y_avg_growth": 0.08})
    assumptions = build_default_assumptions(
        hist, ordinary_summary, forecast_years=5, methodology="historical", terminal_growth=0.04
    )
    assert assumptions.revenue_growth[0].effective_value == pytest.approx(0.08)
    assert "capped" not in assumptions.revenue_growth[0].rationale


def test_extreme_nwc_is_not_silently_capped(hist, assumptions):
    """ΔNWC must flow through FCFF even when it is large relative to NOPAT."""
    huge_nwc = assumptions.model_copy(deep=True)
    huge_nwc.nwc_pct_revenue = [a.overridden(3.0) for a in huge_nwc.nwc_pct_revenue]
    huge_nwc.nwc_method = "balance_sheet"
    forecast = project_financials(hist, huge_nwc)
    prior = hist.balance_sheets[-1].net_working_capital
    for y in forecast.years:
        assert y.fcff == pytest.approx(y.nopat + y.da - y.capex - y.change_in_nwc)
        assert y.change_in_nwc == pytest.approx(y.nwc - prior)
        prior = y.nwc
        if y.nopat > 0:
            # Must be allowed to exceed the old 75% NOPAT subsidy.
            pass


def test_capex_policy_depends_on_intensity(hist, summary):
    from ..engine.company_profile import BusinessTemplate, CompanyProfile
    from ..engine.forecast import build_default_assumptions

    summary = summary.model_copy(update={"median_capex_pct_3y": 0.15, "avg_da_pct_revenue": 0.05, "avg_capex_pct_revenue": 0.15})
    heavy = CompanyProfile(
        template=BusinessTemplate.MANUFACTURING,
        asset_intensity="heavy",
        fcff_appropriate=True,
        capex_policy="maintain_with_da_floor",
        rationale="test heavy",
    )
    a = build_default_assumptions(
        hist, summary, forecast_years=5, terminal_growth=0.04, methodology="historical", profile=heavy
    )
    values = [x.value for x in a.capex_pct_revenue]
    assert values[0] == pytest.approx(0.15)
    assert values[-1] >= 0.05 - 1e-9
    assert values[-1] == pytest.approx(max(0.05, 0.15 * 0.90))


def test_default_margin_is_last_3y_median_not_peak(hist, summary):
    from ..engine.forecast import build_default_assumptions

    peak = max(y.ebitda_margin for y in summary.years)
    a = build_default_assumptions(hist, summary, forecast_years=5, terminal_growth=0.025)
    # Target is encoded in opex glide rationale / last year ebitda vs peak
    f = project_financials(hist, a)
    assert f.years[-1].ebitda_margin <= peak + 0.005


def test_last_explicit_year_equals_terminal_growth(hist, summary):
    from ..engine.forecast import build_default_assumptions

    a = build_default_assumptions(hist, summary, forecast_years=5, terminal_growth=0.025)
    assert a.revenue_growth[-1].effective_value == pytest.approx(0.025)
    assert a.fade_target == pytest.approx(0.025)
