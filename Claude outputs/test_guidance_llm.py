from __future__ import annotations

import pytest

from ..engine.guidance_llm import (
    GuidanceLLMError,
    GuidanceLLMTimeout,
    ScriptedGuidanceLLMProvider,
    extract_company_guidance,
)

SOURCE_TEXT = (
    "Orion Corp Q3 Earnings Call Transcript\n"
    "CFO: For fiscal 2027, we expect revenue growth of 12% year over year, "
    "driven by our new product line.\n"
    "We are targeting EBITDA margins of 22% by the end of next fiscal year.\n"
    "Historically, revenue grew 8% last year.\n"
)


def test_extracts_and_verifies_both_fields():
    payload = {
        "revenue_growth_pct": 0.12,
        "revenue_growth_quote": "we expect revenue growth of 12% year over year",
        "revenue_growth_period": "fiscal 2027",
        "ebitda_margin_pct": 0.22,
        "ebitda_margin_quote": "We are targeting EBITDA margins of 22% by the end of next fiscal year.",
        "ebitda_margin_period": "next fiscal year",
        "notes": "",
    }
    provider = ScriptedGuidanceLLMProvider(payload=payload)
    result = extract_company_guidance(SOURCE_TEXT, "Orion Corp", provider)

    assert result.revenue_growth_verified is True
    assert result.revenue_growth_pct == 0.12
    assert result.ebitda_margin_verified is True
    assert result.ebitda_margin_pct == 0.22
    assert result.has_usable_guidance is True
    assert result.rejected_reasons == []
    assert provider.calls == 1


def test_quote_not_in_source_is_discarded_regardless_of_confidence():
    """The core anti-hallucination gate: a fabricated quote must be rejected
    even though the model returned it with an otherwise well-formed number."""
    payload = {
        "revenue_growth_pct": 0.35,
        "revenue_growth_quote": "we expect revenue to triple next year",
        "revenue_growth_period": "FY2027",
        "ebitda_margin_pct": None,
        "ebitda_margin_quote": None,
        "ebitda_margin_period": None,
        "notes": "",
    }
    provider = ScriptedGuidanceLLMProvider(payload=payload)
    result = extract_company_guidance(SOURCE_TEXT, "Orion Corp", provider)

    assert result.revenue_growth_verified is False
    assert result.revenue_growth_pct is None
    assert result.revenue_growth_quote is None
    assert result.has_usable_guidance is False
    assert len(result.rejected_reasons) == 1
    assert "does not appear verbatim" in result.rejected_reasons[0]


def test_out_of_range_value_is_discarded_even_with_valid_quote():
    payload = {
        "revenue_growth_pct": 5.0,  # 500% - implausible, quote below is verbatim but number is nonsense
        "revenue_growth_quote": "we expect revenue growth of 12% year over year",
        "revenue_growth_period": "fiscal 2027",
        "ebitda_margin_pct": None,
        "ebitda_margin_quote": None,
        "ebitda_margin_period": None,
        "notes": "",
    }
    provider = ScriptedGuidanceLLMProvider(payload=payload)
    result = extract_company_guidance(SOURCE_TEXT, "Orion Corp", provider)

    assert result.revenue_growth_verified is False
    assert result.revenue_growth_pct is None
    assert any("outside a plausible range" in r for r in result.rejected_reasons)


def test_no_guidance_found_is_a_normal_abstain_not_an_error():
    payload = {
        "revenue_growth_pct": None,
        "revenue_growth_quote": None,
        "revenue_growth_period": None,
        "ebitda_margin_pct": None,
        "ebitda_margin_quote": None,
        "ebitda_margin_period": None,
        "notes": "Document contains no forward guidance.",
    }
    provider = ScriptedGuidanceLLMProvider(payload=payload)
    result = extract_company_guidance(SOURCE_TEXT, "Orion Corp", provider)

    assert result.has_usable_guidance is False
    assert result.rejected_reasons == []
    assert result.notes == "Document contains no forward guidance."


def test_unconfigured_provider_raises():
    provider = ScriptedGuidanceLLMProvider(payload={}, configured=False)
    with pytest.raises(GuidanceLLMError):
        extract_company_guidance(SOURCE_TEXT, "Orion Corp", provider)


def test_empty_source_text_raises():
    provider = ScriptedGuidanceLLMProvider(payload={})
    with pytest.raises(GuidanceLLMError):
        extract_company_guidance("   ", "Orion Corp", provider)


def test_provider_timeout_propagates():
    provider = ScriptedGuidanceLLMProvider(error=GuidanceLLMTimeout("timed out"))
    with pytest.raises(GuidanceLLMTimeout):
        extract_company_guidance(SOURCE_TEXT, "Orion Corp", provider)


def test_quote_match_is_whitespace_and_case_insensitive():
    """Real documents get pasted with odd line wraps/casing; the verifier
    should tolerate that without loosening to fuzzy matching."""
    messy_source = SOURCE_TEXT.replace("12% year over year", "12%   YEAR\nOVER   year")
    payload = {
        "revenue_growth_pct": 0.12,
        "revenue_growth_quote": "we expect revenue growth of 12% year over year",
        "revenue_growth_period": "fiscal 2027",
        "ebitda_margin_pct": None,
        "ebitda_margin_quote": None,
        "ebitda_margin_period": None,
        "notes": "",
    }
    provider = ScriptedGuidanceLLMProvider(payload=payload)
    result = extract_company_guidance(messy_source, "Orion Corp", provider)
    assert result.revenue_growth_verified is True
