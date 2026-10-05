"""Small shared helper for building derived Assumption objects (scenario/sensitivity shifts)."""
from __future__ import annotations

from .models import Assumption


def shift_assumption(a: Assumption, delta: float, label: str) -> Assumption:
    clone = a.model_copy()
    clone.value = a.effective_value + delta
    clone.rationale = f"[{label}] {a.rationale} Adjusted by {delta:+.1%} vs. Base Case."
    return clone


def pin_last_growth(series: list[Assumption], g: float, note: str) -> None:
    """Keep the last explicit year on Gordon g. Mutates `series` in place."""
    if not series:
        return
    last = series[-1]
    if abs(last.effective_value - g) < 1e-12 and last.user_override is None:
        return
    series[-1] = last.model_copy(
        update={
            "value": g,
            "user_override": None,
            "rationale": f"{note} {last.rationale}",
        }
    )
