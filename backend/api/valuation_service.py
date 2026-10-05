"""Run the existing DCF engine and assemble a workspace payload."""
from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, Field

from backend.common.currency_format import is_india
from backend.data.damodaran_reference import (
    GrowthDataUnavailable,
    get_country_risk,
    match_india_sector_beta,
    match_india_sector_growth,
)
from backend.data.sample_company import build_orion_company, build_orion_historicals
from backend.data.terminal_growth_norms import terminal_growth_for_company
from backend.engine.company_profile import classify_company, BusinessTemplate
from backend.engine.cost_of_debt import estimate_pretax_cost_of_debt
from backend.engine.cyclical import normalize_cyclical_margins
from backend.engine.negative_iv_forensics import (
    classify_investment_lines,
    classify_other_assets,
    run_negative_iv_diagnostics,
)
from backend.engine.forecast import INDIA_STATUTORY_TAX, ForecastAssumptions, build_default_assumptions, project_financials
from backend.engine.asset_classification import classify_latest_assets, detect_group_structure, nci_consistent_with_consolidated_fcff
from backend.engine.valuation_confidence import assess_valuation_confidence
from backend.engine.growth_evidence import build_growth_evidence, classify_growth_regime
from backend.engine.growth_features import extract_growth_features
from backend.engine.growth_intelligence import apply_growth_intelligence
from backend.engine.growth_llm import HttpGrowthLLMProvider
from backend.engine.guidance_llm import HttpGuidanceLLMProvider
from backend.engine.historical import analyze_historicals
from backend.engine.models import AssumptionSource, Company, CompanyType, HistoricalFinancials
from backend.engine.quality_flags import build_quality_flags
from backend.engine.reliability_report import build_reliability
from backend.engine.scenarios import run_all_scenarios
from backend.engine.sensitivity import (
    ValuationContext,
    growth_vs_capex_table,
    growth_vs_margin_table,
    growth_vs_wacc_table,
    rank_valuation_drivers,
    wacc_vs_growth_table,
)
from backend.engine.valuation import run_dcf_valuation
from backend.engine.validation import run_validation
from backend.engine.wacc import WaccInputs, calculate_wacc, make_wacc_inputs, relever_beta
from backend.ingestion.screener_ingestion import (
    ScreenerUnavailable,
    ScreenerUnsupported,
    fetch_screener_company,
    is_india_listed,
)
from backend.ingestion.yfinance_ingestion import fetch_company

from .config import get_settings
from .market import fetch_beta, resolve_risk_free_rate


def get_growth_provider() -> HttpGrowthLLMProvider:
    settings = get_settings()
    return HttpGrowthLLMProvider(
        api_key=settings.growth_llm_api_key,
        base_url=settings.growth_llm_base_url,
        model=settings.growth_llm_model,
        timeout_seconds=settings.growth_llm_timeout_seconds,
        enabled=settings.growth_llm_enabled,
    )


def get_guidance_provider() -> HttpGuidanceLLMProvider:
    """Same provider account as growth_llm (api_key/base_url/model/enabled);
    guidance extraction gets its own timeout since it reads a whole pasted
    document rather than a small structured feature pack."""
    settings = get_settings()
    return HttpGuidanceLLMProvider(
        api_key=settings.growth_llm_api_key,
        base_url=settings.growth_llm_base_url,
        model=settings.growth_llm_model,
        timeout_seconds=settings.guidance_llm_timeout_seconds,
        enabled=settings.growth_llm_enabled,
    )


class YearOverrides(BaseModel):
    revenue_growth: list[float | None] = Field(default_factory=list)
    capex_pct_revenue: list[float | None] = Field(default_factory=list)
    nwc_pct_revenue: list[float | None] = Field(default_factory=list)
    tax_rate: list[float | None] = Field(default_factory=list)


class Drivers(BaseModel):
    forecast_years: int = 5
    growth_method: str = "evidence"
    long_term_growth: float = 0.025
    target_ebitda_margin: float = 0.25
    risk_free_rate: float = 0.04
    risk_free_rate_source: str = ""
    beta: float = 1.15
    beta_source: str = "default"
    equity_risk_premium: float = 0.055
    pretax_cost_of_debt: float = 0.06
    pretax_cost_of_debt_rationale: str = ""
    terminal_growth: float = 0.03
    terminal_growth_ceiling: float = 0.06
    exit_multiple: float = 14.0
    size_premium: float = 0.0
    target_equity_weight: float | None = None
    preferred_stock: float = 0.0
    # Populated only by POST /{model_id}/guidance, after the quote has been
    # verified verbatim against the source text the user pasted (see
    # engine/guidance_llm.py). Never set by hand from a raw LLM response.
    company_guidance_revenue_growth: float | None = None
    company_guidance_quote: str = ""
    company_guidance_period: str = ""
    year_overrides: YearOverrides = Field(default_factory=YearOverrides)


def load_company(data: dict) -> Company:
    return Company.model_validate(data)


def load_historicals(data: dict) -> HistoricalFinancials:
    return HistoricalFinancials.model_validate(data)


def normalize_manual_historicals(raw: dict) -> dict:
    """Fill required floats for engine models without treating blanks as verified zeros.

    The client sends null + an explicit *_status of "unavailable" for lines the
    user left blank. Pydantic BalanceSheet/IncomeStatement still need a number,
    so we store 0 with the status the client sent (or unavailable if omitted).
    """
    income: list[dict] = []
    for row in raw.get("income_statements") or []:
        item = dict(row)
        for key in ("cogs", "rnd", "sm", "ga", "other_opex", "da", "interest_expense", "taxes", "other_below_ebit"):
            if item.get(key) is None:
                item[key] = 0.0
        income.append(item)

    sheets: list[dict] = []
    for row in raw.get("balance_sheets") or []:
        item = dict(row)
        if item.get("cash") is None or (item.get("cash_status") or "").lower() == "unavailable":
            item["cash"] = float(item["cash"] or 0.0) if item.get("cash") is not None else 0.0
            item["cash_status"] = "unavailable"
            item["cash_reported"] = False
        else:
            item["cash_reported"] = True
            item.setdefault("cash_status", "available")
        if item.get("long_term_debt") is None and item.get("short_term_debt") is None:
            item["long_term_debt"] = 0.0
            item["short_term_debt"] = 0.0
            item["debt_status"] = "unavailable"
        else:
            if item.get("long_term_debt") is None:
                item["long_term_debt"] = 0.0
            if item.get("short_term_debt") is None:
                item["short_term_debt"] = 0.0
            item.setdefault("debt_status", "available")
        for key in (
            "accounts_receivable",
            "accounts_payable",
            "inventory",
            "accrued_liabilities",
            "ppe",
            "lease_liabilities",
            "marketable_securities",
            "other_current_assets",
            "goodwill",
            "intangibles",
            "other_assets",
            "other_liabilities",
        ):
            if item.get(key) is None:
                item[key] = 0.0
        if (item.get("nwc_status") or "").lower() == "unavailable":
            item["operating_wc_complete"] = False
            item["nwc_status"] = "unavailable"
        elif item.get("nwc_status"):
            item["operating_wc_complete"] = item.get("nwc_status") == "available"
        sheets.append(item)

    flows: list[dict] = []
    for row in raw.get("cash_flows") or []:
        item = dict(row)
        for key in (
            "net_income",
            "da",
            "stock_based_comp",
            "other_noncash",
            "change_in_nwc",
            "capex",
            "acquisitions",
            "other_investing",
            "debt_issuance_repayment",
            "equity_issuance_repurchase",
            "dividends",
        ):
            if item.get(key) is None:
                item[key] = 0.0
        flows.append(item)
    return {"income_statements": income, "balance_sheets": sheets, "cash_flows": flows}


def ingest_ticker(ticker: str) -> tuple[Company, HistoricalFinancials, list[str], list[str]]:
    """India-listed names prefer Screener.in statements; everyone else uses Yahoo."""
    symbol = ticker.strip()
    if is_india_listed(symbol):
        try:
            result = fetch_screener_company(symbol)
            return result.company, result.historicals, result.notes, result.warnings
        except ScreenerUnsupported:
            raise
        except (ScreenerUnavailable, Exception) as exc:
            try:
                result = fetch_company(symbol)
            except Exception:
                raise ValueError(
                    f"Could not load financials for '{symbol}' from Screener.in or Yahoo Finance."
                ) from exc
            result.warnings.append(
                f"Screener.in was unavailable ({type(exc).__name__}: {exc}). "
                "Statements below are from Yahoo Finance instead."
            )
            return result.company, result.historicals, result.notes, result.warnings
    result = fetch_company(symbol)
    return result.company, result.historicals, result.notes, result.warnings


