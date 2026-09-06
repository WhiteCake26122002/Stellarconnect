"""
Discounts the explicit FCFF forecast and terminal value back to present value,
then bridges Enterprise Value to Equity Value. Spec sections 14-15.
"""
from __future__ import annotations

from pydantic import BaseModel

from .forecast import ForecastResult
from .models import Company
from .terminal_value import compare_terminal_value_methods
from .wacc import WaccResult


class DiscountedYear(BaseModel):
    period: str
    fcff: float
    discount_factor: float
    present_value: float


class EquityBridge(BaseModel):
    enterprise_value: float
    plus_cash_and_investments: float
    less_total_debt: float
    less_lease_liabilities: float
    less_minority_interest: float
    less_preferred_stock: float
    equity_value: float
    diluted_shares_outstanding: float | None
    equity_value_per_share: float | None
    current_share_price: float | None
    upside_downside: float | None


class DCFValuationResult(BaseModel):
    discounted_years: list[DiscountedYear]
    pv_of_explicit_fcf: float
    terminal_growth: float
    exit_multiple: float | None
    terminal_value_gordon: float
    terminal_value_exit_multiple: float | None
    pv_of_terminal_value: float
    terminal_value_pct_of_ev: float
    enterprise_value: float
    equity_bridge: EquityBridge
    wacc: float


def discount_cash_flows(fcffs: list[float], periods: list[str], wacc: float) -> tuple[list[DiscountedYear], float]:
    discounted: list[DiscountedYear] = []
    total_pv = 0.0
    for t, (period, fcff) in enumerate(zip(periods, fcffs), start=1):
        factor = 1 / (1 + wacc) ** t
        pv = fcff * factor
        total_pv += pv
        discounted.append(DiscountedYear(period=period, fcff=fcff, discount_factor=factor, present_value=pv))
    return discounted, total_pv


def bridge_to_equity_value(
    enterprise_value: float,
    cash_and_investments: float,
    total_debt: float,
    lease_liabilities: float,
    minority_interest: float,
    preferred_stock: float,
    diluted_shares_outstanding: float | None,
    current_share_price: float | None,
) -> EquityBridge:
    equity_value = (
        enterprise_value
        + cash_and_investments
        - total_debt
        - lease_liabilities
        - minority_interest
        - preferred_stock
    )
    per_share = (equity_value / diluted_shares_outstanding) if diluted_shares_outstanding else None
    upside = (per_share / current_share_price - 1) if (per_share is not None and current_share_price) else None

    return EquityBridge(
        enterprise_value=enterprise_value,
        plus_cash_and_investments=cash_and_investments,
        less_total_debt=total_debt,
        less_lease_liabilities=lease_liabilities,
        less_minority_interest=minority_interest,
        less_preferred_stock=preferred_stock,
        equity_value=equity_value,
        diluted_shares_outstanding=diluted_shares_outstanding,
        equity_value_per_share=per_share,
        current_share_price=current_share_price,
        upside_downside=upside,
    )


def run_dcf_valuation(
    forecast: ForecastResult,
    wacc_result: WaccResult,
    terminal_growth: float,
    company: Company,
    cash_and_investments: float,
    total_debt: float,
    lease_liabilities: float,
    exit_multiple: float | None = None,
) -> DCFValuationResult:
    fcffs = [y.fcff for y in forecast.years]
    periods = [y.period for y in forecast.years]
    wacc = wacc_result.wacc

    discounted_years, pv_explicit = discount_cash_flows(fcffs, periods, wacc)

    final_fcff = fcffs[-1]
    final_ebitda = forecast.years[-1].ebitda
    tv_methods = compare_terminal_value_methods(final_fcff, final_ebitda, wacc, terminal_growth, exit_multiple)

    tv_gordon = tv_methods["gordon_growth"].gordon_growth_value
    tv_exit = tv_methods["exit_multiple"].exit_multiple_value if "exit_multiple" in tv_methods else None

    n = len(fcffs)
    terminal_discount_factor = 1 / (1 + wacc) ** n
    pv_terminal_value = tv_gordon * terminal_discount_factor

    enterprise_value = pv_explicit + pv_terminal_value
    tv_pct_of_ev = pv_terminal_value / enterprise_value if enterprise_value else 0.0

    equity_bridge = bridge_to_equity_value(
        enterprise_value=enterprise_value,
        cash_and_investments=cash_and_investments,
        total_debt=total_debt,
        lease_liabilities=lease_liabilities,
        minority_interest=company.minority_interest,
        preferred_stock=company.preferred_stock,
        diluted_shares_outstanding=company.diluted_shares_outstanding,
        current_share_price=company.current_share_price,
    )

    return DCFValuationResult(
        discounted_years=discounted_years,
        pv_of_explicit_fcf=pv_explicit,
        terminal_growth=terminal_growth,
        exit_multiple=exit_multiple,
        terminal_value_gordon=tv_gordon,
        terminal_value_exit_multiple=tv_exit,
        pv_of_terminal_value=pv_terminal_value,
        terminal_value_pct_of_ev=tv_pct_of_ev,
        enterprise_value=enterprise_value,
        equity_bridge=equity_bridge,
        wacc=wacc,
    )
