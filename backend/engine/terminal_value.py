"""Terminal value: Gordon Growth (primary) and Exit Multiple (cross-check). Spec section 14."""
from __future__ import annotations

from pydantic import BaseModel


class TerminalValueResult(BaseModel):
    method: str
    terminal_fcf: float | None = None
    gordon_growth_value: float | None = None
    exit_multiple_value: float | None = None
    exit_multiple_used: float | None = None
    terminal_ebitda: float | None = None


def gordon_growth_terminal_value(final_year_fcff: float, wacc: float, terminal_growth: float) -> float:
    if wacc <= terminal_growth:
        raise ValueError(
            f"WACC ({wacc:.2%}) must exceed terminal growth ({terminal_growth:.2%}) — the Gordon Growth "
            "formula is undefined/negative otherwise. Lower terminal growth or raise WACC."
        )
    terminal_fcf = final_year_fcff * (1 + terminal_growth)
    return terminal_fcf / (wacc - terminal_growth)


def exit_multiple_terminal_value(final_year_ebitda: float, exit_multiple: float) -> float:
    if exit_multiple <= 0:
        raise ValueError("Exit multiple must be positive.")
    return final_year_ebitda * exit_multiple


def compare_terminal_value_methods(
    final_year_fcff: float,
    final_year_ebitda: float,
    wacc: float,
    terminal_growth: float,
    exit_multiple: float | None,
) -> dict[str, TerminalValueResult]:
    results: dict[str, TerminalValueResult] = {}

    gg_value = gordon_growth_terminal_value(final_year_fcff, wacc, terminal_growth)
    results["gordon_growth"] = TerminalValueResult(
        method="Gordon Growth",
        terminal_fcf=final_year_fcff * (1 + terminal_growth),
        gordon_growth_value=gg_value,
    )

    if exit_multiple is not None:
        em_value = exit_multiple_terminal_value(final_year_ebitda, exit_multiple)
        results["exit_multiple"] = TerminalValueResult(
            method="Exit Multiple",
            exit_multiple_value=em_value,
            exit_multiple_used=exit_multiple,
            terminal_ebitda=final_year_ebitda,
        )

    return results
