"""Data-quality checks and Model Integrity Score. Spec section 23-24."""
from __future__ import annotations

from pydantic import BaseModel

from .forecast import ForecastResult
from .historical import HistoricalSummary
from .models import HistoricalFinancials
from .valuation import DCFValuationResult
from .wacc import WaccResult


class ValidationIssue(BaseModel):
    severity: str  # "error" | "warning" | "info"
    message: str


class IntegrityReport(BaseModel):
    score: int
    max_score: int = 100
    issues: list[ValidationIssue]

    @property
    def summary(self) -> str:
        band = "ready for review" if self.score >= 80 else "needs attention" if self.score >= 60 else "not reliable"
        return f"{self.score}/{self.max_score} — Model {band}"


def run_validation(
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    forecast: ForecastResult,
    wacc_result: WaccResult,
    valuation: DCFValuationResult,
) -> IntegrityReport:
    issues: list[ValidationIssue] = []
    score = 100

    if len(hist.income_statements) < 3:
        issues.append(ValidationIssue(severity="warning", message="Fewer than 3 historical years available; CAGR and trend analysis may be unreliable."))
        score -= 10

    for inc in hist.income_statements:
        if inc.revenue < 0:
            issues.append(ValidationIssue(severity="error", message=f"Negative revenue in {inc.period}."))
            score -= 20
        if inc.revenue == 0:
            issues.append(ValidationIssue(severity="error", message=f"Zero revenue in {inc.period}."))
            score -= 20

    for bs in hist.balance_sheets:
        if bs.cash == 0 and bs.marketable_securities == 0:
            issues.append(ValidationIssue(severity="warning", message=f"No cash reported in {bs.period}; verify this is not a data-extraction gap."))
            score -= 5
        if bs.total_debt_and_leases == 0:
            issues.append(ValidationIssue(severity="info", message=f"No debt reported in {bs.period} (may be genuinely debt-free)."))
        implied_liabilities_and_equity = bs.total_liabilities + bs.shareholders_equity
        if bs.total_assets and abs(bs.total_assets - implied_liabilities_and_equity) / bs.total_assets > 0.02:
            issues.append(
                ValidationIssue(
                    severity="warning",
                    message=(
                        f"Balance sheet does not balance in {bs.period}: assets {bs.total_assets:,.1f} vs. "
                        f"liabilities + equity {implied_liabilities_and_equity:,.1f}."
                    ),
                )
            )
            score -= 5

    latest_bs = hist.balance_sheets[-1]
    latest_revenue = hist.income_statements[-1].revenue
    if latest_revenue:
        nwc_pct_of_revenue = latest_bs.net_working_capital / latest_revenue
        if nwc_pct_of_revenue > 1.0:
            issues.append(
                ValidationIssue(
                    severity="warning",
                    message=(
                        f"Net working capital ({nwc_pct_of_revenue:.0%} of revenue) is unusually large relative to "
                        "revenue - typical for real-estate developers, homebuilders, and other land/inventory-heavy "
                        "businesses, where 'inventory' is really a multi-year land bank rather than short-cycle "
                        "stock. This FCFF/WACC DCF template assumes working capital scales with revenue the way it "
                        "does for a typical operating company, which understates value for this kind of balance "
                        "sheet; professional analysts usually value such companies with Sum-of-the-Parts or Net "
                        "Asset Value instead of a consolidated FCFF DCF. Treat this valuation as a lower-bound "
                        "sanity check rather than a primary estimate, and cross-check against a NAV/SOTP source."
                    ),
                )
            )
            score -= 10

    periods = [i.period for i in hist.income_statements]
    if len(periods) != len(set(periods)):
        issues.append(ValidationIssue(severity="error", message="Duplicate financial periods detected in uploaded historicals."))
        score -= 20

    if wacc_result.wacc <= valuation.terminal_growth:
        issues.append(ValidationIssue(severity="error", message=f"WACC ({wacc_result.wacc:.2%}) must exceed terminal growth ({valuation.terminal_growth:.2%})."))
        score -= 30

    if valuation.terminal_growth > 0.06:
        issues.append(ValidationIssue(severity="warning", message=f"Terminal growth of {valuation.terminal_growth:.2%} exceeds typical long-run nominal GDP growth; confirm this is defensible."))
        score -= 10

    for y in forecast.years:
        if y.ebitda_margin < 0:
            issues.append(ValidationIssue(severity="warning", message=f"Negative EBITDA margin forecast in {y.period}."))
            score -= 10
        if y.ebitda_margin > 0.70:
            issues.append(ValidationIssue(severity="warning", message=f"EBITDA margin forecast of {y.ebitda_margin:.1%} in {y.period} is unusually high; confirm assumption is defensible."))
            score -= 5
        if y.fcff < 0:
            issues.append(ValidationIssue(severity="warning", message=f"Negative unlevered FCF forecast in {y.period}."))
            score -= 5

    for i in range(1, len(forecast.years)):
        prev, curr = forecast.years[i - 1], forecast.years[i]
        if prev.revenue and abs(curr.revenue / prev.revenue - 1) > 0.5:
            issues.append(ValidationIssue(severity="warning", message=f"Large unexplained revenue jump into {curr.period} (>{50:.0f}% YoY)."))
            score -= 5

    if valuation.equity_bridge.equity_value < 0:
        issues.append(
            ValidationIssue(
                severity="error",
                message=(
                    f"Equity Value is negative ({valuation.equity_bridge.equity_value:,.0f}). This means Enterprise "
                    "Value plus cash is insufficient to cover debt, lease liabilities, minority interest, and "
                    "preferred stock combined. This can be a legitimate result for a distressed or heavily "
                    "levered/minority-diluted company, but always warrants manual verification of the debt and "
                    "minority interest figures before trusting the implied share price."
                ),
            )
        )
        score -= 25

    non_controlling_claims = valuation.equity_bridge.less_minority_interest + valuation.equity_bridge.less_preferred_stock
    if valuation.enterprise_value > 0 and non_controlling_claims / valuation.enterprise_value > 0.15:
        issues.append(
            ValidationIssue(
                severity="warning",
                message=(
                    f"Minority interest and preferred stock together represent "
                    f"{non_controlling_claims / valuation.enterprise_value:.0%} of Enterprise Value — unusually "
                    "large. Verify this figure against the source financial statements; it materially swings "
                    "the Enterprise Value -> Equity Value bridge."
                ),
            )
        )
        score -= 5

    if valuation.terminal_value_pct_of_ev > 0.90:
        issues.append(
            ValidationIssue(
                severity="warning",
                message=(
                    f"Terminal value represents {valuation.terminal_value_pct_of_ev:.0%} of Enterprise Value — "
                    "unusually high even for a stable/mature company, meaning the explicit forecast period is "
                    "contributing almost nothing to the valuation and the result is dominated by two assumptions "
                    "(WACC and terminal growth). Consider a longer explicit forecast horizon (sidebar) or "
                    "double-checking those two inputs."
                ),
            )
        )
        score -= 5

    score = max(0, min(100, score))
    return IntegrityReport(score=score, issues=issues)
