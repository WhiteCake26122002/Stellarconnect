"""
Automated pre-tax cost of debt via Damodaran's "synthetic rating" method:
interest coverage ratio (EBIT / Interest Expense) maps to a bond rating, which
maps to a default spread over the risk-free rate. This is the standard
approach when a company's debt isn't actively traded with an observable
market yield (true for the overwhelming majority of companies this app is
used on), and it directly replaces a flat, company-agnostic guess with a
number that actually reflects the company's own leverage and coverage.

Table source: Aswath Damodaran (NYU Stern), "Ratings, Interest Coverage
Ratios and Default Spread" - large (non-financial-service) firms table,
https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ratings.htm
(fetched 2026-09-03). Damodaran also publishes a separate, lower-coverage
table for small-cap (<$5B) firms, but that table is dated January 2017 and
mixing a decade-stale spread environment into an otherwise current WACC
build risks introducing more error than it removes, so it is intentionally
not used here; see the rationale text this module produces for that
disclosure.

This method is designed for non-financial operating companies (EBIT is a
meaningful, comparable measure of debt-servicing capacity); the app already
refuses to build a standard FCFF/WACC model for banks/NBFCs for the same
underlying reason (see yfinance_ingestion.py), so no extra scoping is needed
here.
"""
from __future__ import annotations

from pydantic import BaseModel

SOURCE = (
    "Aswath Damodaran (NYU Stern), \"Ratings, Interest Coverage Ratios and Default Spread\" "
    "- large firm table, pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ratings.htm "
    "(fetched 2026-09-03)"
)

# (min_icr_exclusive, max_icr_inclusive, rating, spread) - large (non-financial-service) firms.
# Ranges are contiguous and taken verbatim from the source table above.
_RATING_TABLE: list[tuple[float, float, str, float]] = [
    (float("-inf"), 0.199999, "D2/D", 0.1900),
    (0.199999, 0.649999, "C2/C", 0.1600),
    (0.649999, 0.799999, "Ca2/CC", 0.1261),
    (0.799999, 1.249999, "Caa/CCC", 0.0885),
    (1.249999, 1.499999, "B3/B-", 0.0509),
    (1.499999, 1.749999, "B2/B", 0.0321),
    (1.749999, 1.999999, "B1/B+", 0.0275),
    (1.999999, 2.249999, "Ba2/BB", 0.0184),
    (2.249999, 2.499999, "Ba1/BB+", 0.0138),
    (2.499999, 2.999999, "Baa2/BBB", 0.0111),
    (2.999999, 4.249999, "A3/A-", 0.0089),
    (4.249999, 5.499999, "A2/A", 0.0078),
    (5.499999, 6.499999, "A1/A+", 0.0070),
    (6.499999, 8.499999, "Aa2/AA", 0.0055),
    (8.499999, float("inf"), "Aaa/AAA", 0.0040),
]


class CostOfDebtEstimate(BaseModel):
    interest_coverage_ratio: float | None
    synthetic_rating: str
    default_spread: float
    pretax_cost_of_debt: float
    rationale: str


def synthetic_rating_and_spread(interest_coverage_ratio: float) -> tuple[str, float]:
    for lo, hi, rating, spread in _RATING_TABLE:
        if lo < interest_coverage_ratio <= hi:
            return rating, spread
    return _RATING_TABLE[-1][2], _RATING_TABLE[-1][3]


def estimate_pretax_cost_of_debt(
    risk_free_rate: float,
    ebit: float,
    interest_expense: float,
    period_label: str = "",
) -> CostOfDebtEstimate:
    """
    Cost of Debt = Risk-Free Rate + Default Spread(synthetic rating from EBIT / Interest Expense).

    `ebit`/`interest_expense` should be the most recent historical fiscal year's figures
    (same "latest snapshot" convention used elsewhere in this app for price, shares, and
    balance-sheet inputs).
    """
    period_note = f" ({period_label})" if period_label else ""

    if interest_expense <= 0:
        rating, spread = _RATING_TABLE[-1][2], _RATING_TABLE[-1][3]
        kd = risk_free_rate + spread
        return CostOfDebtEstimate(
            interest_coverage_ratio=None,
            synthetic_rating=rating,
            default_spread=spread,
            pretax_cost_of_debt=kd,
            rationale=(
                f"No meaningful interest expense reported{period_note}, so an interest-coverage-based "
                "synthetic credit rating is not meaningful. Defaulted to the safest (Aaa/AAA, "
                f"{spread:.2%} spread) tier as a conservative placeholder; this barely affects WACC "
                "when the debt weight is itself near zero. "
                f"Cost of Debt = Risk-Free Rate ({risk_free_rate:.2%}) + Default Spread ({spread:.2%}) "
                f"= {kd:.2%}. Source: {SOURCE}."
            ),
        )

    icr = ebit / interest_expense
    rating, spread = synthetic_rating_and_spread(icr)
    kd = risk_free_rate + spread

    if ebit <= 0:
        coverage_note = f"EBIT is negative or zero{period_note} (interest coverage ratio {icr:.2f}x), "
    else:
        coverage_note = f"Interest coverage ratio (EBIT / Interest Expense){period_note} of {icr:.2f}x "

    rationale = (
        f"{coverage_note}maps to a synthetic {rating} bond rating and a {spread:.2%} default spread "
        f"(Damodaran interest-coverage-ratio table for large non-financial firms). "
        f"Cost of Debt = Risk-Free Rate ({risk_free_rate:.2%}) + Default Spread ({spread:.2%}) = {kd:.2%}. "
        f"Source: {SOURCE}."
    )

    return CostOfDebtEstimate(
        interest_coverage_ratio=icr,
        synthetic_rating=rating,
        default_spread=spread,
        pretax_cost_of_debt=kd,
        rationale=rationale,
    )
