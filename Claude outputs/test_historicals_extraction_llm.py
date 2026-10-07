from __future__ import annotations

import pytest

from ..engine.historicals_extraction_llm import (
    HistoricalsLLMError,
    HistoricalsLLMTimeout,
    ScriptedHistoricalsLLMProvider,
    extract_historicals_draft,
)

SOURCE_TEXT = (
    "Orion Corp Annual Report FY2024\n"
    "Consolidated Statement of Income (INR crore)\n"
    "Revenue from operations: 4,520.30\n"
    "Cost of materials consumed: 2,010.15\n"
    "Depreciation and amortisation expense: 180.40\n"
    "Finance costs: 95.60\n"
    "Balance Sheet as at March 31, 2024\n"
    "Cash and cash equivalents: 610.20\n"
    "Trade receivables: 340.10\n"
)


def _payload(**overrides):
    base = {
        "units": "INR crore",
        "income_statements": [
            {
                "period": "FY2024",
                "revenue": 4520.30,
                "revenue_quote": "Revenue from operations: 4,520.30",
                "cogs": 2010.15,
                "cogs_quote": "Cost of materials consumed: 2,010.15",
                "rnd": None, "rnd_quote": None,
                "sm": None, "sm_quote": None,
                "ga": None, "ga_quote": None,
                "da": 180.40,
                "da_quote": "Depreciation and amortisation expense: 180.40",
                "interest_expense": 95.60,
                "interest_expense_quote": "Finance costs: 95.60",
                "taxes": None, "taxes_quote": None,
            }
        ],
        "balance_sheets": [
            {
                "period": "FY2024",
                "cash": 610.20,
                "cash_quote": "Cash and cash equivalents: 610.20",
                "accounts_receivable": 340.10,
                "accounts_receivable_quote": "Trade receivables: 340.10",
                "inventory": None, "inventory_quote": None,
                "ppe": None, "ppe_quote": None,
                "accounts_payable": None, "accounts_payable_quote": None,
                "short_term_debt": None, "short_term_debt_quote": None,
                "long_term_debt": None, "long_term_debt_quote": None,
                "shareholders_equity": None, "shareholders_equity_quote": None,
            }
        ],
        "cash_flows": [],
        "notes": "",
    }
    base.update(overrides)
    return base


def test_extracts_and_verifies_fields_across_statements():
    provider = ScriptedHistoricalsLLMProvider(payload=_payload())
    draft = extract_historicals_draft(SOURCE_TEXT, "Orion Corp", provider)

    assert draft.units == "INR crore"
    assert draft.has_usable_data is True
    assert draft.income_statements[0].values["revenue"] == 4520.30
    assert draft.income_statements[0].values["cogs"] == 2010.15
    assert draft.balance_sheets[0].values["cash"] == 610.20
    assert draft.income_statements[0].rejected_fields == {}

    manual = draft.to_manual_historicals_draft()
    assert manual["income_statements"][0]["revenue"] == 4520.30
    assert manual["income_statements"][0]["period"] == "FY2024"
    assert manual["balance_sheets"][0]["accounts_receivable"] == 340.10
    assert manual["cash_flows"] == []


def test_fabricated_quote_drops_only_that_field_not_whole_period():
    payload = _payload()
    payload["income_statements"][0]["revenue"] = 9999.0
    payload["income_statements"][0]["revenue_quote"] = "revenue will triple next year"
    provider = ScriptedHistoricalsLLMProvider(payload=payload)
    draft = extract_historicals_draft(SOURCE_TEXT, "Orion Corp", provider)

    period = draft.income_statements[0]
    assert "revenue" not in period.values
    assert "revenue" in period.rejected_fields
    assert "does not appear verbatim" in period.rejected_fields["revenue"]
    # Other verified fields in the same period still come through.
    assert period.values["cogs"] == 2010.15


def test_no_data_found_is_a_normal_empty_result_not_an_error():
    payload = _payload(income_statements=[], balance_sheets=[], cash_flows=[], notes="No financials found.")
    provider = ScriptedHistoricalsLLMProvider(payload=payload)
    draft = extract_historicals_draft(SOURCE_TEXT, "Orion Corp", provider)

    assert draft.has_usable_data is False
    assert draft.notes == "No financials found."


def test_unconfigured_provider_raises():
    provider = ScriptedHistoricalsLLMProvider(payload={}, configured=False)
    with pytest.raises(HistoricalsLLMError):
        extract_historicals_draft(SOURCE_TEXT, "Orion Corp", provider)


def test_empty_source_text_raises():
    provider = ScriptedHistoricalsLLMProvider(payload={})
    with pytest.raises(HistoricalsLLMError):
        extract_historicals_draft("   ", "Orion Corp", provider)


def test_provider_timeout_propagates():
    provider = ScriptedHistoricalsLLMProvider(error=HistoricalsLLMTimeout("timed out"))
    with pytest.raises(HistoricalsLLMTimeout):
        extract_historicals_draft(SOURCE_TEXT, "Orion Corp", provider)


def test_non_numeric_value_is_silently_skipped_not_crashed():
    payload = _payload()
    payload["income_statements"][0]["revenue"] = "not a number"
    provider = ScriptedHistoricalsLLMProvider(payload=payload)
    draft = extract_historicals_draft(SOURCE_TEXT, "Orion Corp", provider)
    assert "revenue" not in draft.income_statements[0].values
