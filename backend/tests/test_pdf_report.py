"""
Tests for the PDF investment report generator. Focused on the two real bugs
found during development: reportlab's Paragraph markup requires XML-escaped
text, so any dynamic/sourced text containing a bare '&' (e.g. "D&A" in
historical commentary, or a live-fetched industry like "Oil & Gas Refining &
Marketing") previously rendered garbled or dropped content.
"""
import pytest
from pypdf import PdfReader

from ..engine.scenarios import run_all_scenarios
from ..engine.sensitivity import ValuationContext, rank_valuation_drivers, wacc_vs_growth_table
from ..engine.valuation import run_dcf_valuation
from ..engine.validation import run_validation
from ..export.pdf_report import _esc, generate_investment_report


def test_esc_escapes_ampersand_lt_gt():
    assert _esc("D&A") == "D&amp;A"
    assert _esc("Oil & Gas Refining & Marketing") == "Oil &amp; Gas Refining &amp; Marketing"
    assert _esc("a < b > c") == "a &lt; b &gt; c"


@pytest.fixture
def full_report_inputs(hist, summary, forecast, wacc_result, wacc_inputs, company):
    latest_bs = hist.balance_sheets[-1]
    valuation = run_dcf_valuation(
        forecast, wacc_result, 0.03, company,
        latest_bs.total_cash_and_investments, latest_bs.total_debt, latest_bs.lease_liabilities, exit_multiple=14.0,
    )
    scenarios = run_all_scenarios(
        hist=hist, summary=summary, company=company, base_assumptions=forecast.assumptions,
        base_wacc_inputs=wacc_inputs, base_terminal_growth=0.03,
        cash_and_investments=latest_bs.total_cash_and_investments, total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities, exit_multiple=14.0,
    )
    ctx = ValuationContext(
        cash_and_investments=latest_bs.total_cash_and_investments, total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities, exit_multiple=14.0,
    )
    table = wacc_vs_growth_table(hist, forecast.assumptions, wacc_result, company, ctx, [0.09, 0.10, 0.11], [0.02, 0.03, 0.04])
    ranking = rank_valuation_drivers(hist, forecast.assumptions, wacc_result, 0.03, company, ctx)
    integrity = run_validation(hist, summary, forecast, wacc_result, valuation)
    return valuation, scenarios, table, ranking, integrity


def test_report_generates_valid_multi_page_pdf(tmp_path, company, hist, summary, forecast, wacc_result, full_report_inputs):
    valuation, scenarios, table, ranking, integrity = full_report_inputs
    out_path = tmp_path / "report.pdf"
    generate_investment_report(str(out_path), company, hist, summary, forecast, wacc_result, valuation, scenarios, table, ranking, integrity)

    assert out_path.exists()
    assert out_path.stat().st_size > 1000

    reader = PdfReader(str(out_path))
    assert len(reader.pages) >= 3


def test_report_text_has_no_mojibake_and_contains_key_figures(
    tmp_path, company, hist, summary, forecast, wacc_result, full_report_inputs
):
    valuation, scenarios, table, ranking, integrity = full_report_inputs
    out_path = tmp_path / "report.pdf"
    generate_investment_report(str(out_path), company, hist, summary, forecast, wacc_result, valuation, scenarios, table, ranking, integrity)

    reader = PdfReader(str(out_path))
    full_text = " ".join(p.extract_text() for p in reader.pages)

    assert chr(0xFFFD) not in full_text  # no Unicode replacement-character mojibake
    assert company.name in full_text
    assert "D&A" in full_text  # regression: ampersand must survive escaping, not vanish or garble
    assert "Valuation Summary" in full_text
    assert "Scenario Analysis" in full_text
    assert f"{integrity.score}/100" in full_text


def test_report_handles_ampersand_heavy_industry_text(
    tmp_path, hist, summary, forecast, wacc_result, full_report_inputs, company
):
    """Regression test for the exact live-data case that broke: an industry
    string with two ampersands ("Oil & Gas Refining & Marketing") must render
    intact in the PDF header, not truncate or garble."""
    valuation, scenarios, table, ranking, integrity = full_report_inputs
    company_with_amp = company.model_copy(update={"industry": "Oil & Gas Refining & Marketing"})
    out_path = tmp_path / "report.pdf"
    generate_investment_report(
        str(out_path), company_with_amp, hist, summary, forecast, wacc_result, valuation, scenarios, table, ranking, integrity
    )
    reader = PdfReader(str(out_path))
    full_text = " ".join(p.extract_text() for p in reader.pages)
    assert "Oil & Gas Refining & Marketing" in full_text
    assert chr(0xFFFD) not in full_text
