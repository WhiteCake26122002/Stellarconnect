"""
Illustrative CAPM/WACC inputs for the Orion Cloud Systems sample company.

These are clearly-labeled demo market assumptions (fictional company), not
scraped or fabricated real market data (spec section 18 prohibits presenting
external data as if it were sourced live). In a real deployment these fields
would be populated from a live market-data feed or a comparable-company set
and each would carry its own source/date.
"""
from __future__ import annotations

from ..engine.models import HistoricalFinancials
from ..engine.wacc import WaccInputs, make_wacc_inputs
from ..engine.models import AssumptionSource, CompanyType


def build_orion_wacc_inputs(hist: HistoricalFinancials, current_share_price: float, diluted_shares: float) -> WaccInputs:
    latest_bs = hist.balance_sheets[-1]
    market_value_of_equity = current_share_price * diluted_shares

    return make_wacc_inputs(
        company_type=CompanyType.PUBLIC,
        risk_free_rate=0.042,
        beta=1.15,
        beta_source=AssumptionSource.MARKET_DATA,
        beta_rationale="5-year weekly regression beta vs. broad market index (illustrative demo value).",
        equity_risk_premium=0.055,
        pretax_cost_of_debt=0.058,
        tax_rate=0.24,
        market_value_of_equity=market_value_of_equity,
        market_value_of_debt=latest_bs.total_debt_and_leases,
        size_premium=0.0,
        source_date="2026-09-03 (illustrative demo data)",
    )
