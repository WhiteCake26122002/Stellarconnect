"""External validation references.

External valuations are recorded so our assumptions can be compared with
someone else's. They are never allowed to influence the model. There is no code
path from a stored reference back into growth, margin, WACC, terminal growth,
capex, or working capital, and `compare_assumptions` deliberately returns no
verdict about which side is correct.
"""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

CALIBRATION_POLICY = (
    "External references are validation evidence only. They are never used to calibrate "
    "assumptions, and the DCF result is identical whether or not any reference exists."
)


class ExternalSourceType(str, Enum):
    ANNUAL_REPORT = "annual_report"
    INVESTOR_PRESENTATION = "investor_presentation"
    MANAGEMENT_GUIDANCE = "management_guidance"
    BROKERAGE_REPORT = "brokerage_report"
    ACADEMIC_DATASET = "academic_dataset"
    OTHER = "other"


class ExternalReference(BaseModel):
    ticker: str
    source: str
    source_type: ExternalSourceType
    as_of_date: str
    methodology: str = ""
    target_value: float | None = None
    currency: str = ""
    revenue_growth: float | None = None
    ebit_margin: float | None = None
    wacc: float | None = None
    terminal_growth: float | None = None
    forecast_horizon_years: int | None = None
    key_assumptions: dict[str, Any] = Field(default_factory=dict)
    notes: str = ""


class AssumptionComparison(BaseModel):
    assumption: str
    ours: float | None
    theirs: float | None
    difference: float | None
    statement: str


class ExternalComparison(BaseModel):
    reference: ExternalReference
    our_value: float | None = None
    value_difference_pct: float | None = None
    assumptions: list[AssumptionComparison] = Field(default_factory=list)
    policy: str = CALIBRATION_POLICY
    verdict: str = (
        "No conclusion is drawn about which set of assumptions is correct. The comparison is descriptive."
    )


class ExternalValidationStore:
    """In-memory registry. Reads are explicit; nothing auto-applies."""

    def __init__(self) -> None:
        self._refs: dict[str, list[ExternalReference]] = {}

    def add(self, ref: ExternalReference) -> None:
        self._refs.setdefault(ref.ticker.upper(), []).append(ref)

    def for_ticker(self, ticker: str) -> list[ExternalReference]:
        return list(self._refs.get((ticker or "").upper(), []))

    def clear(self) -> None:
        self._refs.clear()


_STORE = ExternalValidationStore()


def store() -> ExternalValidationStore:
    return _STORE


def _cmp(name: str, ours: float | None, theirs: float | None, unit: str) -> AssumptionComparison:
    if ours is None or theirs is None:
        return AssumptionComparison(
            assumption=name,
            ours=ours,
            theirs=theirs,
            difference=None,
            statement=f"{name}: not comparable because one side is unavailable.",
        )
    diff = ours - theirs
    if unit == "pp":
        statement = f"{name}: ours {ours:.1%} versus theirs {theirs:.1%} ({diff * 100:+.1f} pp)."
    else:
        statement = f"{name}: ours {ours:,.2f} versus theirs {theirs:,.2f} ({diff:+,.2f})."
    return AssumptionComparison(assumption=name, ours=ours, theirs=theirs, difference=diff, statement=statement)


def compare_assumptions(
    reference: ExternalReference,
    *,
    our_value_per_share: float | None,
    our_revenue_growth: float | None,
    our_ebit_margin: float | None,
    our_wacc: float | None,
    our_terminal_growth: float | None,
) -> ExternalComparison:
    diff_pct = None
    if reference.target_value and our_value_per_share is not None and reference.target_value != 0:
        diff_pct = our_value_per_share / reference.target_value - 1
    return ExternalComparison(
        reference=reference,
        our_value=our_value_per_share,
        value_difference_pct=diff_pct,
        assumptions=[
            _cmp("Revenue growth", our_revenue_growth, reference.revenue_growth, "pp"),
            _cmp("EBIT margin", our_ebit_margin, reference.ebit_margin, "pp"),
            _cmp("WACC", our_wacc, reference.wacc, "pp"),
            _cmp("Terminal growth", our_terminal_growth, reference.terminal_growth, "pp"),
        ],
    )
