"""Small shared helper for building derived Assumption objects (scenario/sensitivity shifts)."""
from __future__ import annotations

from .models import Assumption


def shift_assumption(a: Assumption, delta: float, label: str) -> Assumption:
    clone = a.model_copy()
    clone.value = a.effective_value + delta
    clone.rationale = f"[{label}] {a.rationale} Adjusted by {delta:+.1%} vs. Base Case."
    return clone
