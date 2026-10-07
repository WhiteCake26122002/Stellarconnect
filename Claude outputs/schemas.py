from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


ALLOWED_DESIGNATIONS = frozenset(
    {
        "student",
        "analyst",
        "associate",
        "vice president",
        "portfolio manager",
        "trader",
        "other",
    }
)


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=120)
    first_name: str | None = Field(default=None, max_length=80)
    last_name: str | None = Field(default=None, max_length=80)
    designation: str | None = Field(default=None, max_length=40)

    @field_validator("first_name", "last_name", "display_name", "designation", mode="before")
    @classmethod
    def blank_to_none(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @field_validator("designation")
    @classmethod
    def check_designation(cls, value: str | None) -> str | None:
        if value is None:
            return None
        key = value.lower()
        if key not in ALLOWED_DESIGNATIONS:
            raise ValueError("Choose a designation from the list.")
        return key

    def resolved_name(self) -> str:
        parts = [part for part in (self.first_name, self.last_name) if part]
        if parts:
            return " ".join(parts)
        return self.display_name or ""


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str
    first_name: str | None = None
    last_name: str | None = None
    designation: str | None = None


class CompanySearchHit(BaseModel):
    symbol: str
    name: str
    exchange: str = ""


class QuotesRequest(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=300)


class YearOverridePatch(BaseModel):
    revenue_growth: list[Optional[float]] | None = None
    capex_pct_revenue: list[Optional[float]] | None = None
    nwc_pct_revenue: list[Optional[float]] | None = None
    tax_rate: list[Optional[float]] | None = None


class DriversPatch(BaseModel):
    forecast_years: int | None = Field(default=None, ge=3, le=10)
    growth_method: Literal["llm", "historical", "evidence"] | None = None
    long_term_growth: float | None = None
    target_ebitda_margin: float | None = None
    risk_free_rate: float | None = None
    beta: float | None = None
    equity_risk_premium: float | None = None
    pretax_cost_of_debt: float | None = None
    terminal_growth: float | None = None
    exit_multiple: float | None = None
    size_premium: float | None = None
    target_equity_weight: float | None = None
    preferred_stock: float | None = None
    year_overrides: YearOverridePatch | None = None
    company_guidance_revenue_growth: float | None = None
    company_guidance_quote: str | None = None
    company_guidance_period: str | None = None


class GuidanceExtractionRequest(BaseModel):
    source_text: str = Field(min_length=1, max_length=200_000)
    source_label: str | None = None


class HistoricalsDraftRequest(BaseModel):
    source_text: str = Field(min_length=1, max_length=200_000)
    company_name: str | None = None


class ManualCompanyIn(BaseModel):
    name: str
    ticker: str | None = None
    company_type: Literal["public", "private"] = "public"
    currency: str = "USD"
    industry: str = ""
    country: str = ""
    website: str = ""
    diluted_shares_outstanding: float | None = None
    current_share_price: float | None = None
    minority_interest: float = 0.0
    preferred_stock: float = 0.0


class ManualHistoricalsIn(BaseModel):
    income_statements: list[dict[str, Any]]
    balance_sheets: list[dict[str, Any]]
    cash_flows: list[dict[str, Any]]


class CreateModelRequest(BaseModel):
    source: Literal["ticker", "manual", "sample"] = "ticker"
    ticker: str | None = None
    name: str | None = None
    company: ManualCompanyIn | None = None
    historicals: ManualHistoricalsIn | None = None
    drivers: DriversPatch | None = None


class ExportRequest(BaseModel):
    format: Literal["xlsx", "pdf"]


class ModelListItem(BaseModel):
    id: str
    name: str
    ticker: str | None
    currency: str
    country: str
    company_type: str
    source: str
    updated_at: str | None = None
    implied_share_price: float | None = None
    current_share_price: float | None = None
    upside: float | None = None
    integrity_score: int | None = None
    integrity_band: str | None = None
    valuation_error: str | None = None
