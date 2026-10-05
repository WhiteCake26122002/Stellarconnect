"""
Regression tests for the Damodaran reference-data parser. These specifically
guard against the header-row-offset bugs found during development (wrong
`header=` in pd.read_excel silently produced NaN/KeyErrors or nonsense
matches instead of real data) - each of these would have caught that class
of bug immediately instead of it surfacing as "corporate_tax_rate=None".
"""
import pytest

from ..data.damodaran_reference import (
    GrowthDataUnavailable,
    get_country_risk,
    match_india_sector_beta,
    match_india_sector_growth,
)


def test_mature_market_erp_is_a_real_percentage_not_nan():
    r = get_country_risk("India")
    assert 0.0 < r.mature_market_erp < 0.20


def test_india_total_erp_exceeds_mature_market_erp():
    r = get_country_risk("India")
    assert r.total_equity_risk_premium > r.mature_market_erp
    assert r.total_equity_risk_premium == pytest.approx(r.mature_market_erp + r.country_risk_premium, abs=1e-6)


def test_india_tax_rate_is_populated_and_reasonable():
    r = get_country_risk("India")
    assert r.corporate_tax_rate is not None
    assert 0.10 < r.corporate_tax_rate < 0.45


def test_us_erp_lower_than_india_erp():
    us = get_country_risk("United States")
    india = get_country_risk("India")
    assert us.total_equity_risk_premium < india.total_equity_risk_premium


def test_unmatched_country_raises_clear_error_instead_of_fabricating_data():
    with pytest.raises(ValueError, match="was not found"):
        get_country_risk("Not A Real Country XYZ")


def test_sector_alias_exact_matches_are_high_confidence():
    m = match_india_sector_beta("Information Technology Services")
    assert m.matched_industry == "Computer Services"
    assert m.match_score == 100.0
    assert not m.low_confidence
    assert m.levered_beta > 0


def test_sector_alias_oil_gas_does_not_match_metals_mining():
    """Regression: fuzzy-only matching previously mapped this to 'Metals & Mining'."""
    m = match_india_sector_beta("Oil & Gas Refining & Marketing")
    assert "Oil" in m.matched_industry or "Gas" in m.matched_industry
    assert m.matched_industry != "Metals & Mining"


def test_nonsense_sector_falls_back_to_total_market_with_low_confidence():
    m = match_india_sector_beta("Complete Nonsense Sector That Does Not Exist Anywhere")
    assert m.matched_industry == "Total Market"
    assert m.low_confidence is True


def test_sector_beta_has_total_beta_fields_populated():
    m = match_india_sector_beta("Information Technology Services")
    assert m.total_beta is not None
    assert m.total_unlevered_beta is not None
    assert m.total_beta > m.levered_beta  # total beta always exceeds market beta (undiversified-risk adjustment)


def test_unlevered_beta_below_levered_beta_when_debt_present():
    m = match_india_sector_beta("Banks - Regional")
    assert m.d_e_ratio >= 0
    if m.d_e_ratio > 0:
        assert m.unlevered_beta <= m.levered_beta


def test_sector_growth_alias_resolves_to_a_real_number():
    m = match_india_sector_growth("Information Technology Services")
    assert m.matched_industry == "Computer Services"
    assert m.match_score == 100.0
    assert m.low_confidence is False
    assert isinstance(m.expected_growth, float)
    assert -0.5 < m.expected_growth < 1.5


def test_screener_it_services_label_does_not_fuzzy_to_software_products():
    """Screener.in reports TCS/Infosys as this label; fuzzy-only matching
    previously accepted Software (System & Application) at 56%."""
    m = match_india_sector_growth("Computers - Software & Consulting")
    assert m.matched_industry == "Computer Services"
    assert m.low_confidence is False


def test_sector_growth_fuzzy_match_uses_workbook_row():
    m = match_india_sector_growth("Computer Services")
    assert m.matched_industry == "Computer Services"
    assert m.low_confidence is False
    assert -0.5 < m.expected_growth < 1.5


def test_unmatched_industry_growth_falls_back_to_total_market():
    m = match_india_sector_growth("Complete Nonsense Sector That Does Not Exist Anywhere")
    assert m.matched_industry == "Total Market"
    assert m.low_confidence is True
    assert m.match_score == 0.0
    assert -0.5 < m.expected_growth < 1.5


def test_missing_growth_workbook_raises_growth_data_unavailable(monkeypatch, tmp_path):
    from ..data import damodaran_reference as mod

    mod._load_india_growth.cache_clear()
    monkeypatch.setattr(mod, "REFERENCE_DIR", tmp_path)
    with pytest.raises(GrowthDataUnavailable):
        match_india_sector_growth("Steel")
    mod._load_india_growth.cache_clear()
