"""
WACC = CAPM cost of equity + after-tax cost of debt, weighted by market-value
capital structure. See spec section 13.
"""
from __future__ import annotations

from pydantic import BaseModel

from .models import AssumptionSource, Assumption, CompanyType, Confidence


class WaccInputs(BaseModel):
    risk_free_rate: Assumption
    beta: Assumption
    equity_risk_premium: Assumption
    size_premium: Assumption
    pretax_cost_of_debt: Assumption
    tax_rate: Assumption
    market_value_of_equity: Assumption
    market_value_of_debt: Assumption


class WaccResult(BaseModel):
    cost_of_equity: float
    after_tax_cost_of_debt: float
    equity_weight: float
    debt_weight: float
    wacc: float
    inputs: WaccInputs


def calculate_wacc(inputs: WaccInputs) -> WaccResult:
    rf = inputs.risk_free_rate.effective_value
    beta = inputs.beta.effective_value
    erp = inputs.equity_risk_premium.effective_value
    size_prem = inputs.size_premium.effective_value
    kd_pretax = inputs.pretax_cost_of_debt.effective_value
    tax = inputs.tax_rate.effective_value
    mv_e = inputs.market_value_of_equity.effective_value
    mv_d = inputs.market_value_of_debt.effective_value

    if mv_e < 0 or mv_d < 0:
        raise ValueError("Market values of equity and debt must be non-negative.")
    total = mv_e + mv_d
    if total <= 0:
        raise ValueError("Total capital (equity + debt) must be greater than zero to compute WACC weights.")

    cost_of_equity = rf + beta * erp + size_prem
    after_tax_kd = kd_pretax * (1 - tax)
    we = mv_e / total
    wd = mv_d / total
    wacc = we * cost_of_equity + wd * after_tax_kd

    return WaccResult(
        cost_of_equity=cost_of_equity,
        after_tax_cost_of_debt=after_tax_kd,
        equity_weight=we,
        debt_weight=wd,
        wacc=wacc,
        inputs=inputs,
    )


def unlever_beta(levered_beta: float, debt_to_equity: float, tax_rate: float) -> float:
    """Hamada equation, used to unlever comparable-company betas."""
    return levered_beta / (1 + (1 - tax_rate) * debt_to_equity)


def relever_beta(unlevered_beta: float, debt_to_equity: float, tax_rate: float) -> float:
    return unlevered_beta * (1 + (1 - tax_rate) * debt_to_equity)


def make_wacc_inputs(
    *,
    company_type: CompanyType,
    risk_free_rate: float,
    beta: float,
    beta_source: AssumptionSource,
    beta_rationale: str,
    equity_risk_premium: float,
    pretax_cost_of_debt: float,
    tax_rate: float,
    market_value_of_equity: float,
    market_value_of_debt: float,
    size_premium: float = 0.0,
    source_date: str = "",
    pretax_cost_of_debt_source: AssumptionSource | None = None,
    pretax_cost_of_debt_rationale: str | None = None,
) -> WaccInputs:
    """Convenience constructor that stamps the right AssumptionSource per company type (spec section 13)."""
    market_source = AssumptionSource.MARKET_DATA if company_type == CompanyType.PUBLIC else AssumptionSource.USER_ASSUMPTION

    return WaccInputs(
        risk_free_rate=Assumption(
            name="Risk-Free Rate",
            value=risk_free_rate,
            unit="%",
            source=AssumptionSource.MARKET_DATA,
            source_date=source_date,
            confidence=Confidence.HIGH,
            rationale="10-year government bond yield as of the source date.",
        ),
        beta=Assumption(
            name="Beta",
            value=beta,
            unit="x",
            source=beta_source,
            source_date=source_date,
            confidence=Confidence.HIGH if company_type == CompanyType.PUBLIC else Confidence.LOW,
            rationale=beta_rationale,
        ),
        equity_risk_premium=Assumption(
            name="Equity Risk Premium",
            value=equity_risk_premium,
            unit="%",
            source=AssumptionSource.MARKET_DATA,
            source_date=source_date,
            confidence=Confidence.MEDIUM,
            rationale="Long-run historical equity risk premium for the company's market.",
        ),
        size_premium=Assumption(
            name="Size Premium",
            value=size_premium,
            unit="%",
            source=AssumptionSource.USER_ASSUMPTION if size_premium else AssumptionSource.CALCULATED,
            source_date=source_date,
            confidence=Confidence.LOW,
            rationale=(
                "Additional premium for small-cap / private-company risk not captured by beta."
                if size_premium
                else "No size premium applied."
            ),
        ),
        pretax_cost_of_debt=Assumption(
            name="Pre-Tax Cost of Debt",
            value=pretax_cost_of_debt,
            unit="%",
            source=pretax_cost_of_debt_source if pretax_cost_of_debt_source is not None else market_source,
            source_date=source_date,
            confidence=Confidence.MEDIUM,
            rationale=pretax_cost_of_debt_rationale or "Based on the company's current borrowing rate / comparable credit spread.",
        ),
        tax_rate=Assumption(
            name="Marginal Tax Rate",
            value=tax_rate,
            unit="%",
            source=AssumptionSource.HISTORICAL_ACTUAL,
            source_date=source_date,
            confidence=Confidence.MEDIUM,
            rationale="Historical effective tax rate used as a proxy for the marginal rate.",
        ),
        market_value_of_equity=Assumption(
            name="Market Value of Equity",
            value=market_value_of_equity,
            unit="currency",
            source=market_source,
            source_date=source_date,
            confidence=Confidence.HIGH if company_type == CompanyType.PUBLIC else Confidence.LOW,
            rationale=(
                "Share price x diluted shares outstanding."
                if company_type == CompanyType.PUBLIC
                else "User-specified target/estimated capital structure (no public market value exists)."
            ),
        ),
        market_value_of_debt=Assumption(
            name="Market Value of Debt",
            value=market_value_of_debt,
            unit="currency",
            source=AssumptionSource.HISTORICAL_ACTUAL,
            source_date=source_date,
            confidence=Confidence.MEDIUM,
            rationale="Book value of total debt used as a proxy for market value of debt.",
        ),
    )
