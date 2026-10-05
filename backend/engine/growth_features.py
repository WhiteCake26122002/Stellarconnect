"""
Structured, numeric context for the growth-intelligence LLM.

The model is a next-token predictor, not a calculator. Arithmetic that DCF
depends on (CAGR, ROIC, reinvestment, implied fundamental g) is computed here
and passed in as data so the LLM cannot invent the identities.
"""
from __future__ import annotations

import re

from pydantic import BaseModel

from .growth_evidence import classify_growth_regime, fade_growth_path, select_year1_growth
from .historical import HistoricalSummary
from .models import Company, HistoricalFinancials

MAX_DEFAULT_YEAR_GROWTH = 0.40
MIN_YEAR_GROWTH = -0.50
MAX_DATA_CHARS = 80
MIN_USABLE_ROIC = 0.03
MAX_REINVESTMENT_RATE = 1.25
MAX_CAPEX_PCT = 0.45
MIN_CAPEX_PCT = 0.0


class GrowthFeaturePack(BaseModel):
    forecast_years: int
    long_term_growth_rate: float
    terminal_growth_ceiling: float
    max_year_growth: float = MAX_DEFAULT_YEAR_GROWTH
    min_year_growth: float = MIN_YEAR_GROWTH
    ticker: str
    name: str
    industry: str
    country: str
    currency: str
    periods: list[str]
    revenue: list[float]
    yoy_growth: list[float | None]
    cagr_3y: float | None
    cagr_5y: float | None
    recent_2y_avg_growth: float | None
    ebit_margin: list[float]
    avg_ebit_margin: float
    avg_capex_pct_revenue: float
    avg_da_pct_revenue: float
    avg_nwc_pct_revenue: float
    nopat: float | None
    invested_capital: float | None
    roic: float | None
    reinvestment_rate: float | None
    implied_fundamental_g: float | None
    history_years: int
    avg_tax_rate: float = 0.0
    nopat_margin: float | None = None
    baseline_revenue_growth: list[float] = []


def sanitize_data_text(value: str | None) -> str:
    """Strip control characters and bound length so company fields stay data, not prompt."""
    text = re.sub(r"[\x00-\x1f\x7f]", " ", value or "")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > MAX_DATA_CHARS:
        text = text[:MAX_DATA_CHARS]
    return text


def _latest_invested_capital(hist: HistoricalFinancials) -> float | None:
    bs = hist.balance_sheets[-1]
    ic = bs.shareholders_equity + bs.total_debt_and_leases - bs.total_cash_and_investments
    if ic <= 1e-6:
        return None
    return ic


def _latest_reinvestment(hist: HistoricalFinancials) -> float:
    cf = hist.cash_flows[-1]
    return cf.capex - cf.da + cf.change_in_nwc


def extract_growth_features(
    company: Company,
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    forecast_years: int,
    long_term_growth_rate: float,
    terminal_growth_ceiling: float,
) -> GrowthFeaturePack:
    latest = hist.income_statements[-1]
    nopat = latest.ebit * (1 - latest.tax_rate) if latest.tax_rate is not None else latest.ebit
    invested_capital = _latest_invested_capital(hist)
    roic = (nopat / invested_capital) if invested_capital and invested_capital > 0 else None
    reinvestment = _latest_reinvestment(hist)
    reinvestment_rate = (reinvestment / nopat) if nopat and abs(nopat) > 1e-6 else None
    implied_g = None
    if roic is not None and reinvestment_rate is not None:
        implied_g = roic * reinvestment_rate

    tax = max(0.0, min(0.40, summary.avg_tax_rate))
    nopat_margin = summary.avg_ebit_margin * (1.0 - tax) if summary.avg_ebit_margin else None
    pack = GrowthFeaturePack(
        forecast_years=forecast_years,
        long_term_growth_rate=long_term_growth_rate,
        terminal_growth_ceiling=terminal_growth_ceiling,
        ticker=sanitize_data_text(company.ticker or ""),
        name=sanitize_data_text(company.name),
        industry=sanitize_data_text(company.industry),
        country=sanitize_data_text(company.country),
        currency=sanitize_data_text(company.currency),
        periods=list(summary.years[i].period for i in range(len(summary.years))),
        revenue=[y.revenue for y in summary.years],
        yoy_growth=[y.revenue_growth for y in summary.years],
        cagr_3y=summary.revenue_cagr_3y,
        cagr_5y=summary.revenue_cagr_5y,
        recent_2y_avg_growth=summary.recent_2y_avg_growth,
        ebit_margin=[y.ebit_margin for y in summary.years],
        avg_ebit_margin=summary.avg_ebit_margin,
        avg_capex_pct_revenue=summary.avg_capex_pct_revenue,
        avg_da_pct_revenue=summary.avg_da_pct_revenue,
        avg_nwc_pct_revenue=summary.avg_nwc_pct_revenue,
        nopat=nopat,
        invested_capital=invested_capital,
        roic=roic,
        reinvestment_rate=reinvestment_rate,
        implied_fundamental_g=implied_g,
        history_years=len(summary.years),
        avg_tax_rate=summary.avg_tax_rate,
        nopat_margin=nopat_margin,
    )
    pack.baseline_revenue_growth = identity_growth_path(pack)
    return pack


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def identity_growth_path(pack: GrowthFeaturePack) -> list[float]:
    """Year-1 from the evidence hierarchy, faded to the pack's terminal / long-term rate."""
    yoy = [g for g in pack.yoy_growth if g is not None]
    regime = classify_growth_regime(yoy)
    median_annual = _median(yoy) if yoy else None
    last_1y = yoy[-1] if yoy else None
    year1, _method, _source, _rationale = select_year1_growth(
        implied_fundamental_g=pack.implied_fundamental_g,
        roic=pack.roic,
        cagr_3y=pack.cagr_3y,
        cagr_5y=pack.cagr_5y,
        median_annual=median_annual,
        last_1y=last_1y,
        regime=regime,
    )
    year1 = min(max(year1, pack.min_year_growth), pack.max_year_growth)
    return fade_growth_path(year1, pack.long_term_growth_rate, pack.forecast_years, regime)


def capex_pct_from_growth(pack: GrowthFeaturePack, growth_path: list[float]) -> list[float] | None:
    """
    Capex % of revenue implied by g = ROIC × RR, holding NWC intensity and D&A % at history.

    capex% = RR × NOPAT margin + DA% − NWC% × g/(1+g)
    """
    if pack.roic is None or pack.roic < MIN_USABLE_ROIC:
        return None
    nopat_m = pack.nopat_margin
    if nopat_m is None or nopat_m <= 0:
        return None
    da = pack.avg_da_pct_revenue
    nwc = pack.avg_nwc_pct_revenue
    out: list[float] = []
    for g in growth_path:
        rr = min(MAX_REINVESTMENT_RATE, max(0.0, g / pack.roic))
        nwc_drag = nwc * g / (1.0 + g) if g > -0.999 else 0.0
        capex = rr * nopat_m + da - nwc_drag
        out.append(min(MAX_CAPEX_PCT, max(MIN_CAPEX_PCT, capex)))
    return out


def feature_pack_hash(pack: GrowthFeaturePack, model_name: str) -> str:
    import hashlib
    import json

    payload = pack.model_dump()
    payload["_model"] = model_name
    blob = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()
