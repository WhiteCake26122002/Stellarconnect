"""
Country/currency-aware terminal-growth norms for the Gordon Growth terminal
value: a mature, going-concern company cannot outgrow the economy it operates
in forever, so the perpetual growth rate should approximate long-run nominal
GDP growth - lower for developed markets, somewhat higher (but still bounded)
for faster-growing emerging markets. Used both as a sensible slider default and
as the ceiling `run_validation` flags against, replacing a single flat 3%
default / flat 6% ceiling applied to every company regardless of market.
"""
from __future__ import annotations

DEVELOPED_CURRENCIES = {"USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "SGD", "HKD", "KRW"}

DEVELOPED_DEFAULT = 0.025
DEVELOPED_CEILING = 0.035
EMERGING_DEFAULT = 0.040
EMERGING_CEILING = 0.060


def terminal_growth_norms(currency: str) -> tuple[float, float]:
    """Returns (default_terminal_growth, ceiling) for `currency`. Emerging-market
    norms are the fallback for anything not explicitly listed as developed."""
    code = (currency or "USD").upper()
    if code in DEVELOPED_CURRENCIES:
        return DEVELOPED_DEFAULT, DEVELOPED_CEILING
    return EMERGING_DEFAULT, EMERGING_CEILING


def terminal_growth_for_company(currency: str, regime: str = "moderate") -> tuple[float, float, str]:
    """Returns (g, ceiling, rationale). Last explicit year must fade to this g."""
    default, ceiling = terminal_growth_norms(currency)
    code = (currency or "USD").upper()
    market = (
        "developed-market nominal GDP proxy"
        if code in DEVELOPED_CURRENCIES
        else "emerging-market nominal GDP proxy"
    )
    if regime == "declining":
        g = min(default, 0.020 if code in DEVELOPED_CURRENCIES else 0.030)
        rationale = (
            f"Declining historical regime: terminal growth is {g:.1%}, the lower of the {market} "
            f"({default:.1%}) and a no-growth-plus-inflation floor. This is not a bounce-back to a "
            "generic 4% emerging-market rate."
        )
        return g, ceiling, rationale
    rationale = (
        f"Terminal growth is {default:.1%}, the {market} for {code}. Near-term company growth is "
        "not used in perpetuity. Competitive fade is assumed complete by the last explicit year."
    )
    return default, ceiling, rationale