def sample_company() -> tuple[Company, HistoricalFinancials, list[str], list[str]]:
    return build_orion_company(), build_orion_historicals(), ["Fictional sample company (Orion Cloud Systems)."], []


def default_drivers(company: Company, hist: HistoricalFinancials) -> Drivers:
    summary = analyze_historicals(hist)
    latest = hist.income_statements[-1]
    rf, rf_source = resolve_risk_free_rate(company.currency, live=(company.ticker or "").upper() != "ORCS")
    profile = classify_company(company, summary)

    beta = 1.15
    beta_source = "No sourced beta available — enter a comparable-company estimate."
    country = (company.country or "").strip().lower()
    latest_bs = hist.balance_sheets[-1]
    if company.industry and country == "india":
        match = match_india_sector_beta(company.industry)
        effective_tax = min(0.40, max(0.0, latest.tax_rate if latest.pretax_income else INDIA_STATUTORY_TAX))
        tax = INDIA_STATUTORY_TAX
        mv_e = None
        if company.current_share_price and company.diluted_shares_outstanding:
            mv_e = company.current_share_price * company.diluted_shares_outstanding
        book_eq = max(abs(latest_bs.shareholders_equity), 1.0)
        book_de = latest_bs.total_debt_and_leases / book_eq
        market_de = (latest_bs.total_debt_and_leases / mv_e) if mv_e and mv_e > 0 else None
        industry_de = match.d_e_ratio
        if market_de is not None:
            de = market_de
            de_note = f"market D/E {market_de:.2f} (price × diluted shares)"
            if industry_de > 0 and market_de > 3 * industry_de:
                de = (market_de + industry_de) / 2
                de_note = (
                    f"normalized D/E {de:.2f} (midpoint of market {market_de:.2f} and industry {industry_de:.2f}); "
                    "current market leverage is more than 3× the industry ratio"
                )
            elif industry_de > 0 and market_de < 0.4 * industry_de:
                de = (market_de + industry_de) / 2
                de_note = (
                    f"normalized D/E {de:.2f} (midpoint of market {market_de:.2f} and industry {industry_de:.2f}); "
                    "current market leverage is unusually low versus the industry"
                )
        else:
            de = industry_de
            de_note = (
                f"industry D/E {industry_de:.2f} (no usable market equity; book D/E {book_de:.2f} is not used for beta)"
            )
        beta = relever_beta(match.unlevered_beta, de, tax)
        beta_source = (
            f"Damodaran India unlevered sector beta {match.unlevered_beta:.2f} ({match.matched_industry}) "
            f"relevered at {de_note}, marginal/statutory tax {tax:.1%} (Hamada). "
            f"Latest effective tax {effective_tax:.1%} is a cross-check, not the Hamada T. "
            f"Book D/E {book_de:.2f} and industry D/E {industry_de:.2f} are disclosed. "
            "Market D/E is used because WACC weights are also market-value; book D/E overstates "
            "leverage when market equity differs from book."
        )
    elif company.ticker and company.ticker.upper() != "ORCS":
        live = fetch_beta(company.ticker)
        if live is not None:
            beta = live
            beta_source = f"Yahoo Finance reported levered beta for {company.ticker}"

    erp = 0.055
    if company.country:
        try:
            risk = get_country_risk(company.country)
            erp = risk.total_equity_risk_premium
        except ValueError:
            pass

    ebit_kd, int_kd, kd_period = latest.ebit, latest.interest_expense, latest.period
    if profile.template == BusinessTemplate.CYCLICAL:
        icrs = [
            (inc.ebit, inc.interest_expense, inc.period)
            for inc in hist.income_statements[-5:]
            if inc.interest_expense > 0
        ]
        if icrs:
            ratios = [e / i for e, i, _ in icrs]
            med = sorted(ratios)[len(ratios) // 2]
            ebit_kd, int_kd, kd_period = med, 1.0, f"median last-5y ICR {med:.2f}x"

    kd_est = estimate_pretax_cost_of_debt(
        rf,
        ebit_kd,
        int_kd,
        kd_period,
        currency=company.currency,
        country=company.country,
    )
    kd = kd_est.pretax_cost_of_debt
    yoy = [y.revenue_growth for y in summary.years if y.revenue_growth is not None]
    regime = classify_growth_regime(yoy)
    tg_default, tg_ceiling, _tg_why = terminal_growth_for_company(company.currency, regime.value)
    if profile.template == BusinessTemplate.CYCLICAL:
        cyc = normalize_cyclical_margins(summary)
        hist_margin = float(cyc.normalized_ebitda_margin)
    else:
        hist_margin = float(summary.median_ebitda_margin_3y)
    target_margin = min(0.60, max(0.01, hist_margin))

    target_eq = 0.70 if company.company_type == CompanyType.PRIVATE else None
    n = 5
    return Drivers(
        forecast_years=n,
        growth_method="evidence",
        long_term_growth=tg_default,
        target_ebitda_margin=target_margin,
        risk_free_rate=rf,
        risk_free_rate_source=rf_source,
        beta=beta,
        beta_source=beta_source,
        equity_risk_premium=erp,
        pretax_cost_of_debt=kd,
        pretax_cost_of_debt_rationale=kd_est.rationale,
        terminal_growth=tg_default,
        terminal_growth_ceiling=tg_ceiling,
        exit_multiple=14.0,
        size_premium=0.0,
        target_equity_weight=target_eq,
        preferred_stock=company.preferred_stock,
        year_overrides=YearOverrides(
            revenue_growth=[None] * n,
            capex_pct_revenue=[None] * n,
            nwc_pct_revenue=[None] * n,
            tax_rate=[None] * n,
        ),
    )


def merge_drivers(base: Drivers, patch: dict[str, Any] | None) -> Drivers:
    if not patch:
        return base
    data = base.model_dump()
    yo = patch.get("year_overrides") or {}
    merged_yo = {**data["year_overrides"]}
    for key, val in yo.items():
        if val is not None:
            merged_yo[key] = val
    for key, val in patch.items():
        if key == "year_overrides" or val is None:
            continue
        data[key] = val
    data["year_overrides"] = merged_yo
    drivers = Drivers.model_validate(data)
    n = drivers.forecast_years
    for field in ("revenue_growth", "capex_pct_revenue", "nwc_pct_revenue", "tax_rate"):
        seq = list(getattr(drivers.year_overrides, field) or [])
        if len(seq) < n:
            seq = seq + [None] * (n - len(seq))
        setattr(drivers.year_overrides, field, seq[:n])
    return drivers


def _apply_year_overrides(assumptions: ForecastAssumptions, drivers: Drivers) -> ForecastAssumptions:
    out = assumptions.model_copy(deep=True)
    mapping = {
        "revenue_growth": out.revenue_growth,
        "capex_pct_revenue": out.capex_pct_revenue,
        "nwc_pct_revenue": out.nwc_pct_revenue,
        "tax_rate": out.tax_rate,
    }
    for field, series in mapping.items():
        overrides = getattr(drivers.year_overrides, field)
        for i, override in enumerate(overrides):
            if override is None or i >= len(series):
                continue
            series[i] = series[i].overridden(float(override))
    return out


def build_wacc_inputs(
    hist: HistoricalFinancials,
    summary,
    company: Company,
    drivers: Drivers,
    tax_rate: float | None = None,
) -> WaccInputs:
    latest_bs = hist.balance_sheets[-1]
    beta_source = (
        AssumptionSource.MARKET_DATA if company.company_type == CompanyType.PUBLIC else AssumptionSource.USER_ASSUMPTION
    )
    if company.company_type == CompanyType.PUBLIC and company.current_share_price and company.diluted_shares_outstanding:
        mv_equity = company.current_share_price * company.diluted_shares_outstanding
    elif drivers.target_equity_weight is not None:
        mv_equity = drivers.target_equity_weight * 1000.0
    else:
        mv_equity = max(latest_bs.shareholders_equity, 1.0)

    if drivers.target_equity_weight is not None:
        mv_debt = (1 - drivers.target_equity_weight) * 1000.0
    else:
        mv_debt = latest_bs.total_debt_and_leases

    inputs = make_wacc_inputs(
        company_type=company.company_type,
        risk_free_rate=drivers.risk_free_rate,
        beta=drivers.beta,
        beta_source=beta_source,
        beta_rationale=drivers.beta_source,
        equity_risk_premium=drivers.equity_risk_premium,
        pretax_cost_of_debt=drivers.pretax_cost_of_debt,
        tax_rate=tax_rate if tax_rate is not None else summary.avg_tax_rate,
        market_value_of_equity=mv_equity,
        market_value_of_debt=mv_debt,
        size_premium=drivers.size_premium,
        pretax_cost_of_debt_source=AssumptionSource.CALCULATED,
        pretax_cost_of_debt_rationale=drivers.pretax_cost_of_debt_rationale or None,
        risk_free_rate_rationale=drivers.risk_free_rate_source or None,
        # Rf, beta, and the market-value weights are pulled at run time, so the
        # as-of date is the run date rather than a statement period.
        source_date=date.today().isoformat(),
    )
    if (company.currency or "").upper() == "INR":
        used = tax_rate if tax_rate is not None else summary.avg_tax_rate
        inputs = inputs.model_copy(
            update={
                "tax_rate": inputs.tax_rate.model_copy(
                    update={
                        "source": AssumptionSource.CALCULATED,
                        "rationale": (
                            f"Indian statutory/marginal tax {used:.2%} for after-tax Kd. "
                            "Same rate as forecast NOPAT. Historical effective tax is a cross-check, not the WACC T."
                        ),
                    }
                )
            }
        )
    return inputs


def _audit_report(integrity, ledger: list[dict], hist) -> dict[str, Any]:
    cats = {c.id: c.score for c in integrity.categories}
    sources = sorted({
        *(row.get("source") or "" for row in ledger if row.get("source")),
        *(bs.cash_source for bs in hist.balance_sheets if getattr(bs, "cash_source", "")),
        *(bs.debt_source for bs in hist.balance_sheets if getattr(bs, "debt_source", "")),
    } - {""})
    return {
        "model_status": integrity.status,
        "quality_score": integrity.score,
        "data_quality": cats.get("data"),
        "forecast_quality": cats.get("forecast"),
        "growth_quality": cats.get("growth"),
        "wacc_quality": cats.get("wacc"),
        "terminal_value_quality": cats.get("terminal"),
        "equity_bridge_quality": cats.get("bridge"),
        "historical_coverage": integrity.historical_coverage,
        "current_bridge_coverage": integrity.current_bridge_coverage,
        "critical_blockers": list(integrity.blockers),
        "warnings": [i.message for i in integrity.issues if i.severity in ("warning", "error")],
        "assumptions": ledger,
        "sources": sources,
    }


_VERIFIED_STATUSES = {"available", "reported", "derived", "estimated"}


def _india_industry_growth(company: Company) -> float | None:
    """Damodaran India expected 5-year revenue growth, or None when unavailable.

    India-only: histgrIndia.xls is an India-listed industry dataset. Non-India
    names keep industry_growth=None so quality flags stay 'data unavailable'
    rather than matching against the wrong geography.
    """
    if not company.industry or not is_india(company.currency, company.country):
        return None
    try:
        growth_match = match_india_sector_growth(company.industry)
    except GrowthDataUnavailable:
        return None
    if growth_match.low_confidence:
        return None
    return growth_match.expected_growth


def _status_ok(status: str | None) -> bool:
    return (status or "").strip().lower() in _VERIFIED_STATUSES


def _classified_lines(latest_bs, company: Company, nci_value: float, nci_status: str) -> list[dict[str, Any]]:
    rows = classify_investment_lines(latest_bs) + classify_other_assets(latest_bs)
    rows.append(
        {
            "name": "Minority interest (NCI)",
            "amount": nci_value,
            "classification": "equity_claim",
            "operating": "non_operating",
            "included_in_ev": False,
            "added_in_equity_bridge": nci_status == "available",
            "reason": (
                "Deducted in the equity bridge when Yahoo reports minority interest."
                if nci_status == "available"
                else "NCI is unavailable. Deducted as a labeled 0, not a verified zero."
            ),
            "source": "Yahoo minority interest" if nci_status == "available" else "unavailable",
            "confidence": "High" if nci_status == "available" else "Low",
        }
    )
    rows.append(
        {
            "name": "Inventory",
            "amount": float(latest_bs.inventory or 0.0),
            "classification": "operating_wc",
            "operating": "operating",
            "included_in_ev": True,
            "added_in_equity_bridge": False,
            "reason": "Operating working capital. Already in EV via ΔNWC when the WC overlay is complete.",
            "source": (latest_bs.source_overlay or {}).get("period") or latest_bs.period,
            "confidence": "High" if latest_bs.operating_wc_complete else "Low",
        }
    )
    return [row for row in rows if row.get("amount") is not None]


def _cash_for_bridge(latest_bs) -> tuple[float | None, str]:
    status = (latest_bs.cash_status or ("available" if latest_bs.cash_reported else "unavailable")).lower()
    if latest_bs.cash_reported and _status_ok(status):
        # Short-term investments are included only when the structured overlay classified them as cash-like.
        return latest_bs.cash + latest_bs.marketable_securities, "available"
    return None, "unavailable"


def _support_tables(
    *,
    hist: HistoricalFinancials,
    company: Company,
    drivers: Drivers,
    assumptions: ForecastAssumptions,
    forecast,
    wacc_result,
    valuation,
    profile,
    evidence,
    latest_bs,
    table,
    gm_table,
    sign_flip: bool,
    cyclical: bool,
) -> dict[str, Any]:
    overlay = latest_bs.source_overlay or {}
    assets = classify_latest_assets(latest_bs, enterprise_value=valuation.enterprise_value if valuation else None)
    group = detect_group_structure(company, latest_bs, valuation)
    nci = nci_consistent_with_consolidated_fcff(company)
    nci["period"] = latest_bs.period
    nci["source"] = "Yahoo Finance Minority Interest" if company.minority_interest_reported else "unavailable"
    nci["definition"] = "Non-controlling interest on the consolidated balance sheet"
    nci["deducted"] = bool(nci["subtract_nci"])

    latest_inc = hist.income_statements[-1]
    effective_tax = latest_inc.tax_rate if latest_inc.pretax_income else None
    fcff_tax = assumptions.tax_rate[0].effective_value if assumptions.tax_rate else None
    wacc_tax = wacc_result.inputs.tax_rate.effective_value
    india = (company.currency or "").upper() == "INR" or (company.country or "").strip().lower() == "india"
    hamada_tax = INDIA_STATUTORY_TAX if india else (fcff_tax or 0.0)
    tax_policy = {
        "wacc_tax_rate": wacc_tax,
        "fcff_tax_rate": fcff_tax,
        "hamada_tax_rate": hamada_tax,
        "latest_effective_tax_rate": effective_tax,
        "purpose": {
            "fcff": "NOPAT = EBIT × (1 − statutory/marginal T). Historical effective tax is a cross-check.",
            "wacc_kd": "After-tax Kd = pretax Kd × (1 − marginal T). Same T as NOPAT for India.",
            "hamada": "βL = βU × [1 + (1 − T) × D/E] uses the marginal tax shield, not the latest effective rate.",
        },
        "source": "Indian statutory 22% + 10% surcharge + 4% cess = 25.17%" if india else "Historical effective tax",
        "as_of": latest_inc.period,
        "rationale": (
            "Hamada and FCFF both use the statutory/marginal rate for India. "
            f"Latest effective tax {effective_tax:.1%} is disclosed and is not used to relever beta."
            if india and effective_tax is not None
            else "WACC T and FCFF T share the same forecast tax assumption."
        ),
    }

    match = match_india_sector_beta(company.industry) if company.industry and (company.country or "").strip().lower() == "india" else None
    mv_e = wacc_result.inputs.market_value_of_equity.effective_value
    mv_d = wacc_result.inputs.market_value_of_debt.effective_value
    book_eq = max(abs(latest_bs.shareholders_equity), 1.0)
    book_de = latest_bs.total_debt_and_leases / book_eq
    market_de = (latest_bs.total_debt_and_leases / mv_e) if mv_e else None
    beta_alts = None
    if match:
        beta_alts = {
            "unlevered": match.unlevered_beta,
            "industry": match.matched_industry,
            "tax": hamada_tax,
            "book_de": book_de,
            "market_de": market_de,
            "industry_de": match.d_e_ratio,
            "book_beta": relever_beta(match.unlevered_beta, book_de, hamada_tax),
            "market_beta": relever_beta(match.unlevered_beta, market_de, hamada_tax) if market_de is not None else None,
            "industry_beta": relever_beta(match.unlevered_beta, match.d_e_ratio, hamada_tax),
            "chosen_beta": drivers.beta,
            "chosen_de": (drivers.beta / match.unlevered_beta - 1) / max(1 - hamada_tax, 1e-9) if match.unlevered_beta else None,
            "formula": "βL = βU × [1 + (1 − T) × D/E]",
            "why_chosen": drivers.beta_source,
        }

    icr_years = []
    for inc in hist.income_statements:
        if inc.interest_expense > 0:
            icr_years.append(
                {
                    "period": inc.period,
                    "ebit": inc.ebit,
                    "interest": inc.interest_expense,
                    "icr": inc.ebit / inc.interest_expense,
                }
            )
    icr_vals = [r["icr"] for r in icr_years[-5:]]
    icr_med = sorted(icr_vals)[len(icr_vals) // 2] if icr_vals else None
    kd_audit = {
        "rf": drivers.risk_free_rate,
        "rf_source": drivers.risk_free_rate_source,
        "icr_years": icr_years,
        "median_icr_5y": icr_med,
        "spread": drivers.pretax_cost_of_debt - drivers.risk_free_rate,
        "kd": drivers.pretax_cost_of_debt,
        "source": "Damodaran large-firm ICR → rating → default spread table (pages.stern.nyu.edu/~adamodar, fetched 2026-09-03)",
        "table": "Large firm (non-financial) ratings, interest coverage and default spread",
        "source_date": "2026-09-03",
        "country": company.country,
        "currency": company.currency,
        "rationale": drivers.pretax_cost_of_debt_rationale,
    }

    st = latest_bs.short_term_debt
    lt = latest_bs.long_term_debt
    leases = latest_bs.lease_liabilities
    yahoo_gross = None
    if overlay.get("current_debt_and_leases") is not None or overlay.get("long_term_debt_and_leases") is not None:
        yahoo_gross = float(overlay.get("current_debt_and_leases") or 0.0) + float(
            overlay.get("long_term_debt_and_leases") or 0.0
        )
    debt_recon = {
        "period": overlay.get("period") or latest_bs.period,
        "source": latest_bs.debt_source or "Yahoo Finance latest annual balance sheet",
        "current_borrowings": st,
        "long_term_borrowings": lt,
        "commercial_paper": None,
        "bonds": None,
        "bank_loans": None,
        "other_borrowings": None,
        "lease_liabilities": leases,
        "current_leases": overlay.get("current_leases"),
        "long_term_leases": overlay.get("long_term_leases"),
        "yahoo_debt_and_leases_gross": yahoo_gross,
        "total_debt_ex_leases": latest_bs.total_debt,
        "total_debt_like": latest_bs.total_debt_and_leases,
        "leases_inside_total_debt": abs(latest_bs.total_debt - latest_bs.total_debt_and_leases) < 1.0 and leases > 1,
        "leases_separate": abs((st + lt) - latest_bs.total_debt) < 1.0,
        "identity": "ST borrowings + LT borrowings = total_debt; total_debt + leases = debt-like claims",
        "note": (
            "Yahoo 'Current/Long-Term Debt and Capital Lease Obligation' includes leases. "
            "The overlay subtracts current and non-current capital leases before storing ST/LT borrowings, "
            "so leases are not subtracted twice. Instrument-level split (CP / bonds / bank loans) is not in the feed."
        ),
        "primary_statements": "unavailable",
    }

    identities = []
    capex_split = []
    nwc_forecast = []
    prior_rev = hist.income_statements[-1].revenue
    for y in forecast.years:
        da_pct = (y.da / y.revenue) if y.revenue else None
        identities.append(
            {
                "period": y.period,
                "ebitda": y.ebitda,
                "da": y.da,
                "ebit": y.ebit,
                "da_pct_revenue": da_pct,
                "identity_ok": abs(y.ebitda - y.da - y.ebit) < 1e-6,
            }
        )
        capex_split.append(
            {
                "period": y.period,
                "capex": y.capex,
                "da": y.da,
                "maintenance_inferred": min(y.capex, y.da),
                "expansion_inferred": max(y.capex - y.da, 0.0),
                "capex_pct_revenue": (y.capex / y.revenue) if y.revenue else None,
            }
        )
        d_rev = y.revenue - prior_rev
        nwc_forecast.append(
            {
                "period": y.period,
                "change_in_nwc": y.change_in_nwc,
                "change_in_revenue": d_rev,
                "delta_nwc_over_delta_rev": (y.change_in_nwc / d_rev) if abs(d_rev) > 1e-9 else None,
            }
        )
        prior_rev = y.revenue

    nwc_hist = []
    for i in range(1, min(len(hist.cash_flows), len(hist.income_statements))):
        d_rev = hist.income_statements[i].revenue - hist.income_statements[i - 1].revenue
        if abs(d_rev) > 1:
            nwc_hist.append(
                {
                    "period": hist.cash_flows[i].period,
                    "ratio": hist.cash_flows[i].change_in_nwc / d_rev,
                }
            )

    volume_price = False
    revenue_drivers = {
        "model": "NOT AVAILABLE",
        "method": "historical_normalized_growth" if cyclical else (evidence.year1_method if evidence else "historical"),
        "volume": None,
        "realized_price": None,
        "capacity": None,
        "geography": None,
        "confidence": "Low" if cyclical else "Medium",
        "note": (
            "Screener and Yahoo do not supply tonnes, realization, utilization, or capacity. "
            "Revenue is not modeled as volume × price. The path is historical normalized growth, "
            "with the last explicit year pinned to terminal g for Gordon identity — not a recovery ramp."
            if cyclical
            else "No volume × price split is used."
        ),
    }

    wacc_sens = []
    if table is not None:
        base_g = drivers.terminal_growth
        for cell in table.cells:
            if abs(cell.terminal_growth - base_g) < 1e-9:
                wacc_sens.append(
                    {
                        "wacc": cell.wacc,
                        "iv": cell.equity_value_per_share,
                        "ev": cell.enterprise_value,
                    }
                )
    margin_sens = []
    if gm_table is not None:
        for cell in gm_table.cells:
            if abs(cell.row) < 1e-9:
                margin_sens.append(
                    {
                        "ebit_margin_shift": cell.col,
                        "iv": cell.equity_value_per_share,
                        "ev": cell.enterprise_value,
                    }
                )

    wacc_audit = {
        "rf": drivers.risk_free_rate,
        "rf_source": drivers.risk_free_rate_source,
        "erp": drivers.equity_risk_premium,
        "unlevered_beta": match.unlevered_beta if match else None,
        "d_e": beta_alts["chosen_de"] if beta_alts else (mv_d / mv_e if mv_e else None),
        "tax": hamada_tax,
        "relevered_beta": drivers.beta,
        "ke": wacc_result.cost_of_equity,
        "pretax_kd": drivers.pretax_cost_of_debt,
        "after_tax_kd": wacc_result.after_tax_cost_of_debt,
        "market_equity": mv_e,
        "debt_for_weights": mv_d,
        "lease_treatment": "Leases are inside WACC debt weights (total_debt_and_leases) and subtracted separately in the equity bridge. They are not inside total_debt.",
        "e_weight": wacc_result.equity_weight,
        "d_weight": wacc_result.debt_weight,
        "wacc": wacc_result.wacc,
        "sensitivity": wacc_sens,
        "margin_sensitivity": margin_sens,
        "beta_alternatives": beta_alts,
    }

    extra_limitations: list[str] = []
    extra_limitations.append(
        "Audited annual-report PDF extraction is not implemented. Classification uses Screener plus the latest Yahoo balance sheet."
    )
    if assets.material_unclassified:
        extra_limitations.append(
            f"Unclassified residual assets {assets.residual_unknown:,.0f} remain after mapped lines and are not auto-added."
        )
    if cyclical:
        extra_limitations.append(
            "Volume × realised-price drivers are unavailable; revenue uses historical normalized growth."
        )
    if group.get("sotp_review_required"):
        extra_limitations.append(str(group.get("note")))
    elif group.get("complex_group_structure"):
        extra_limitations.append("COMPLEX GROUP STRUCTURE — standard consolidated FCFF may be incomplete.")

    if assets.material_unclassified or group.get("sotp_review_required"):
        force_status = "REVIEW_REQUIRED"
    else:
        force_status = "ACCEPTABLE_WITH_LIMITATIONS"

    return {
        "asset_classification": assets.model_dump(),
        "group_structure": group,
        "nci_policy": nci,
        "tax_policy": tax_policy,
        "wacc_audit": wacc_audit,
        "kd_audit": kd_audit,
        "debt_reconciliation": debt_recon,
        "forecast_identities": identities,
        "capex_inference": {
            "years": capex_split,
            "note": "Maintenance vs expansion is inferred as min(capex, D&A) vs excess. Project lists are not in the statement feed.",
        },
        "nwc_audit": {
            "method": assumptions.nwc_method,
            "historical_ratios": nwc_hist,
            "median": assumptions.nwc_delta_pct_of_delta_revenue,
            "selected": assumptions.nwc_pct_revenue[0].effective_value if assumptions.nwc_pct_revenue else None,
            "forecast": nwc_forecast,
        },
        "revenue_driver_model": revenue_drivers,
        "volume_price_available": volume_price,
        "extra_limitations": extra_limitations,
        "force_status": force_status,
        "terminal_split": (
            {
                "pv_explicit_fcff": valuation.pv_of_explicit_fcf,
                "pv_terminal_value": valuation.pv_of_terminal_value,
                "tv_pct_of_ev": valuation.terminal_value_pct_of_ev,
            }
            if valuation
            else None
        ),
    }


def _source_type(source: str) -> str:
    """Coarse provenance class so the ledger can be filtered by evidence type."""
    s = (source or "").lower()
    if not s or s in {"unavailable", "unknown"}:
        return "unavailable"
    if "calculated" in s or "derived" in s:
        return "derived"
    if "user" in s or "override" in s:
        return "user"
    if "guidance" in s or "management" in s:
        return "company_guidance"
    if "damodaran" in s or "sector" in s or "industry" in s:
        return "external_dataset"
    if "yahoo" in s or "screener" in s or "market" in s or "available" in s:
        return "market_data"
    if "historical" in s or "statistical" in s:
        return "historical"
    return "other"


def _assumption_ledger(
    assumptions: ForecastAssumptions,
    drivers: Drivers,
    wacc_result,
    evidence,
    profile,
    tg_rationale: str,
    *,
    latest_bs=None,
    company: Company | None = None,
    cash_status: str = "",
    cash_value: float | None = None,
    debt_status: str = "",
    shares_status: str = "",
) -> list[dict]:
    year1 = assumptions.revenue_growth[0] if assumptions.revenue_growth else None
    last = assumptions.revenue_growth[-1] if assumptions.revenue_growth else None
    ebitda_target = drivers.target_ebitda_margin
    tax = assumptions.tax_rate[0] if assumptions.tax_rate else None
    capex = assumptions.capex_pct_revenue[-1] if assumptions.capex_pct_revenue else None
    nwc = assumptions.nwc_pct_revenue[0] if assumptions.nwc_pct_revenue else None
    rows = []

    def row(name, value, unit, src, as_of, method, conf, rationale, *, historical_support=None, override=None):
        rows.append({
            "assumption": name,
            "name": name,
            "value": value,
            "unit": unit,
            "source": src,
            "source_type": _source_type(src),
            "as_of": as_of or "",
            "as_of_date": as_of or "",
            "method": method,
            "confidence": conf,
            "rationale": rationale,
            "historical_support": historical_support,
            "user_override": override,
            "display": "unavailable" if value is None else value,
        })

    if year1:
        hist_support = None
        if evidence:
            hist_support = {
                "last_1y": evidence.last_1y,
                "cagr_3y": evidence.cagr_3y,
                "cagr_5y": evidence.cagr_5y,
                "median_annual": evidence.median_annual,
                "implied_fundamental_g": evidence.implied_fundamental_g,
            }
        row("Revenue Growth Y1", year1.effective_value, "%", year1.source.value, year1.source_date or "",
            assumptions.year1_method, year1.confidence.value, year1.rationale,
            historical_support=hist_support, override=year1.user_override)
    if last:
        row("Revenue Growth Y5", last.effective_value, "%", last.source.value, last.source_date or "",
            "fade_to_terminal", last.confidence.value, last.rationale)
    cyclical = bool(profile and profile.template.value == "cyclical")
    row(
        "EBIT / EBITDA target margin",
        ebitda_target,
        "%",
        AssumptionSource.CALCULATED.value,
        "",
        "mid_cycle_median" if cyclical else "last_3y_median",
        "Medium",
        (
            "Base-case target is the mid-cycle EBITDA margin (winsorized / 5y / 7y median), not the latest year and not the peak."
            if cyclical
            else "Base-case target is the last-3-year median EBITDA margin, not the historical peak."
        ),
    )
    if tax:
        row("Tax Rate", tax.effective_value, "%", tax.source.value, tax.source_date or "",
            "india_statutory" if (tax.rationale or "").startswith("Indian") else "historical_effective",
            tax.confidence.value, tax.rationale)
    if capex:
        row("Capex % Revenue (terminal year)", capex.effective_value, "% of revenue", capex.source.value,
            capex.source_date or "", profile.capex_policy if profile else "capex", capex.confidence.value, capex.rationale,
            override=capex.user_override)
    if nwc:
        row("NWC intensity", nwc.effective_value, nwc.unit, nwc.source.value, nwc.source_date or "",
            assumptions.nwc_method, nwc.confidence.value, nwc.rationale, override=nwc.user_override)
    row("WACC", wacc_result.wacc, "%", AssumptionSource.CALCULATED.value, "",
        "CAPM + after-tax cost of debt", "Medium",
        f"Ke {wacc_result.cost_of_equity:.2%}; after-tax Kd {wacc_result.after_tax_cost_of_debt:.2%}; "
        f"E {wacc_result.equity_weight:.1%} / D {wacc_result.debt_weight:.1%}.")
    rf = wacc_result.inputs.risk_free_rate
    row("Risk-free rate", rf.effective_value, "%", rf.source.value, rf.source_date or "", "market", rf.confidence.value, rf.rationale)
    beta = wacc_result.inputs.beta
    row("Beta", beta.effective_value, "x", beta.source.value, beta.source_date or "", "market_or_sector", beta.confidence.value, beta.rationale)
    erp = wacc_result.inputs.equity_risk_premium
    row("Equity risk premium", erp.effective_value, "%", erp.source.value, erp.source_date or "", "damodaran_or_fallback", erp.confidence.value, erp.rationale)
    row("Terminal Growth", drivers.terminal_growth, "%", AssumptionSource.CALCULATED.value, "",
        "nominal_gdp_proxy", "Medium", tg_rationale)
    if evidence:
        row(
            "Growth regime",
            None,
            evidence.regime.value.replace("_", " "),
            AssumptionSource.CALCULATED.value,
            "",
            "quantitative",
            "Medium",
            f"Classified from historical YoY series as {evidence.regime.value.replace('_', ' ')}. Not an LLM judgment.",
        )
    period = latest_bs.period if latest_bs else ""
    row(
        "Cash & cash-like",
        cash_value,
        "currency",
        (latest_bs.cash_source if latest_bs else "") or cash_status,
        period,
        cash_status,
        "High" if cash_status == "available" else "Low",
        "Verified cash is added in the equity bridge. Unavailable cash is not treated as zero. Long-term investments are not treated as cash.",
    )
    if latest_bs:
        row(
            "Non-operating investments",
            latest_bs.non_operating_investments if _status_ok(latest_bs.non_operating_investments_status) else None,
            "currency",
            latest_bs.non_operating_investments_source or latest_bs.non_operating_investments_status,
            period,
            latest_bs.non_operating_investments_status,
            "Medium" if _status_ok(latest_bs.non_operating_investments_status) else "Low",
            "Classified long-term / strategic investments are added as non-operating assets. Generic Screener Investments is not treated as cash.",
        )
    if latest_bs:
        row(
            "Total debt",
            latest_bs.total_debt if _status_ok(debt_status) else None,
            "currency",
            latest_bs.debt_source or debt_status,
            period,
            debt_status,
            "High" if _status_ok(debt_status) else "Low",
            "Unavailable debt is not treated as zero.",
        )
    if company:
        row(
            "Minority interest",
            company.minority_interest if company.minority_interest_reported else None,
            "currency",
            "Yahoo Finance" if company.minority_interest_reported else "unavailable",
            period,
            "available" if company.minority_interest_reported else "unavailable",
            "High" if company.minority_interest_reported else "Low",
            "NCI is excluded from equity. Missing NCI is flagged; it is not silently assumed to be zero.",
        )
        row(
            "Diluted shares",
            company.diluted_shares_outstanding,
            "millions",
            company.shares_source or shares_status,
            period,
            shares_status,
            "High" if _status_ok(shares_status) else "Low",
            "Per-share value is blocked until diluted shares are verified.",
        )
    return rows


def _reliability_section(
    *,
    company: Company,
    hist: HistoricalFinancials,
    summary,
    profile,
    forecast,
    assumptions,
    evidence,
    wacc_result,
    valuation,
    drivers: Drivers,
    ctx,
    cash_value,
    sotp_required: bool = False,
    complex_group: bool = False,
    bridge_blocked: bool = False,
    bridge_block_reason: str | None = None,
    identity_failure: bool = False,
    negative_class: str | None = None,
) -> dict[str, Any]:
    beta_source = drivers.beta_source or "default"
    return build_reliability(
        company=company,
        hist=hist,
        summary=summary,
        profile=profile,
        forecast=forecast,
        assumptions=assumptions,
        evidence=evidence,
        wacc_result=wacc_result,
        valuation=valuation,
        terminal_growth=drivers.terminal_growth,
        ctx=ctx,
        cash_value=cash_value,
        rf_source=drivers.risk_free_rate_source or "Local 10-year government bond yield",
        erp_source="Damodaran mature-market ERP plus country risk premium",
        kd_source=drivers.pretax_cost_of_debt_rationale
        or "Local risk-free rate plus a synthetic-rating default spread",
        beta_source=beta_source,
        beta_method=(
            "Unlevered sector beta relevered once with Hamada at the company D/E"
            if "sector" in beta_source.lower() or "industry" in beta_source.lower()
            else "Beta used as provided; no second relevering is applied"
        ),
        source_date=wacc_result.inputs.risk_free_rate.source_date or "",
        sotp_required=sotp_required,
        complex_group=complex_group,
        bridge_blocked=bridge_blocked,
        bridge_block_reason=bridge_block_reason,
        identity_failure=identity_failure,
        negative_class=negative_class,
    )


def run_model(
    company: Company,
    hist: HistoricalFinancials,
    drivers: Drivers,
    provider=None,
) -> dict[str, Any]:
    working = company.model_copy(update={"preferred_stock": drivers.preferred_stock})
    summary = analyze_historicals(hist)
    profile = classify_company(working, summary)
    fade_to = drivers.terminal_growth
    drivers = drivers.model_copy(update={"long_term_growth": fade_to})
    yoy = [y.revenue_growth for y in summary.years if y.revenue_growth is not None]
    regime = classify_growth_regime(yoy)
    _g, _ceil, tg_rationale = terminal_growth_for_company(working.currency, regime.value)

    pack = extract_growth_features(
        working,
        hist,
        summary,
        forecast_years=drivers.forecast_years,
        long_term_growth_rate=fade_to,
        terminal_growth_ceiling=drivers.terminal_growth_ceiling,
    )
    user_y1 = None
    if drivers.year_overrides.revenue_growth:
        user_y1 = drivers.year_overrides.revenue_growth[0]
    evidence = build_growth_evidence(
        summary,
        forecast_years=drivers.forecast_years,
        terminal_growth=fade_to,
        implied_fundamental_g=pack.implied_fundamental_g,
        roic=pack.roic,
        reinvestment_rate=pack.reinvestment_rate,
        user_year1=user_y1,
        guidance=drivers.company_guidance_revenue_growth,
    )
    methodology = "historical" if (drivers.growth_method or "").lower() == "historical" else "evidence"
    base = build_default_assumptions(
        hist,
        summary,
        forecast_years=drivers.forecast_years,
        long_term_growth_rate=fade_to,
        target_ebitda_margin=drivers.target_ebitda_margin,
        terminal_growth=fade_to,
        company=working,
        methodology=methodology,
        growth_evidence=evidence,
        profile=profile,
    )
    intelligence = apply_growth_intelligence(
        base,
        working,
        hist,
        summary,
        growth_method=drivers.growth_method,
        long_term_growth_rate=fade_to,
        terminal_growth_ceiling=drivers.terminal_growth_ceiling,
        provider=provider if provider is not None else get_growth_provider(),
    )
    assumptions = _apply_year_overrides(intelligence.assumptions, drivers)
    # Keep last explicit year on terminal g unless the user overrode that year.
    last_idx = len(assumptions.revenue_growth) - 1
    last_overridden = False
    if last_idx >= 0 and last_idx < len(drivers.year_overrides.revenue_growth):
        last_overridden = drivers.year_overrides.revenue_growth[last_idx] is not None
    if assumptions.revenue_growth and not last_overridden:
        from backend.engine.assumption_utils import pin_last_growth

        pin_last_growth(
            assumptions.revenue_growth,
            fade_to,
            f"Last explicit year set to terminal growth {fade_to:.1%} so Gordon g matches the path.",
        )
    forecast = project_financials(hist, assumptions)
    wacc_inputs = build_wacc_inputs(
        hist, summary, working, drivers,
        tax_rate=assumptions.tax_rate[0].effective_value if assumptions.tax_rate else summary.avg_tax_rate,
    )
    wacc_result = calculate_wacc(wacc_inputs)
    latest_bs = hist.balance_sheets[-1]
    cash_value, cash_status = _cash_for_bridge(latest_bs)
    debt_status = latest_bs.debt_status or "available"
    shares_status = working.shares_status or ("available" if working.diluted_shares_outstanding else "unavailable")
    shares_ok = bool(working.diluted_shares_outstanding) and _status_ok(shares_status)
    nci_status = "available" if working.minority_interest_reported else "unavailable"
    nci_value = working.minority_interest if working.minority_interest_reported else 0.0
    working = working.model_copy(update={"minority_interest": nci_value})
    missing_bridge: list[str] = []
    if cash_status == "unavailable" or cash_value is None:
        missing_bridge.append("cash")
    if not _status_ok(debt_status):
        missing_bridge.append("debt")
    if not shares_ok:
        missing_bridge.append("diluted shares")
    if not working.minority_interest_reported:
        missing_bridge.append("minority interest (NCI)")
    _HARD_BRIDGE = frozenset({"debt", "diluted shares"})
    _SOFT_BRIDGE = frozenset({"cash", "minority interest (NCI)"})
    hard_missing = [f for f in missing_bridge if f in _HARD_BRIDGE]
    soft_missing = [f for f in missing_bridge if f in _SOFT_BRIDGE]
    bridge_complete = not hard_missing
    block_reason = None
    bridge_substitutes: list[str] = []
    if hard_missing:
        block_reason = (
            "Equity bridge incomplete — intrinsic value per share is not reliable until required "
            f"balance-sheet/share-count data is verified ({', '.join(missing_bridge)}). "
            "Missing values are not treated as zero."
        )
    elif soft_missing:
        if "cash" in soft_missing:
            bridge_substitutes.append(
                "Cash is unavailable from the latest overlay. Per-share IV excludes cash "
                "(labeled substitute of 0, not a verified cash balance)."
            )
        if "minority interest (NCI)" in soft_missing:
            bridge_substitutes.append(
                "Minority interest (NCI) is unavailable. Per-share IV deducts 0 for NCI "
                "(labeled substitute, not a verified zero)."
            )
    # Numeric placeholder only for the EV math path; per-share IV is withheld when incomplete.
    cash_and_investments = 0.0 if cash_value is None else cash_value
    noi = 0.0
    noi_status = latest_bs.non_operating_investments_status or "unavailable"
    if _status_ok(noi_status):
        noi = latest_bs.non_operating_investments
    india = is_india(working.currency, working.country)
    display = {
        "currency": working.currency,
        "country": working.country,
        "is_india": india,
        "scale_label": "₹ Crore" if india else f"{working.currency} Millions",
        "scale_divisor": 10.0 if india else 1.0,
    }
    base_rev = hist.income_statements[-1].revenue
    last_rev = forecast.years[-1].revenue if forecast.years else base_rev
    n_years = len(forecast.years) or 1
    forecast_cagr = (last_rev / base_rev) ** (1 / n_years) - 1 if base_rev > 0 and last_rev > 0 else None
    compounding = {
        "base_revenue": base_rev,
        "year_revenues": [y.revenue for y in forecast.years],
        "year_growth": [y.revenue_growth for y in forecast.years],
        "forecast_cagr": forecast_cagr,
        "revenue_multiple": (last_rev / base_rev) if base_rev else None,
        "historical_cagr": summary.revenue_cagr_5y or summary.revenue_cagr_3y,
    }

    payload: dict[str, Any] = {
        "company": working.model_dump(),
        "historicals": hist.model_dump(),
        "summary": summary.model_dump(),
        "drivers": drivers.model_dump(),
        "assumptions": assumptions.model_dump(),
        "forecast": forecast.model_dump(),
        "wacc": wacc_result.model_dump(),
        "display": display,
        "valuation": None,
        "valuation_error": None,
        "scenarios": None,
        "sensitivity": None,
        "sensitivity_growth_margin": None,
        "sensitivity_growth_wacc": None,
        "sensitivity_growth_capex": None,
        "driver_ranking": None,
        "integrity": None,
        "growth_intelligence": intelligence.trace.model_dump(),
        "growth_evidence": evidence.model_dump(),
        "company_profile": profile.model_dump(),
        "assumption_ledger": _assumption_ledger(
            assumptions, drivers, wacc_result, evidence, profile, tg_rationale,
            latest_bs=latest_bs, company=working, cash_status=cash_status,
            cash_value=cash_value, debt_status=debt_status, shares_status=shares_status,
        ),
        "compounding": compounding,
        "quality_flags": [],
        "audit_report": None,
        "cyclical_normalization": None,
        "negative_equity_diagnostic": None,
        "reliability": None,
        "equity_presentation": None,
        "high_valuation_sensitivity": False,
        "bridge_substitutes": bridge_substitutes,
        "classified_lines": _classified_lines(latest_bs, working, nci_value, nci_status),
    }
    if profile.template == BusinessTemplate.CYCLICAL:
        payload["cyclical_normalization"] = normalize_cyclical_margins(summary).model_dump()

    if not profile.fcff_appropriate:
        payload["valuation_error"] = profile.fcff_block_reason
        payload["quality_flags"] = [
            {
                "code": "fcff_inappropriate",
                "level": "unrealistic",
                "category": "industry",
                "message": profile.fcff_block_reason or "Standard FCFF DCF is not appropriate.",
            }
        ]
        diag = run_negative_iv_diagnostics(
            working, hist, forecast, None, wacc_result,
            fcff_appropriate=False,
            fcff_block_reason=profile.fcff_block_reason,
            profile_template=profile.template.value,
            terminal_growth=drivers.terminal_growth,
        )
        payload["negative_iv_diagnostics"] = diag
        payload["model_health"] = diag["model_health"]
        payload["reliability"] = _reliability_section(
            company=working, hist=hist, summary=summary, profile=profile, forecast=forecast,
            assumptions=assumptions, evidence=evidence, wacc_result=wacc_result, valuation=None,
            drivers=drivers, ctx=None, cash_value=cash_value,
            bridge_blocked=True, bridge_block_reason=profile.fcff_block_reason,
            negative_class="METHODOLOGY_BLOCKED",
        )
        payload["equity_presentation"] = {
            "kind": "blocked",
            "label": "BLOCKED",
            "status": "METHODOLOGY_BLOCKED",
            "reason": profile.fcff_block_reason,
        }
        return payload

    if wacc_result.wacc <= drivers.terminal_growth:
        payload["valuation_error"] = (
            f"WACC ({wacc_result.wacc:.1%}) must exceed terminal growth ({drivers.terminal_growth:.1%}). "
            "Gordon terminal value is not calculated for this assumption set."
        )
        payload["quality_flags"] = [
            f.model_dump()
            for f in build_quality_flags(
                summary=summary, forecast=forecast, evidence=evidence,
                wacc_result=wacc_result, valuation=None, market_price=working.current_share_price,
                industry_growth=_india_industry_growth(working),
            )
        ]
        diag = run_negative_iv_diagnostics(
            working, hist, forecast, None, wacc_result,
            fcff_appropriate=True,
            profile_template=profile.template.value,
            terminal_growth=drivers.terminal_growth,
        )
        payload["negative_iv_diagnostics"] = diag
        payload["model_health"] = diag["model_health"]
        payload["reliability"] = _reliability_section(
            company=working, hist=hist, summary=summary, profile=profile, forecast=forecast,
            assumptions=assumptions, evidence=evidence, wacc_result=wacc_result, valuation=None,
            drivers=drivers, ctx=None, cash_value=cash_value,
            bridge_blocked=True, bridge_block_reason=payload["valuation_error"],
            negative_class="METHODOLOGY_BLOCKED",
        )
        payload["equity_presentation"] = {
            "kind": "blocked",
            "label": "BLOCKED",
            "status": "METHODOLOGY_BLOCKED",
            "reason": payload["valuation_error"],
        }
        return payload

    terminal_fcff = forecast.years[-1].fcff if forecast.years else 0.0
    if terminal_fcff <= 0:
        payload["valuation_error"] = (
            f"Gordon Growth cannot value a business whose terminal-year FCFF is still negative "
            f"({terminal_fcff:,.1f}). Extend the forecast horizon until FCFF is durably positive, "
            "or use exit-multiple terminal value instead."
        )
        payload["quality_flags"] = [
            f.model_dump()
            for f in build_quality_flags(
                summary=summary, forecast=forecast, evidence=evidence,
                wacc_result=wacc_result, valuation=None, market_price=working.current_share_price,
                industry_growth=_india_industry_growth(working),
            )
        ]
        diag = run_negative_iv_diagnostics(
            working, hist, forecast, None, wacc_result,
            fcff_appropriate=True,
            profile_template=profile.template.value,
            terminal_growth=drivers.terminal_growth,
        )
        payload["negative_iv_diagnostics"] = diag
        payload["model_health"] = diag["model_health"]
        payload["reliability"] = _reliability_section(
            company=working, hist=hist, summary=summary, profile=profile, forecast=forecast,
            assumptions=assumptions, evidence=evidence, wacc_result=wacc_result, valuation=None,
            drivers=drivers, ctx=None, cash_value=cash_value,
            bridge_blocked=True, bridge_block_reason=payload["valuation_error"],
            negative_class="METHODOLOGY_BLOCKED",
        )
        payload["equity_presentation"] = {
            "kind": "blocked",
            "label": "BLOCKED",
            "status": "METHODOLOGY_BLOCKED",
            "reason": payload["valuation_error"],
        }
        return payload

    valuation = run_dcf_valuation(
        forecast=forecast,
        wacc_result=wacc_result,
        terminal_growth=drivers.terminal_growth,
        company=working,
        cash_and_investments=cash_and_investments,
        total_debt=latest_bs.total_debt if _status_ok(debt_status) else 0.0,
        lease_liabilities=latest_bs.lease_liabilities,
        exit_multiple=drivers.exit_multiple,
        cash_status=cash_status,
        minority_interest_status=nci_status,
        debt_status=debt_status,
        shares_status=shares_status,
        bridge_complete=bridge_complete,
        block_reason=block_reason,
        non_operating_investments=noi,
    )
    ctx = ValuationContext(
        cash_and_investments=cash_and_investments,
        total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
        exit_multiple=drivers.exit_multiple,
        non_operating_investments=noi,
    )
    scenarios = run_all_scenarios(
        hist=hist,
        summary=summary,
        company=working,
        base_assumptions=assumptions,
        base_wacc_inputs=wacc_inputs,
        base_terminal_growth=drivers.terminal_growth,
        cash_and_investments=cash_and_investments,
        total_debt=latest_bs.total_debt,
        lease_liabilities=latest_bs.lease_liabilities,
        exit_multiple=drivers.exit_multiple,
        profile=profile,
        evidence=evidence,
        cash_status=cash_status,
        minority_interest_status=nci_status,
        debt_status=debt_status,
        shares_status=shares_status,
        block_reason=block_reason,
        bridge_complete=bridge_complete,
        non_operating_investments=noi,
    )
    wacc_range = [wacc_result.wacc + d for d in (-0.02, -0.01, 0.0, 0.01, 0.02)]
    growth_range = [drivers.terminal_growth + d for d in (-0.01, -0.005, 0.0, 0.005, 0.01)]
    table = wacc_vs_growth_table(hist, assumptions, wacc_result, working, ctx, wacc_range, growth_range)
    g_shifts = [-0.04, -0.02, 0.0, 0.02, 0.04]
    m_shifts = [-0.03, -0.015, 0.0, 0.015, 0.03]
    gm_table = growth_vs_margin_table(
        hist, assumptions, wacc_result, drivers.terminal_growth, working, ctx, g_shifts, m_shifts
    )
    gw_table = growth_vs_wacc_table(
        hist, assumptions, wacc_result, drivers.terminal_growth, working, ctx, g_shifts, wacc_range
    )
    gc_table = growth_vs_capex_table(
        hist, assumptions, wacc_result, drivers.terminal_growth, working, ctx,
        g_shifts, [-0.02, -0.01, 0.0, 0.01, 0.02],
    )
    ranking = rank_valuation_drivers(hist, assumptions, wacc_result, drivers.terminal_growth, working, ctx)
    ivs = [
        getattr(cell, "equity_value_per_share", None)
        for cell in list(table.cells) + list(gm_table.cells)
    ]
    sign_flip = any(v is not None and v > 0 for v in ivs) and any(v is not None and v < 0 for v in ivs)
    payload["high_valuation_sensitivity"] = sign_flip
    cyclical = profile.template.value == "cyclical"
    support = _support_tables(
        hist=hist,
        company=working,
        drivers=drivers,
        assumptions=assumptions,
        forecast=forecast,
        wacc_result=wacc_result,
        valuation=valuation,
        profile=profile,
        evidence=evidence,
        latest_bs=latest_bs,
        table=table,
        gm_table=gm_table,
        sign_flip=sign_flip,
        cyclical=cyclical,
    )
    if bridge_substitutes:
        support["extra_limitations"].extend(bridge_substitutes)
    integrity = run_validation(
        hist,
        summary,
        forecast,
        wacc_result,
        valuation,
        terminal_growth_ceiling=drivers.terminal_growth_ceiling,
        evidence=evidence,
        cash_status=cash_status,
        minority_status=nci_status,
        shares_ok=shares_ok,
        force_status=support["force_status"],
        extra_limitations=support["extra_limitations"],
        cash_substituted="cash" in soft_missing and not hard_missing,
    )
    if not bridge_complete:
        integrity.intrinsic_value_reliable = False
        if integrity.status != "BLOCKED":
            integrity.status = "BLOCKED"
        if block_reason and block_reason not in integrity.blockers:
            integrity.blockers.append(block_reason)
    flags = build_quality_flags(
        summary=summary,
        forecast=forecast,
        evidence=evidence,
        wacc_result=wacc_result,
        valuation=valuation,
        market_price=working.current_share_price,
        industry_growth=_india_industry_growth(working),
    )
    cyc = payload.get("cyclical_normalization") or {}
    confidence = assess_valuation_confidence(
        integrity_status=integrity.status,
        residual_unknown=float(support["asset_classification"].get("residual_unknown") or 0.0),
        enterprise_value=valuation.enterprise_value,
        volume_price_available=False,
        cycle_confidence=str(cyc.get("confidence") or "Low"),
        tv_pct=valuation.terminal_value_pct_of_ev,
        high_sensitivity=sign_flip,
        primary_statements=False,
        complex_group=bool(support["group_structure"].get("complex_group_structure")),
        cyclical=cyclical,
    )
    if confidence.get("status_cap") and integrity.status != "BLOCKED":
        rank = {"BLOCKED": 3, "REVIEW_REQUIRED": 2, "ACCEPTABLE_WITH_LIMITATIONS": 1, "VERIFIED": 0}
        if rank.get(confidence["status_cap"], 0) > rank.get(integrity.status, 0):
            integrity.status = confidence["status_cap"]

    payload["valuation"] = valuation.model_dump()
    payload["scenarios"] = {name: sc.model_dump() for name, sc in scenarios.items()}
    payload["sensitivity"] = table.model_dump()
    payload["sensitivity_growth_margin"] = gm_table.model_dump()
    payload["sensitivity_growth_wacc"] = gw_table.model_dump()
    payload["sensitivity_growth_capex"] = gc_table.model_dump()
    payload["driver_ranking"] = [d.model_dump() for d in ranking]
    payload["integrity"] = {**integrity.model_dump(), "band": integrity.band}
    payload["quality_flags"] = [f.model_dump() for f in flags]
    for note in bridge_substitutes:
        code = "cash_substitute" if note.lower().startswith("cash") else "nci_substitute"
        payload["quality_flags"].append(
            {
                "code": code,
                "level": "review",
                "category": "bridge",
                "message": note,
            }
        )
    if sign_flip:
        payload["quality_flags"].append(
            {
                "code": "high_valuation_sensitivity",
                "level": "review",
                "category": "valuation",
                "message": "HIGH VALUATION SENSITIVITY: nearby WACC or margin cells change the sign of residual equity.",
            }
        )
    if support["asset_classification"].get("material_unclassified"):
        payload["quality_flags"].append(
            {
                "code": "unclassified_assets",
                "level": "review",
                "category": "bridge",
                "message": (
                    "Unclassified residual assets remain after mapped Yahoo lines and are not auto-added. "
                    "Primary statements would be required to allocate this bucket."
                ),
            }
        )
    if support["group_structure"].get("sotp_review_required"):
        payload["quality_flags"].append(
            {
                "code": "sotp_review_required",
                "level": "review",
                "category": "bridge",
                "message": support["group_structure"]["note"],
            }
        )
    payload["asset_classification"] = support["asset_classification"]
    payload["group_structure"] = support["group_structure"]
    payload["nci_policy"] = support["nci_policy"]
    payload["tax_policy"] = support["tax_policy"]
    payload["wacc_audit"] = support["wacc_audit"]
    payload["kd_audit"] = support["kd_audit"]
    payload["debt_reconciliation"] = support["debt_reconciliation"]
    payload["forecast_identities"] = support["forecast_identities"]
    payload["capex_inference"] = support["capex_inference"]
    payload["nwc_audit"] = support["nwc_audit"]
    payload["revenue_driver_model"] = support["revenue_driver_model"]
    payload["valuation_confidence"] = confidence
    payload["terminal_split"] = support["terminal_split"]
    payload["audit_report"] = _audit_report(integrity, payload["assumption_ledger"], hist)
    bridge = valuation.equity_bridge
    diag = run_negative_iv_diagnostics(
        working,
        hist,
        forecast,
        valuation,
        wacc_result,
        fcff_appropriate=profile.fcff_appropriate,
        fcff_block_reason=profile.fcff_block_reason,
        profile_template=profile.template.value,
        terminal_growth=drivers.terminal_growth,
    )
    diag["high_valuation_sensitivity"] = sign_flip
    if sign_flip:
        diag["secondary_causes"].append(
            "HIGH VALUATION SENSITIVITY: nearby WACC or margin cells change the sign of residual equity."
        )
        diag["causes"].append(
            "HIGH VALUATION SENSITIVITY: nearby WACC or margin cells produce a positive residual, so the sign is assumption-sensitive."
        )
    payload["negative_iv_diagnostics"] = diag
    payload["model_health"] = diag["model_health"]
    if bridge.equity_value < 0:
        payload["negative_equity_diagnostic"] = diag
    health = diag["model_health"]
    identity_blocked = bool((diag.get("identities") or {}).get("blocked"))
    payload["reliability"] = _reliability_section(
        company=working, hist=hist, summary=summary, profile=profile, forecast=forecast,
        assumptions=assumptions, evidence=evidence, wacc_result=wacc_result, valuation=valuation,
        drivers=drivers, ctx=ctx, cash_value=cash_value,
        sotp_required=bool(support["group_structure"].get("sotp_review_required")),
        complex_group=bool(support["group_structure"].get("complex_group_structure")),
        bridge_blocked=not bridge_complete,
        bridge_block_reason=block_reason,
        identity_failure=identity_blocked,
        negative_class=diag.get("result_class"),
    )
    if identity_blocked or not health.get("passed"):
        integrity.intrinsic_value_reliable = False
        if integrity.status != "BLOCKED":
            integrity.status = "BLOCKED"
        reason = health.get("block_reason") or (diag.get("identities") or {}).get("block_reason")
        if reason and reason not in integrity.blockers:
            integrity.blockers.append(reason)
        payload["integrity"] = {**integrity.model_dump(), "band": integrity.band}
        payload["equity_presentation"] = {
            "kind": "blocked",
            "label": "BLOCKED",
            "status": diag.get("result_class") or "BLOCKED",
            "reason": reason or "Model health failed. A precise intrinsic value is not shown.",
        }
    elif not bridge.bridge_complete:
        payload["equity_presentation"] = {
            "kind": "blocked",
            "label": "BLOCKED",
            "status": "DATA_INCOMPLETE",
            "reason": bridge.block_reason or "Equity bridge requires review.",
        }
    elif support["group_structure"].get("sotp_review_required"):
        payload["equity_presentation"] = {
            "kind": "sotp",
            "label": "SOTP REVIEW",
            "status": "SOTP REVIEW REQUIRED",
            "reason": support["group_structure"]["note"],
            "per_share": bridge.equity_value_per_share,
        }
    elif bridge.equity_value < 0:
        klass = diag.get("result_class") or "FORECAST_UNCERTAIN"
        if klass in {"MODEL_ERROR", "DATA_INCOMPLETE", "METHODOLOGY_BLOCKED"}:
            payload["equity_presentation"] = {
                "kind": "blocked",
                "label": "BLOCKED",
                "status": klass,
                "reason": diag.get("primary_cause") or "Intrinsic value is blocked.",
            }
        else:
            payload["equity_presentation"] = {
                "kind": "negative",
                "label": klass.replace("_", " "),
                "status": klass,
                "reason": diag.get("primary_cause") or "Enterprise value is below net debt and other claims.",
                "per_share": bridge.equity_value_per_share,
            }
    else:
        payload["equity_presentation"] = {
            "kind": "positive",
            "label": None,
            "status": "Positive residual equity",
            "per_share": bridge.equity_value_per_share,
        }
    return payload
