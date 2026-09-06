"""
Rule-based portfolio observations for the Mutual Fund tracker: concentration
and category-overlap checks computed purely from the user's own holdings and
their live NAV history. These are informational flags, not investment advice
- there is no licensed-advisor logic here, just arithmetic over fields the
user can see for themselves (category, trailing returns, portfolio weight).
"""
from __future__ import annotations

from dataclasses import dataclass

CONCENTRATION_THRESHOLD_PCT = 40.0
CATEGORY_OVERLAP_MIN_COUNT = 3
UNDERPERFORMER_GAP_PCT = 5.0


@dataclass
class Flag:
    severity: str  # "warning" | "info"
    title: str
    detail: str


def build_flags(enriched_holdings: list[dict]) -> list[Flag]:
    """
    Each item in enriched_holdings: {"scheme_name", "scheme_category", "value",
    "return_1y": float | None, "data_available": bool}.
    """
    flags: list[Flag] = []
    available = [h for h in enriched_holdings if h["data_available"]]
    missing = [h for h in enriched_holdings if not h["data_available"]]

    for h in missing:
        flags.append(Flag(
            "warning", f"No live NAV data for {h['scheme_name']}",
            "Could not fetch current NAV for this scheme, so it's excluded from the checks below.",
        ))

    total_value = sum(h["value"] for h in available)
    if total_value > 0 and len(available) >= 2:
        for h in available:
            weight = h["value"] / total_value * 100
            if weight >= CONCENTRATION_THRESHOLD_PCT:
                flags.append(Flag(
                    "warning", f"{h['scheme_name']} is {weight:.0f}% of your portfolio",
                    "A single holding this large means your portfolio's performance is mostly tied to one fund's fortunes.",
                ))

    for h in available:
        if h["return_1y"] is not None and h["return_1y"] < 0:
            flags.append(Flag(
                "warning", f"{h['scheme_name']} is down {abs(h['return_1y']):.1f}% over 1 year",
                "Negative trailing returns aren't automatically a reason to exit, but worth a look at what changed.",
            ))

    by_category: dict[str, list[dict]] = {}
    for h in available:
        by_category.setdefault(h["scheme_category"], []).append(h)

    for category, group in by_category.items():
        if len(group) >= CATEGORY_OVERLAP_MIN_COUNT:
            flags.append(Flag(
                "info", f"{len(group)} funds in '{category}'",
                "Holding several funds in the same category adds little diversification and usually just duplicates exposure.",
            ))
        returns = [h["return_1y"] for h in group if h["return_1y"] is not None]
        if len(returns) >= 2:
            avg_return = sum(returns) / len(returns)
            for h in group:
                if h["return_1y"] is not None and (avg_return - h["return_1y"]) >= UNDERPERFORMER_GAP_PCT:
                    flags.append(Flag(
                        "info", f"{h['scheme_name']} lags its peers in your portfolio",
                        f"Returning {h['return_1y']:.1f}% over 1 year vs {avg_return:.1f}% average among your "
                        f"'{category}' holdings.",
                    ))

    return flags
