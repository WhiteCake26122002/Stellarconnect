"""
Realistic sample dataset: "Orion Cloud Systems, Inc." (fictional enterprise
SaaS company, ticker ORCS), used so the platform can be demonstrated end to
end without requiring a real upload. All figures are illustrative and
clearly a fictional demo company - not a real business.

Six historical fiscal years (FY2021-FY2026), USD millions. Values are
generated from year-by-year margin/ratio assumptions rather than typed in
directly, so the statements are internally consistent by construction
(the balance sheet balances exactly; equity is solved as the plug).
"""
from __future__ import annotations

from ..engine.models import (
    BalanceSheet,
    CashFlowStatement,
    Company,
    CompanyType,
    HistoricalFinancials,
    IncomeStatement,
)

YEARS = ["FY2021", "FY2022", "FY2023", "FY2024", "FY2025", "FY2026"]

REVENUE = [520.0, 610.0, 705.0, 810.0, 930.0, 1060.0]
GROSS_MARGIN = [0.700, 0.705, 0.710, 0.715, 0.720, 0.725]
RND_PCT = [0.160, 0.155, 0.150, 0.145, 0.140, 0.135]
SM_PCT = [0.260, 0.250, 0.240, 0.235, 0.230, 0.225]
GA_PCT = [0.100, 0.095, 0.090, 0.087, 0.085, 0.083]
DA_PCT = [0.042, 0.041, 0.040, 0.039, 0.038, 0.037]
INTEREST_EXPENSE = [8.0, 9.0, 10.0, 11.0, 12.0, 13.0]
TAX_RATE = [0.24, 0.24, 0.245, 0.24, 0.235, 0.24]

AR_PCT = [0.145, 0.148, 0.150, 0.152, 0.154, 0.156]
OTHER_CA_PCT = [0.05] * 6
CAPEX_PCT = [0.055, 0.053, 0.052, 0.050, 0.049, 0.048]
GOODWILL = [180.0] * 6
INTANGIBLES = [45.0, 42.0, 40.0, 38.0, 36.0, 34.0]
OTHER_ASSETS_PCT = [0.03] * 6
AP_PCT_OF_COGS = [0.14] * 6
ACCRUED_PCT = [0.06] * 6
ST_DEBT = [20.0] * 6
LT_DEBT = [220.0, 215.0, 210.0, 205.0, 200.0, 195.0]
LEASE_LIAB = [45.0, 44.0, 43.0, 42.0, 41.0, 40.0]
OTHER_LIAB_PCT = [0.04] * 6
MARKETABLE_SECURITIES = [40.0] * 6
SBC_PCT = [0.030, 0.031, 0.032, 0.033, 0.034, 0.035]

SEED_PPE = 210.0
SEED_CASH = 150.0
SEED_NWC = 45.0  # illustrative FY2020 NWC used only to derive FY2021's change-in-NWC


def build_orion_historicals() -> HistoricalFinancials:
    income_statements: list[IncomeStatement] = []
    balance_sheets: list[BalanceSheet] = []
    cash_flows: list[CashFlowStatement] = []

    prior_ppe = SEED_PPE
    prior_cash = SEED_CASH
    prior_nwc = SEED_NWC
    prior_total_debt_and_leases: float | None = None

    for i, period in enumerate(YEARS):
        revenue = REVENUE[i]
        cogs = revenue * (1 - GROSS_MARGIN[i])
        rnd = revenue * RND_PCT[i]
        sm = revenue * SM_PCT[i]
        ga = revenue * GA_PCT[i]
        da = revenue * DA_PCT[i]

        inc = IncomeStatement(
            period=period,
            revenue=revenue,
            cogs=cogs,
            rnd=rnd,
            sm=sm,
            ga=ga,
            da=da,
            interest_expense=INTEREST_EXPENSE[i],
            taxes=0.0,  # filled below once pretax income is known
        )
        pretax = inc.ebit - inc.interest_expense
        taxes = pretax * TAX_RATE[i]
        inc.taxes = taxes
        income_statements.append(inc)

        capex = revenue * CAPEX_PCT[i]
        ppe = prior_ppe + capex - da

        ar = revenue * AR_PCT[i]
        other_ca = revenue * OTHER_CA_PCT[i]
        ap = cogs * AP_PCT_OF_COGS[i]
        accrued = revenue * ACCRUED_PCT[i]
        other_liab = revenue * OTHER_LIAB_PCT[i]
        other_assets = revenue * OTHER_ASSETS_PCT[i]

        nwc = ar + 0.0 + other_ca - ap - accrued
        change_in_nwc = nwc - prior_nwc
        prior_nwc = nwc

        total_debt_and_leases = ST_DEBT[i] + LT_DEBT[i] + LEASE_LIAB[i]
        debt_issuance_repayment = (
            (total_debt_and_leases - prior_total_debt_and_leases) if prior_total_debt_and_leases is not None else -5.0
        )
        prior_total_debt_and_leases = total_debt_and_leases

        intangible_amortization = (INTANGIBLES[i - 1] - INTANGIBLES[i]) if i > 0 else (INTANGIBLES[0] - INTANGIBLES[0] + 2.0)
        sbc = revenue * SBC_PCT[i]

        cf = CashFlowStatement(
            period=period,
            net_income=inc.net_income,
            da=da,
            stock_based_comp=sbc,
            other_noncash=intangible_amortization,
            change_in_nwc=change_in_nwc,
            capex=capex,
            acquisitions=0.0,
            other_investing=0.0,
            debt_issuance_repayment=debt_issuance_repayment,
            equity_issuance_repurchase=0.0,
            dividends=0.0,
        )
        cash = prior_cash + cf.net_change_in_cash
        prior_cash = cash
        prior_ppe = ppe
        cash_flows.append(cf)

        total_liabilities_ex_equity = ap + accrued + ST_DEBT[i] + LT_DEBT[i] + LEASE_LIAB[i] + other_liab
        total_assets = (
            cash
            + MARKETABLE_SECURITIES[i]
            + ar
            + 0.0
            + other_ca
            + ppe
            + GOODWILL[i]
            + INTANGIBLES[i]
            + other_assets
        )
        equity = total_assets - total_liabilities_ex_equity

        balance_sheets.append(
            BalanceSheet(
                period=period,
                cash=cash,
                marketable_securities=MARKETABLE_SECURITIES[i],
                accounts_receivable=ar,
                inventory=0.0,
                other_current_assets=other_ca,
                ppe=ppe,
                goodwill=GOODWILL[i],
                intangibles=INTANGIBLES[i],
                other_assets=other_assets,
                accounts_payable=ap,
                accrued_liabilities=accrued,
                short_term_debt=ST_DEBT[i],
                long_term_debt=LT_DEBT[i],
                lease_liabilities=LEASE_LIAB[i],
                other_liabilities=other_liab,
                shareholders_equity=equity,
            )
        )

    return HistoricalFinancials(
        income_statements=income_statements, balance_sheets=balance_sheets, cash_flows=cash_flows
    )


def build_orion_company() -> Company:
    """
    Illustrative public-company profile. Share price / shares outstanding are
    fictional demo values, not real market data - see spec section 18/38 on
    never fabricating market data for a real company; this is a synthetic one.
    """
    return Company(
        name="Orion Cloud Systems, Inc.",
        ticker="ORCS",
        company_type=CompanyType.PUBLIC,
        currency="USD",
        units="millions",
        industry="Enterprise Software / Cloud (SaaS)",
        fiscal_year_end="December",
        diluted_shares_outstanding=115.0,
        current_share_price=62.50,
        minority_interest=0.0,
        preferred_stock=0.0,
    )
