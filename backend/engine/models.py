"""
Core data models for the DCF valuation engine.

All monetary figures are in the company's reporting currency, expressed in
millions, unless a model explicitly says otherwise. Keeping one consistent
unit end-to-end avoids the "unit mismatch" class of bug that silently
produces a valuation off by 1000x.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class CompanyType(str, Enum):
    PUBLIC = "public"
    PRIVATE = "private"


class AssumptionSource(str, Enum):
    """Where a number came from. This is the backbone of auditability (spec section 21/38)."""

    HISTORICAL_ACTUAL = "historical_actual"
    COMPANY_GUIDANCE = "company_guidance"
    ANALYST_CONSENSUS = "analyst_consensus"
    MARKET_DATA = "market_data"
    INDUSTRY_BENCHMARK = "industry_benchmark"
    LLM_PROPOSAL = "llm_proposal"
    USER_ASSUMPTION = "user_assumption"
    CALCULATED = "calculated"


class Confidence(str, Enum):
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class Assumption(BaseModel):
    """
    A single labeled, sourced, auditable input to the model.

    Every material forecast driver in the engine is represented as one of
    these rather than a bare float, so the UI (and this JSON) can always
    answer "where did this number come from and why".
    """

    name: str
    value: float
    unit: str = ""
    period: Optional[str] = None
    source: AssumptionSource
    source_date: Optional[str] = None
    confidence: Confidence = Confidence.MEDIUM
    rationale: str = ""
    original_value: Optional[float] = None
    user_override: Optional[float] = None

    @property
    def effective_value(self) -> float:
        return self.user_override if self.user_override is not None else self.value

    def overridden(self, new_value: float) -> "Assumption":
        clone = self.model_copy()
        if clone.original_value is None:
            clone.original_value = clone.value
        clone.user_override = new_value
        clone.source = AssumptionSource.USER_ASSUMPTION
        clone.confidence = Confidence.HIGH
        clone.rationale = f"User override ({clone.original_value} -> {new_value}). " + clone.rationale
        return clone


class Company(BaseModel):
    name: str
    ticker: Optional[str] = None
    company_type: CompanyType
    currency: str = "USD"
    units: str = "millions"
    industry: str = ""
    country: str = ""
    website: str = ""
    fiscal_year_end: str = "December"
    diluted_shares_outstanding: Optional[float] = None
    current_share_price: Optional[float] = None
    minority_interest: float = 0.0
    preferred_stock: float = 0.0
    minority_interest_reported: bool = True
    shares_status: str = "available"
    shares_source: str = ""


class IncomeStatement(BaseModel):
    period: str
    revenue: float
    cogs: float
    rnd: float = 0.0
    sm: float = 0.0
    ga: float = 0.0
    other_opex: float = 0.0
    da: float = 0.0
    interest_expense: float = 0.0
    taxes: float = 0.0
    other_below_ebit: float = 0.0  # non-operating items between EBIT and pre-tax income

    @property
    def gross_profit(self) -> float:
        return self.revenue - self.cogs

    @property
    def gross_margin(self) -> float:
        return _safe_div(self.gross_profit, self.revenue)

    @property
    def total_opex_ex_da(self) -> float:
        return self.rnd + self.sm + self.ga + self.other_opex

    @property
    def ebitda(self) -> float:
        return self.gross_profit - self.total_opex_ex_da

    @property
    def ebitda_margin(self) -> float:
        return _safe_div(self.ebitda, self.revenue)

    @property
    def ebit(self) -> float:
        return self.ebitda - self.da

    @property
    def ebit_margin(self) -> float:
        return _safe_div(self.ebit, self.revenue)

    @property
    def pretax_income(self) -> float:
        return self.ebit - self.interest_expense + self.other_below_ebit

    @property
    def tax_rate(self) -> float:
        # Guard rail: pretax_income can land very close to zero for a genuine breakeven year (or
        # a source-data gap even after the ingestion-level reconstruction), which would otherwise
        # send taxes / pretax_income to an astronomical number and, through the multi-year average,
        # blow up every forecast year's NOPAT/FCFF. No real effective tax rate falls outside a wide
        # -50%/+60% band (tax credits can make it negative; one-off items can push it above the
        # statutory rate), so clamp rather than let a division artifact propagate.
        rate = _safe_div(self.taxes, self.pretax_income)
        return max(-0.50, min(0.60, rate))

    @property
    def net_income(self) -> float:
        return self.pretax_income - self.taxes


class BalanceSheet(BaseModel):
    period: str
    cash: float
    marketable_securities: float = 0.0
    accounts_receivable: float
    inventory: float = 0.0
    other_current_assets: float = 0.0
    ppe: float
    goodwill: float = 0.0
    intangibles: float = 0.0
    other_assets: float = 0.0
    accounts_payable: float
    accrued_liabilities: float = 0.0
    short_term_debt: float = 0.0
    long_term_debt: float = 0.0
    lease_liabilities: float = 0.0
    other_liabilities: float = 0.0
    shareholders_equity: float
    cash_reported: bool = True
    operating_wc_complete: bool = True
    cash_status: str = "available"
    cash_source: str = ""
    nwc_status: str = "available"
    debt_status: str = "available"
    debt_source: str = ""
    non_operating_investments: float = 0.0
    non_operating_investments_status: str = "unavailable"
    non_operating_investments_source: str = ""
    reported_total_assets: float | None = None
    screener_other_assets_plug: float | None = None
    screener_investments: float | None = None
    screener_borrowings: float | None = None
    source_overlay: dict = Field(default_factory=dict)

    @property
    def total_debt(self) -> float:
        return self.short_term_debt + self.long_term_debt

    @property
    def total_debt_and_leases(self) -> float:
        return self.total_debt + self.lease_liabilities

    @property
    def total_cash_and_investments(self) -> float:
        return self.cash + self.marketable_securities

    @property
    def net_working_capital(self) -> float:
        """Operating NWC only: excludes cash, investments, and debt (spec section 11)."""
        operating_current_assets = self.accounts_receivable + self.inventory + self.other_current_assets
        operating_current_liabilities = self.accounts_payable + self.accrued_liabilities
        return operating_current_assets - operating_current_liabilities

    @property
    def total_assets(self) -> float:
        return (
            self.cash
            + self.marketable_securities
            + self.accounts_receivable
            + self.inventory
            + self.other_current_assets
            + self.ppe
            + self.goodwill
            + self.intangibles
            + self.other_assets
        )

    @property
    def total_liabilities(self) -> float:
        return (
            self.accounts_payable
            + self.accrued_liabilities
            + self.short_term_debt
            + self.long_term_debt
            + self.lease_liabilities
            + self.other_liabilities
        )


class CashFlowStatement(BaseModel):
    period: str
    net_income: float
    da: float
    stock_based_comp: float = 0.0
    other_noncash: float = 0.0
    change_in_nwc: float = 0.0
    capex: float
    acquisitions: float = 0.0
    other_investing: float = 0.0
    debt_issuance_repayment: float = 0.0
    equity_issuance_repurchase: float = 0.0
    dividends: float = 0.0

    @property
    def cfo(self) -> float:
        return self.net_income + self.da + self.stock_based_comp + self.other_noncash - self.change_in_nwc

    @property
    def cfi(self) -> float:
        return -self.capex - self.acquisitions + self.other_investing

    @property
    def cff(self) -> float:
        return self.debt_issuance_repayment + self.equity_issuance_repurchase - self.dividends

    @property
    def net_change_in_cash(self) -> float:
        return self.cfo + self.cfi + self.cff


class HistoricalFinancials(BaseModel):
    """One bundle per historical fiscal year. `periods` must be chronological (oldest first)."""

    income_statements: list[IncomeStatement]
    balance_sheets: list[BalanceSheet]
    cash_flows: list[CashFlowStatement]

    @property
    def periods(self) -> list[str]:
        return [i.period for i in self.income_statements]


def _safe_div(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return 0.0
    return numerator / denominator
