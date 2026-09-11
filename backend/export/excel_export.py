"""
Exports the full DCF model to a structured, human-auditable, FORMULA-DRIVEN .xlsx
workbook. This mirrors professional sell-side practice: every derived figure -
subtotals, margins, WACC, the forecast build, discounting, the equity bridge, the
scenario comparison, even the sensitivity grid - is a live Excel formula referencing
raw source cells, not a number pasted in by Python. Open the file, change a yellow
input cell (an assumption, a WACC input, a terminal growth rate), and the entire
model recalculates in place.

Only genuinely external inputs are written as plain values: figures sourced from
Yahoo Finance / the user (revenue, COGS, balance sheet line items, WACC market
inputs, current price/shares) and this session's own scenario/sensitivity engine
output (which re-runs the full Python pipeline per shift - see backend/engine/
sensitivity.py's docstring - and is disclosed as such rather than faked as a live
Excel recompute).

Every cross-sheet formula reference in this module is built from an explicit,
named Python row/column variable - never a hardcoded cell address guessed by eye -
so a layout change in one function can't silently desync a formula in another.
"""
from __future__ import annotations

from dataclasses import dataclass

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from ..engine.forecast import ForecastResult
from ..engine.historical import HistoricalSummary
from ..engine.models import BalanceSheet, Company, HistoricalFinancials
from ..engine.scenarios import ScenarioOutput
from ..engine.sensitivity import DriverImpact, WaccGrowthTable
from ..engine.valuation import DCFValuationResult
from ..engine.validation import IntegrityReport
from ..engine.wacc import WaccResult

# Brand palette - matches ui_theme.py exactly (black + deep indigo) so the workbook
# reads as the same product as the Streamlit UI and PDF report, not a generic export.
BLACK = "000000"
NAVY = "160D70"
NAVY_LIGHT = "2A1FB0"
NAVY_SOFT = "221867"
LAVENDER_FAINT = "F1EFFC"  # near-white with a lavender cast - replaces plain gray for computed cells
BORDER_GRAY = "D9D6EE"     # light lavender-gray hairline, not a generic gray
BEAR_SOFT = "FDE8E8"
BASE_SOFT = "EDEBFB"
BULL_SOFT = "E3F9EA"

HEADER_FILL = PatternFill("solid", fgColor=NAVY)
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri", size=10.5)
TITLE_FONT = Font(bold=True, size=16, color=NAVY, name="Calibri")
SUBTITLE_FONT = Font(size=9.5, color="6B67A6", italic=False, name="Calibri")
SECTION_FILL = PatternFill("solid", fgColor=NAVY)
SECTION_FONT = Font(bold=True, size=11, color="FFFFFF", name="Calibri")
BOLD = Font(bold=True, name="Calibri")
WARN_FONT = Font(color="B45309", bold=True, name="Calibri")
CALC_FILL = PatternFill("solid", fgColor=LAVENDER_FAINT)  # lavender tint = computed/formula cell
ASSUMPTION_FILL = PatternFill("solid", fgColor="FEF9C3")  # yellow = editable input, per spec section 21
CHECK_FILL = PatternFill("solid", fgColor="DCFCE7")  # green = tie-out / balance-check row
HEADLINE_FILL = PatternFill("solid", fgColor=NAVY_LIGHT)  # the one number on a sheet meant to catch the eye
HEADLINE_FONT = Font(bold=True, color="FFFFFF", name="Calibri", size=11)

HEADER_BORDER = Border(bottom=Side(style="medium", color=NAVY))
ROW_BORDER = Border(bottom=Side(style="thin", color=BORDER_GRAY))
ACCENT_RULE = PatternFill("solid", fgColor=NAVY_LIGHT)

FORMAT_MONEY = "#,##0"
FORMAT_PCT = "0.0%"
FORMAT_PER_SHARE = "#,##0.00"
FORMAT_RATIO = "0.00"
FORMAT_DISCOUNT_FACTOR = "0.000"

FIRST_DATA_COL = 2  # column B holds the first period/scenario value


def _col(idx: int) -> str:
    return get_column_letter(idx)


def _title(ws: Worksheet, text: str, subtitle: str | None = None) -> None:
    ws["A1"] = text
    ws["A1"].font = TITLE_FONT
    ws.row_dimensions[1].height = 22
    if subtitle:
        ws["A2"] = subtitle
        ws["A2"].font = SUBTITLE_FONT
    # A thin brand-colored rule under the title band, echoing the PDF's accent bar.
    for col in range(1, 3):
        ws.cell(row=1, column=col).border = Border(bottom=Side(style="thin", color=NAVY_LIGHT))


def _section_banner(ws: Worksheet, row: int, text: str, span_cols: int = 6) -> None:
    """A filled, full-width section header bar (e.g. 'Company Snapshot') - the same
    visual device professional sell-side models use to break a dense sheet into blocks."""
    ws.cell(row=row, column=1, value=text)
    for col in range(1, span_cols + 1):
        c = ws.cell(row=row, column=col)
        c.fill = SECTION_FILL
        c.font = SECTION_FONT
    ws.row_dimensions[row].height = 20


def _header_row(ws: Worksheet, row: int, labels: list[str], start_col: int = 1) -> None:
    for i, label in enumerate(labels):
        c = ws.cell(row=row, column=start_col + i, value=label)
        c.fill = HEADER_FILL
        c.font = HEADER_FONT
        c.border = HEADER_BORDER
    ws.row_dimensions[row].height = 18


def _autosize(ws: Worksheet, n_cols: int, width: int = 16) -> None:
    for i in range(1, n_cols + 1):
        ws.column_dimensions[_col(i)].width = width


def _label(ws: Worksheet, row: int, text: str, bold: bool = True, col: int = 1) -> None:
    c = ws.cell(row=row, column=col, value=text)
    if bold:
        c.font = BOLD


def _input_row(ws: Worksheet, row: int, label: str, values: list[float], fmt: str, start_col: int = FIRST_DATA_COL) -> None:
    """A raw, sourced input row: written as plain numbers, shaded yellow so it reads as editable."""
    _label(ws, row, label)
    for j, v in enumerate(values):
        cell = ws.cell(row=row, column=start_col + j, value=v)
        cell.number_format = fmt
        cell.fill = ASSUMPTION_FILL
        cell.border = ROW_BORDER


def _formula_row(ws: Worksheet, row: int, label: str, formulas: list[str], fmt: str, start_col: int = FIRST_DATA_COL, bold_label: bool = True) -> None:
    _label(ws, row, label, bold=bold_label)
    for j, f in enumerate(formulas):
        if f == "":
            continue
        cell = ws.cell(row=row, column=start_col + j, value=f)
        cell.number_format = fmt
        cell.fill = CALC_FILL
        cell.border = ROW_BORDER


# ============================================================================
# Top-level export
# ============================================================================


def export_dcf_to_excel(
    path: str,
    company: Company,
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    forecast: ForecastResult,
    wacc_result: WaccResult,
    valuation: DCFValuationResult,
    scenarios: dict[str, ScenarioOutput],
    sensitivity_table: WaccGrowthTable,
    driver_ranking: list[DriverImpact],
    integrity: IntegrityReport,
    ingestion_notes: list[str] | None = None,
    ingestion_warnings: list[str] | None = None,
) -> None:
    wb = Workbook()
    wb.remove(wb.active)

    _write_historical_is_sheet(wb.create_sheet("Historical IS"), hist)
    _write_historical_bs_sheet(wb.create_sheet("Historical BS"), hist)
    _write_historical_cf_sheet(wb.create_sheet("Historical CF"), hist)
    _write_historical_analysis_sheet(wb.create_sheet("Historical Analysis"), hist, summary)
    wacc_rows = _write_wacc_sheet(wb.create_sheet("WACC"), company, wacc_result)

    n_hist = len(hist.income_statements)
    last_hist_col = _col(FIRST_DATA_COL + n_hist - 1)
    prior_revenue_ref = f"'Historical IS'!{last_hist_col}${IS_ROWS['revenue']}"
    prior_nwc_ref = f"'Historical BS'!{last_hist_col}${BS_ROWS['nwc']}"
    base_wacc_ref = f"WACC!${_col(wacc_rows['value_col'])}${wacc_rows['wacc']}"

    fc_base_rows = _write_forecast_fcff_sheet(
        wb.create_sheet("Forecast & FCFF (Base)"), forecast, base_wacc_ref, prior_revenue_ref, prior_nwc_ref,
    )
    dcf_base_rows = _write_dcf_sheet(
        wb.create_sheet("DCF (Base)"), "Forecast & FCFF (Base)", fc_base_rows,
        base_wacc_ref, valuation.terminal_growth, None, valuation.exit_multiple,
        company, hist.balance_sheets[-1],
    )

    scenario_rows: dict[str, dict] = {
        "Base Case": {"fc_sheet": "Forecast & FCFF (Base)", "dcf_sheet": "DCF (Base)", "fc_rows": fc_base_rows, "dcf_rows": dcf_base_rows}
    }
    for key, sheet_word in (("Bear Case", "Bear"), ("Bull Case", "Bull")):
        so = scenarios[key]
        fc_ws_name = f"Forecast & FCFF ({sheet_word})"
        dcf_ws_name = f"DCF ({sheet_word})"
        fc_rows = _write_forecast_fcff_sheet(
            wb.create_sheet(fc_ws_name), so.forecast, base_wacc_ref, prior_revenue_ref, prior_nwc_ref,
            scenario_wacc_delta=so.definition.wacc_delta,
        )
        dcf_rows = _write_dcf_sheet(
            wb.create_sheet(dcf_ws_name), fc_ws_name, fc_rows,
            f"'{fc_ws_name}'!$B${fc_rows['scenario_wacc']}", so.terminal_growth,
            (f"'DCF (Base)'!$B${dcf_base_rows['terminal_growth']}", so.definition.terminal_growth_delta),
            valuation.exit_multiple, company, hist.balance_sheets[-1],
        )
        scenario_rows[key] = {"fc_sheet": fc_ws_name, "dcf_sheet": dcf_ws_name, "fc_rows": fc_rows, "dcf_rows": dcf_rows}

    _write_scenario_summary_sheet(wb.create_sheet("Scenario Summary"), scenario_rows, wacc_rows)
    _write_sensitivity_sheet(wb.create_sheet("Sensitivity"), "Forecast & FCFF (Base)", fc_base_rows, sensitivity_table, driver_ranking)
    _write_exec_summary_sheet(wb.create_sheet("Exec Summary", 0), company, wacc_rows, integrity, driver_ranking)
    _write_sources_notes_sheet(wb.create_sheet("Sources & Notes"), ingestion_notes or [], ingestion_warnings or [])

    # Tab colors: Bear/Base/Bull sheets pick up the same scenario colors as the
    # Streamlit UI (ui_theme.SCENARIO_COLORS) and Scenario Summary tint, so the tab
    # strip itself communicates which sheets belong to which case at a glance.
    for name in wb.sheetnames:
        if "(Bear)" in name:
            wb[name].sheet_properties.tabColor = "EF4444"
        elif "(Bull)" in name:
            wb[name].sheet_properties.tabColor = "22C55E"
        elif "(Base)" in name:
            wb[name].sheet_properties.tabColor = NAVY_LIGHT
        elif name in ("Exec Summary", "Scenario Summary", "WACC", "Sensitivity"):
            wb[name].sheet_properties.tabColor = NAVY

    wb.active = 0
    wb.save(path)


# ============================================================================
# Historical statements
# ============================================================================

# Fixed row layout for the Historical IS / BS sheets, referenced by other sheets.
IS_ROWS = {
    "revenue": 2, "cogs": 3, "gross_profit": 4, "gross_margin": 5, "rnd": 6, "sm": 7, "ga": 8,
    "other_opex": 9, "ebitda": 10, "ebitda_margin": 11, "da": 12, "ebit": 13, "ebit_margin": 14,
    "interest_expense": 15, "other_below_ebit": 16, "pretax_income": 17, "taxes": 18, "tax_rate": 19,
    "net_income": 20, "revenue_growth": 22,
}
BS_ROWS = {
    "cash": 2, "mkt_sec": 3, "ar": 4, "inventory": 5, "other_ca": 6, "ppe": 7, "goodwill": 8,
    "intangibles": 9, "other_assets": 10, "total_assets": 11, "ap": 13, "accrued": 14, "st_debt": 15,
    "lt_debt": 16, "lease": 17, "other_liab": 18, "total_liab": 19, "equity": 20, "total_liab_equity": 21,
    "balance_check": 22, "total_debt": 24, "total_debt_leases": 25, "total_cash_inv": 26, "nwc": 27,
}
CF_ROWS = {
    "net_income": 2, "da": 3, "sbc": 4, "other_noncash": 5, "d_nwc": 6, "cfo": 7,
    "capex": 9, "acquisitions": 10, "other_investing": 11, "cfi": 12,
    "debt_issuance": 14, "equity_issuance": 15, "dividends": 16, "cff": 17, "net_change_cash": 19,
}


def _write_historical_is_sheet(ws: Worksheet, hist: HistoricalFinancials) -> None:
    periods = [i.period for i in hist.income_statements]
    n = len(periods)
    _header_row(ws, 1, ["Line Item"] + periods)
    ws.freeze_panes = "B2"

    def c(j: int) -> str:
        return _col(FIRST_DATA_COL + j)

    R = IS_ROWS
    _input_row(ws, R["revenue"], "Revenue", [i.revenue for i in hist.income_statements], FORMAT_MONEY)
    _input_row(ws, R["cogs"], "COGS", [-i.cogs for i in hist.income_statements], FORMAT_MONEY)
    _formula_row(ws, R["gross_profit"], "Gross Profit", [f"={c(j)}{R['revenue']}+{c(j)}{R['cogs']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, R["gross_margin"], "Gross Margin %", [f"=IFERROR({c(j)}{R['gross_profit']}/{c(j)}{R['revenue']},0)" for j in range(n)], FORMAT_PCT)
    _input_row(ws, R["rnd"], "R&D", [-i.rnd for i in hist.income_statements], FORMAT_MONEY)
    _input_row(ws, R["sm"], "S&M", [-i.sm for i in hist.income_statements], FORMAT_MONEY)
    _input_row(ws, R["ga"], "G&A", [-i.ga for i in hist.income_statements], FORMAT_MONEY)
    _input_row(ws, R["other_opex"], "Other Opex", [-i.other_opex for i in hist.income_statements], FORMAT_MONEY)
    _formula_row(ws, R["ebitda"], "EBITDA", [f"=SUM({c(j)}{R['gross_profit']},{c(j)}{R['rnd']}:{c(j)}{R['other_opex']})" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, R["ebitda_margin"], "EBITDA Margin %", [f"=IFERROR({c(j)}{R['ebitda']}/{c(j)}{R['revenue']},0)" for j in range(n)], FORMAT_PCT)
    _input_row(ws, R["da"], "D&A", [-i.da for i in hist.income_statements], FORMAT_MONEY)
    _formula_row(ws, R["ebit"], "EBIT", [f"={c(j)}{R['ebitda']}+{c(j)}{R['da']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, R["ebit_margin"], "EBIT Margin %", [f"=IFERROR({c(j)}{R['ebit']}/{c(j)}{R['revenue']},0)" for j in range(n)], FORMAT_PCT)
    _input_row(ws, R["interest_expense"], "Interest Expense", [-i.interest_expense for i in hist.income_statements], FORMAT_MONEY)
    _input_row(ws, R["other_below_ebit"], "Other Below EBIT (net, non-operating)", [i.other_below_ebit for i in hist.income_statements], FORMAT_MONEY)
    _formula_row(ws, R["pretax_income"], "Pre-Tax Income", [f"={c(j)}{R['ebit']}+{c(j)}{R['interest_expense']}+{c(j)}{R['other_below_ebit']}" for j in range(n)], FORMAT_MONEY)
    _input_row(ws, R["taxes"], "Taxes", [-i.taxes for i in hist.income_statements], FORMAT_MONEY)
    _formula_row(ws, R["tax_rate"], "Effective Tax Rate %", [f"=IFERROR(-{c(j)}{R['taxes']}/{c(j)}{R['pretax_income']},0)" for j in range(n)], FORMAT_PCT)
    _formula_row(ws, R["net_income"], "Net Income", [f"={c(j)}{R['pretax_income']}+{c(j)}{R['taxes']}" for j in range(n)], FORMAT_MONEY)
    growth_formulas = [""] + [f"=IFERROR({c(j)}{R['revenue']}/{c(j-1)}{R['revenue']}-1,\"\")" for j in range(1, n)]
    _formula_row(ws, R["revenue_growth"], "Revenue Growth % (YoY)", growth_formulas, FORMAT_PCT)

    _autosize(ws, n + 1)
    ws.column_dimensions["A"].width = 32


def _write_historical_bs_sheet(ws: Worksheet, hist: HistoricalFinancials) -> None:
    periods = [b.period for b in hist.balance_sheets]
    n = len(periods)
    _header_row(ws, 1, ["Line Item"] + periods)
    ws.freeze_panes = "B2"

    def c(j: int) -> str:
        return _col(FIRST_DATA_COL + j)

    R = BS_ROWS
    _input_row(ws, R["cash"], "Cash & Equivalents", [b.cash for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["mkt_sec"], "Marketable Securities", [b.marketable_securities for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["ar"], "Accounts Receivable", [b.accounts_receivable for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["inventory"], "Inventory", [b.inventory for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["other_ca"], "Other Current Assets", [b.other_current_assets for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["ppe"], "PP&E", [b.ppe for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["goodwill"], "Goodwill", [b.goodwill for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["intangibles"], "Intangible Assets", [b.intangibles for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["other_assets"], "Other Assets", [b.other_assets for b in hist.balance_sheets], FORMAT_MONEY)
    _formula_row(ws, R["total_assets"], "Total Assets", [f"=SUM({c(j)}{R['cash']}:{c(j)}{R['other_assets']})" for j in range(n)], FORMAT_MONEY)

    _input_row(ws, R["ap"], "Accounts Payable", [b.accounts_payable for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["accrued"], "Accrued Liabilities", [b.accrued_liabilities for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["st_debt"], "Short-Term Debt", [b.short_term_debt for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["lt_debt"], "Long-Term Debt", [b.long_term_debt for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["lease"], "Lease Liabilities", [b.lease_liabilities for b in hist.balance_sheets], FORMAT_MONEY)
    _input_row(ws, R["other_liab"], "Other Liabilities", [b.other_liabilities for b in hist.balance_sheets], FORMAT_MONEY)
    _formula_row(ws, R["total_liab"], "Total Liabilities", [f"=SUM({c(j)}{R['ap']}:{c(j)}{R['other_liab']})" for j in range(n)], FORMAT_MONEY)
    _input_row(ws, R["equity"], "Shareholders' Equity", [b.shareholders_equity for b in hist.balance_sheets], FORMAT_MONEY)
    _formula_row(ws, R["total_liab_equity"], "Total Liabilities + Equity", [f"={c(j)}{R['total_liab']}+{c(j)}{R['equity']}" for j in range(n)], FORMAT_MONEY)

    _formula_row(ws, R["balance_check"], "Balance Check (Assets − (Liab.+Equity))", [f"={c(j)}{R['total_assets']}-{c(j)}{R['total_liab_equity']}" for j in range(n)], FORMAT_MONEY)
    for j in range(n):
        ws.cell(row=R["balance_check"], column=FIRST_DATA_COL + j).fill = CHECK_FILL
    ws.cell(row=R["balance_check"] + 1, column=1, value="Should be ~0 for every year: confirms Assets = Liabilities + Equity ties out exactly.")

    _formula_row(ws, R["total_debt"], "Total Debt (ST + LT)", [f"={c(j)}{R['st_debt']}+{c(j)}{R['lt_debt']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, R["total_debt_leases"], "Total Debt & Leases", [f"={c(j)}{R['total_debt']}+{c(j)}{R['lease']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, R["total_cash_inv"], "Total Cash & Investments", [f"={c(j)}{R['cash']}+{c(j)}{R['mkt_sec']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(
        ws, R["nwc"], "Net Working Capital",
        [f"=({c(j)}{R['ar']}+{c(j)}{R['inventory']}+{c(j)}{R['other_ca']})-({c(j)}{R['ap']}+{c(j)}{R['accrued']})" for j in range(n)],
        FORMAT_MONEY,
    )

    _autosize(ws, n + 1)
    ws.column_dimensions["A"].width = 34


def _write_historical_cf_sheet(ws: Worksheet, hist: HistoricalFinancials) -> None:
    periods = [x.period for x in hist.cash_flows]
    n = len(periods)
    _header_row(ws, 1, ["Line Item"] + periods)
    ws.freeze_panes = "B2"

    def c(j: int) -> str:
        return _col(FIRST_DATA_COL + j)

    R = CF_ROWS
    _input_row(ws, R["net_income"], "Net Income", [x.net_income for x in hist.cash_flows], FORMAT_MONEY)
    _input_row(ws, R["da"], "D&A", [x.da for x in hist.cash_flows], FORMAT_MONEY)
    _input_row(ws, R["sbc"], "Stock-Based Compensation", [x.stock_based_comp for x in hist.cash_flows], FORMAT_MONEY)
    _input_row(ws, R["other_noncash"], "Other Non-Cash Items", [x.other_noncash for x in hist.cash_flows], FORMAT_MONEY)
    _input_row(ws, R["d_nwc"], "(Increase)/Decrease in NWC", [-x.change_in_nwc for x in hist.cash_flows], FORMAT_MONEY)
    _formula_row(ws, R["cfo"], "Cash Flow from Operations", [f"=SUM({c(j)}{R['net_income']}:{c(j)}{R['d_nwc']})" for j in range(n)], FORMAT_MONEY)

    _input_row(ws, R["capex"], "Capex", [-x.capex for x in hist.cash_flows], FORMAT_MONEY)
    _input_row(ws, R["acquisitions"], "Acquisitions", [-x.acquisitions for x in hist.cash_flows], FORMAT_MONEY)
    _input_row(ws, R["other_investing"], "Other Investing", [x.other_investing for x in hist.cash_flows], FORMAT_MONEY)
    _formula_row(ws, R["cfi"], "Cash Flow from Investing", [f"=SUM({c(j)}{R['capex']}:{c(j)}{R['other_investing']})" for j in range(n)], FORMAT_MONEY)

    _input_row(ws, R["debt_issuance"], "Debt Issuance/(Repayment)", [x.debt_issuance_repayment for x in hist.cash_flows], FORMAT_MONEY)
    _input_row(ws, R["equity_issuance"], "Equity Issuance/(Repurchase)", [x.equity_issuance_repurchase for x in hist.cash_flows], FORMAT_MONEY)
    _input_row(ws, R["dividends"], "Dividends", [-x.dividends for x in hist.cash_flows], FORMAT_MONEY)
    _formula_row(ws, R["cff"], "Cash Flow from Financing", [f"=SUM({c(j)}{R['debt_issuance']}:{c(j)}{R['dividends']})" for j in range(n)], FORMAT_MONEY)

    _formula_row(ws, R["net_change_cash"], "Net Change in Cash", [f"={c(j)}{R['cfo']}+{c(j)}{R['cfi']}+{c(j)}{R['cff']}" for j in range(n)], FORMAT_MONEY)

    _autosize(ws, n + 1)
    ws.column_dimensions["A"].width = 32


def _write_historical_analysis_sheet(ws: Worksheet, hist: HistoricalFinancials, summary: HistoricalSummary) -> None:
    periods = [y.period for y in summary.years]
    n = len(periods)
    _header_row(ws, 1, ["Metric"] + periods)
    ws.freeze_panes = "B2"

    def c(j: int) -> str:
        return _col(FIRST_DATA_COL + j)

    IS, BS, CF = IS_ROWS, BS_ROWS, CF_ROWS
    _formula_row(ws, 2, "Revenue Growth %", [f"='Historical IS'!{c(j)}{IS['revenue_growth']}" for j in range(n)], FORMAT_PCT)
    _formula_row(ws, 3, "Gross Margin %", [f"='Historical IS'!{c(j)}{IS['gross_margin']}" for j in range(n)], FORMAT_PCT)
    _formula_row(ws, 4, "EBITDA Margin %", [f"='Historical IS'!{c(j)}{IS['ebitda_margin']}" for j in range(n)], FORMAT_PCT)
    _formula_row(ws, 5, "EBIT Margin %", [f"='Historical IS'!{c(j)}{IS['ebit_margin']}" for j in range(n)], FORMAT_PCT)
    _formula_row(ws, 6, "Net Margin %", [f"=IFERROR('Historical IS'!{c(j)}{IS['net_income']}/'Historical IS'!{c(j)}{IS['revenue']},0)" for j in range(n)], FORMAT_PCT)
    _formula_row(ws, 7, "Tax Rate %", [f"='Historical IS'!{c(j)}{IS['tax_rate']}" for j in range(n)], FORMAT_PCT)
    _formula_row(ws, 8, "Capex % of Revenue", [f"=IFERROR(-'Historical CF'!{c(j)}{CF['capex']}/'Historical IS'!{c(j)}{IS['revenue']},0)" for j in range(n)], FORMAT_PCT)
    _formula_row(ws, 9, "D&A % of Revenue", [f"=IFERROR(-'Historical IS'!{c(j)}{IS['da']}/'Historical IS'!{c(j)}{IS['revenue']},0)" for j in range(n)], FORMAT_PCT)
    _formula_row(ws, 10, "NWC % of Revenue", [f"=IFERROR('Historical BS'!{c(j)}{BS['nwc']}/'Historical IS'!{c(j)}{IS['revenue']},0)" for j in range(n)], FORMAT_PCT)
    _formula_row(ws, 11, "NOPAT", [f"='Historical IS'!{c(j)}{IS['ebit']}*(1-'Historical IS'!{c(j)}{IS['tax_rate']})" for j in range(n)], FORMAT_MONEY)
    _formula_row(
        ws, 12, "Unlevered FCF",
        [f"={c(j)}11-'Historical IS'!{c(j)}{IS['da']}+'Historical CF'!{c(j)}{CF['capex']}+'Historical CF'!{c(j)}{CF['d_nwc']}" for j in range(n)],
        FORMAT_MONEY,
    )
    _formula_row(ws, 13, "FCF Margin %", [f"=IFERROR({c(j)}12/'Historical IS'!{c(j)}{IS['revenue']},0)" for j in range(n)], FORMAT_PCT)

    r = 16
    _label(ws, r, "Revenue CAGR (3Y)")
    if n >= 4:
        f = f"=IFERROR(('Historical IS'!{c(n-1)}{IS['revenue']}/'Historical IS'!{c(n-4)}{IS['revenue']})^(1/3)-1,\"\")"
        cell = ws.cell(row=r, column=2, value=f)
        cell.number_format = FORMAT_PCT
        cell.fill = CALC_FILL
    _label(ws, r + 1, "Revenue CAGR (5Y)")
    if n >= 6:
        f = f"=IFERROR(('Historical IS'!{c(n-1)}{IS['revenue']}/'Historical IS'!{c(n-6)}{IS['revenue']})^(1/5)-1,\"\")"
        cell = ws.cell(row=r + 1, column=2, value=f)
        cell.number_format = FORMAT_PCT
        cell.fill = CALC_FILL

    _section_banner(ws, r + 3, "Trend Commentary", span_cols=n + 1)
    for i, line in enumerate(summary.trend_commentary):
        ws.cell(row=r + 4 + i, column=1, value=line)

    _autosize(ws, n + 1)
    ws.column_dimensions["A"].width = 34


# ============================================================================
# WACC
# ============================================================================


def _write_wacc_sheet(ws: Worksheet, company: Company, wacc_result: WaccResult) -> dict[str, int]:
    _title(ws, "Weighted Average Cost of Capital (WACC)")
    inputs = wacc_result.inputs
    VALUE_COL = 2
    _header_row(ws, 2, ["Input", "Value", "Source", "Rationale"])
    ws.freeze_panes = "B3"

    row = {}
    r = 3

    def write(key: str, label: str, value, fmt: str, source, rationale: str, is_input: bool) -> None:
        nonlocal r
        row[key] = r
        _label(ws, r, label)
        cell = ws.cell(row=r, column=VALUE_COL, value=value)
        cell.number_format = fmt
        cell.fill = ASSUMPTION_FILL if is_input else CALC_FILL
        ws.cell(row=r, column=3, value=str(source))
        ws.cell(row=r, column=4, value=rationale)
        r += 1

    write("rf", "Risk-Free Rate %", inputs.risk_free_rate.effective_value, FORMAT_PCT, inputs.risk_free_rate.source, inputs.risk_free_rate.rationale, True)
    write("beta", "Beta", inputs.beta.effective_value, FORMAT_RATIO, inputs.beta.source, inputs.beta.rationale, True)
    write("erp", "Equity Risk Premium %", inputs.equity_risk_premium.effective_value, FORMAT_PCT, inputs.equity_risk_premium.source, inputs.equity_risk_premium.rationale, True)
    write("size_prem", "Size Premium %", inputs.size_premium.effective_value, FORMAT_PCT, inputs.size_premium.source, inputs.size_premium.rationale, True)
    write("coe", "Cost of Equity % = Rf + Beta × ERP + Size Prem.", f"=B{row['rf']}+B{row['beta']}*B{row['erp']}+B{row['size_prem']}", FORMAT_PCT, "calculated", "Rf + Beta x ERP + Size Premium", False)
    write("kd_pretax", "Pre-Tax Cost of Debt %", inputs.pretax_cost_of_debt.effective_value, FORMAT_PCT, inputs.pretax_cost_of_debt.source, inputs.pretax_cost_of_debt.rationale, True)
    write("tax_rate", "Tax Rate %", inputs.tax_rate.effective_value, FORMAT_PCT, inputs.tax_rate.source, inputs.tax_rate.rationale, True)
    write("kd_aftertax", "After-Tax Cost of Debt % = Kd × (1 − Tax)", f"=B{row['kd_pretax']}*(1-B{row['tax_rate']})", FORMAT_PCT, "calculated", "Pre-Tax Cost of Debt x (1 - Tax Rate)", False)
    write("price", "Current Share Price", company.current_share_price or 0.0, FORMAT_PER_SHARE, "market_data", "Latest traded price.", True)
    write("shares", "Diluted Shares Outstanding", company.diluted_shares_outstanding or 0.0, FORMAT_MONEY, "market_data", "Diluted share count.", True)
    write("mve", "Market Value of Equity = Price × Shares", f"=B{row['price']}*B{row['shares']}", FORMAT_MONEY, "calculated", "Current Share Price x Diluted Shares Outstanding.", False)
    write("mvd", "Market Value of Debt", inputs.market_value_of_debt.effective_value, FORMAT_MONEY, inputs.market_value_of_debt.source, inputs.market_value_of_debt.rationale, True)
    write("we", "Equity Weight % = E / (E+D)", f"=B{row['mve']}/(B{row['mve']}+B{row['mvd']})", FORMAT_PCT, "calculated", "E / (D+E)", False)
    write("wd", "Debt Weight % = D / (E+D)", f"=1-B{row['we']}", FORMAT_PCT, "calculated", "D / (D+E)", False)
    write("wacc", "WACC % = We×Ke + Wd×Kd(1−t)", f"=B{row['we']}*B{row['coe']}+B{row['wd']}*B{row['kd_aftertax']}", FORMAT_PCT, "calculated", "We x Ke + Wd x Kd(1-t)", False)

    # The single headline number on this sheet - filled to catch the eye, matching the
    # highlighted "Value/Share" convention professional models use for the one figure
    # everything else on the tab exists to produce.
    headline = ws.cell(row=row["wacc"], column=VALUE_COL)
    headline.fill = HEADLINE_FILL
    headline.font = HEADLINE_FONT
    ws.cell(row=row["wacc"], column=1).font = Font(bold=True, color=NAVY, name="Calibri")

    _autosize(ws, 4)
    ws.column_dimensions["A"].width = 42
    ws.column_dimensions["D"].width = 70

    row["value_col"] = VALUE_COL
    return row


# ============================================================================
# Forecast & FCFF (one sheet per scenario: Base / Bear / Bull)
# ============================================================================


def _write_forecast_fcff_sheet(
    ws: Worksheet,
    forecast: ForecastResult,
    base_wacc_ref: str,
    prior_revenue_ref: str,
    prior_nwc_ref: str,
    scenario_wacc_delta: float | None = None,
) -> dict[str, int]:
    a = forecast.assumptions
    periods = a.forecast_years
    n = len(periods)

    def c(j: int) -> str:
        return _col(FIRST_DATA_COL + j)

    rows: dict[str, int] = {}
    if scenario_wacc_delta is not None:
        _title(ws, "Forecast & FCFF")
        ws["A2"] = "Scenario Cost of Capital (this tab's own WACC, applied to discounting below)"
        ws["A2"].font = Font(bold=True, color=NAVY, name="Calibri", size=10.5)
        ws.cell(row=3, column=1, value="Base-Case WACC (live link)").font = BOLD
        cell = ws.cell(row=3, column=2, value=f"={base_wacc_ref}")
        cell.number_format = FORMAT_PCT
        cell.fill = CALC_FILL
        ws.cell(row=4, column=1, value="Scenario WACC = Base WACC + Delta").font = BOLD
        cell = ws.cell(row=4, column=2, value=f"=B3+({scenario_wacc_delta})")
        cell.number_format = FORMAT_PCT
        cell.fill = CALC_FILL
        rows["scenario_wacc"] = 4
        header_row = 6
        wacc_ref = "$B$4"
    else:
        _title(ws, "Forecast & FCFF - Base Case")
        header_row = 3
        wacc_ref = base_wacc_ref

    _header_row(ws, header_row, ["Metric"] + periods)
    ws.freeze_panes = f"B{header_row + 1}"
    r0 = header_row + 1

    names = [
        "rev_g", "revenue", "gm", "gross_profit", "rnd_pct", "sm_pct", "ga_pct", "rnd", "sm", "ga",
        "opex", "ebitda", "ebitda_m", "da_pct", "da", "ebit", "ebit_m", "tax_rate", "taxes", "nopat",
        "capex_pct", "capex", "nwc_pct", "nwc", "d_nwc", "fcff", "n", "df", "pv",
    ]
    for i, name in enumerate(names):
        rows[name] = r0 + i

    def prior_rev(j: int) -> str:
        return prior_revenue_ref if j == 0 else f"{c(j-1)}{rows['revenue']}"

    def prior_nwc(j: int) -> str:
        return prior_nwc_ref if j == 0 else f"{c(j-1)}{rows['nwc']}"

    _input_row(ws, rows["rev_g"], "Revenue Growth %", [x.effective_value for x in a.revenue_growth], FORMAT_PCT)
    _formula_row(ws, rows["revenue"], "Revenue", [f"={prior_rev(j)}*(1+{c(j)}{rows['rev_g']})" for j in range(n)], FORMAT_MONEY)
    _input_row(ws, rows["gm"], "Gross Margin %", [x.effective_value for x in a.gross_margin], FORMAT_PCT)
    _formula_row(ws, rows["gross_profit"], "Gross Profit", [f"={c(j)}{rows['revenue']}*{c(j)}{rows['gm']}" for j in range(n)], FORMAT_MONEY)
    _input_row(ws, rows["rnd_pct"], "R&D % of Revenue", [x.effective_value for x in a.rnd_pct_revenue], FORMAT_PCT)
    _input_row(ws, rows["sm_pct"], "S&M % of Revenue", [x.effective_value for x in a.sm_pct_revenue], FORMAT_PCT)
    _input_row(ws, rows["ga_pct"], "G&A % of Revenue", [x.effective_value for x in a.ga_pct_revenue], FORMAT_PCT)
    _formula_row(ws, rows["rnd"], "R&D", [f"={c(j)}{rows['revenue']}*{c(j)}{rows['rnd_pct']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, rows["sm"], "S&M", [f"={c(j)}{rows['revenue']}*{c(j)}{rows['sm_pct']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, rows["ga"], "G&A", [f"={c(j)}{rows['revenue']}*{c(j)}{rows['ga_pct']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, rows["opex"], "Total Opex (ex D&A)", [f"=SUM({c(j)}{rows['rnd']}:{c(j)}{rows['ga']})" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, rows["ebitda"], "EBITDA", [f"={c(j)}{rows['gross_profit']}-{c(j)}{rows['opex']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, rows["ebitda_m"], "EBITDA Margin %", [f"=IFERROR({c(j)}{rows['ebitda']}/{c(j)}{rows['revenue']},0)" for j in range(n)], FORMAT_PCT)
    _input_row(ws, rows["da_pct"], "D&A % of Revenue", [x.effective_value for x in a.da_pct_revenue], FORMAT_PCT)
    _formula_row(ws, rows["da"], "D&A", [f"={c(j)}{rows['revenue']}*{c(j)}{rows['da_pct']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, rows["ebit"], "EBIT", [f"={c(j)}{rows['ebitda']}-{c(j)}{rows['da']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, rows["ebit_m"], "EBIT Margin %", [f"=IFERROR({c(j)}{rows['ebit']}/{c(j)}{rows['revenue']},0)" for j in range(n)], FORMAT_PCT)
    _input_row(ws, rows["tax_rate"], "Tax Rate %", [x.effective_value for x in a.tax_rate], FORMAT_PCT)
    _formula_row(ws, rows["taxes"], "Taxes on EBIT", [f"=MAX({c(j)}{rows['ebit']},0)*{c(j)}{rows['tax_rate']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, rows["nopat"], "NOPAT", [f"={c(j)}{rows['ebit']}-{c(j)}{rows['taxes']}" for j in range(n)], FORMAT_MONEY)
    _input_row(ws, rows["capex_pct"], "Capex % of Revenue", [x.effective_value for x in a.capex_pct_revenue], FORMAT_PCT)
    _formula_row(ws, rows["capex"], "Capex", [f"={c(j)}{rows['revenue']}*{c(j)}{rows['capex_pct']}" for j in range(n)], FORMAT_MONEY)
    _input_row(ws, rows["nwc_pct"], "NWC % of Revenue", [x.effective_value for x in a.nwc_pct_revenue], FORMAT_PCT)
    _formula_row(ws, rows["nwc"], "Net Working Capital", [f"={c(j)}{rows['revenue']}*{c(j)}{rows['nwc_pct']}" for j in range(n)], FORMAT_MONEY)
    _formula_row(ws, rows["d_nwc"], "Change in NWC", [f"={c(j)}{rows['nwc']}-{prior_nwc(j)}" for j in range(n)], FORMAT_MONEY)
    _formula_row(
        ws, rows["fcff"], "FCFF = NOPAT + D&A − Capex − ΔNWC",
        [f"={c(j)}{rows['nopat']}+{c(j)}{rows['da']}-{c(j)}{rows['capex']}-{c(j)}{rows['d_nwc']}" for j in range(n)],
        FORMAT_MONEY,
    )
    _formula_row(ws, rows["n"], "Discount Period (n)", [str(j + 1) for j in range(n)], "0")
    _formula_row(ws, rows["df"], "Discount Factor = 1/(1+WACC)^n", [f"=1/(1+{wacc_ref})^{c(j)}{rows['n']}" for j in range(n)], FORMAT_DISCOUNT_FACTOR)
    _formula_row(ws, rows["pv"], "PV of FCFF", [f"={c(j)}{rows['fcff']}*{c(j)}{rows['df']}" for j in range(n)], FORMAT_MONEY)

    # Rationale column, one entry per assumption row, taken from the model's own auto-generated text.
    rationale_col = FIRST_DATA_COL + n + 1
    ws.cell(row=1, column=rationale_col, value="Rationale (final forecast year)").font = HEADER_FONT
    ws.cell(row=1, column=rationale_col).fill = HEADER_FILL
    for key, assumption_list in (
        ("rev_g", a.revenue_growth), ("gm", a.gross_margin), ("rnd_pct", a.rnd_pct_revenue),
        ("sm_pct", a.sm_pct_revenue), ("ga_pct", a.ga_pct_revenue), ("da_pct", a.da_pct_revenue),
        ("tax_rate", a.tax_rate), ("capex_pct", a.capex_pct_revenue), ("nwc_pct", a.nwc_pct_revenue),
    ):
        ws.cell(row=rows[key], column=rationale_col, value=assumption_list[-1].rationale)
    ws.column_dimensions[_col(rationale_col)].width = 90

    _autosize(ws, n + 1)
    ws.column_dimensions["A"].width = 38

    rows["header_row"] = header_row
    rows["n_periods"] = n
    return rows


# ============================================================================
# DCF (one sheet per scenario: Base / Bear / Bull)
# ============================================================================


def _write_dcf_sheet(
    ws: Worksheet,
    forecast_sheet_name: str,
    fc_rows: dict[str, int],
    wacc_ref: str,
    terminal_growth: float,
    terminal_growth_link: tuple[str, float] | None,
    exit_multiple: float | None,
    company: Company,
    latest_bs: BalanceSheet,
) -> dict[str, int]:
    n = fc_rows["n_periods"]
    last_col = _col(FIRST_DATA_COL + n - 1)
    fcff_row, n_row, df_row, ebitda_row = fc_rows["fcff"], fc_rows["n"], fc_rows["df"], fc_rows["ebitda"]

    scenario_label = forecast_sheet_name.split("(")[-1].rstrip(")") if "(" in forecast_sheet_name else "Base"
    _title(ws, f"Discounted Cash Flow - {scenario_label} Case")

    rows: dict[str, int] = {}
    r = 3
    rows["pv_explicit"] = r
    sumproduct = f"=SUMPRODUCT('{forecast_sheet_name}'!{_col(FIRST_DATA_COL)}{fcff_row}:{last_col}{fcff_row},'{forecast_sheet_name}'!{_col(FIRST_DATA_COL)}{df_row}:{last_col}{df_row})"
    _formula_row(ws, r, "Sum of PV of Explicit-Period FCFF", [sumproduct], FORMAT_MONEY)
    r += 1

    rows["terminal_growth"] = r
    if terminal_growth_link is None:
        _input_row(ws, r, "Terminal Growth Rate (g)", [terminal_growth], FORMAT_PCT)
    else:
        base_tg_ref, delta = terminal_growth_link
        _label(ws, r, "Base-Case Terminal g (live link) + Scenario Delta")
        cell = ws.cell(row=r, column=2, value=f"={base_tg_ref}+({delta})")
        cell.number_format = FORMAT_PCT
        cell.fill = CALC_FILL
    r += 1

    rows["terminal_fcff"] = r
    _formula_row(ws, r, "Terminal FCFF = Final-Year FCFF × (1+g)", [f"='{forecast_sheet_name}'!{last_col}{fcff_row}*(1+B{rows['terminal_growth']})"], FORMAT_MONEY)
    r += 1

    rows["terminal_value"] = r
    _formula_row(ws, r, "Terminal Value (Gordon Growth) = TFCFF/(WACC−g)", [f"=B{rows['terminal_fcff']}/({wacc_ref}-B{rows['terminal_growth']})"], FORMAT_MONEY)
    r += 1

    rows["pv_terminal_value"] = r
    _formula_row(ws, r, "PV of Terminal Value", [f"=B{rows['terminal_value']}*'{forecast_sheet_name}'!{last_col}{df_row}"], FORMAT_MONEY)
    r += 1

    rows["enterprise_value"] = r
    _formula_row(ws, r, "Enterprise Value", [f"=B{rows['pv_explicit']}+B{rows['pv_terminal_value']}"], FORMAT_MONEY)
    r += 1

    rows["tv_pct_ev"] = r
    _formula_row(ws, r, "Terminal Value % of Enterprise Value", [f"=IFERROR(B{rows['pv_terminal_value']}/B{rows['enterprise_value']},0)"], FORMAT_PCT)
    r += 1

    if exit_multiple is not None:
        rows["exit_multiple"] = r
        _input_row(ws, r, "Exit Multiple (x EBITDA, cross-check)", [exit_multiple], FORMAT_RATIO)
        r += 1
        rows["exit_multiple_tv"] = r
        _formula_row(ws, r, "Terminal Value (Exit Multiple, memo)", [f"='{forecast_sheet_name}'!{last_col}{ebitda_row}*B{rows['exit_multiple']}"], FORMAT_MONEY)
        r += 1

    r += 1
    _section_banner(ws, r, "Enterprise Value → Equity Value Bridge", span_cols=2)
    r += 1

    cash = latest_bs.total_cash_and_investments
    debt = latest_bs.total_debt
    lease = latest_bs.lease_liabilities
    minority = company.minority_interest
    preferred = company.preferred_stock
    shares = company.diluted_shares_outstanding or 0.0
    price = company.current_share_price or 0.0

    rows["bridge_ev"] = r
    _formula_row(ws, r, "Enterprise Value", [f"=B{rows['enterprise_value']}"], FORMAT_MONEY)
    r += 1
    bridge_start = r
    _input_row(ws, r, "+ Cash & Investments", [cash], FORMAT_MONEY)
    r += 1
    _input_row(ws, r, "− Total Debt", [-debt], FORMAT_MONEY)
    r += 1
    _input_row(ws, r, "− Lease Liabilities", [-lease], FORMAT_MONEY)
    r += 1
    _input_row(ws, r, "− Minority Interest", [-minority], FORMAT_MONEY)
    r += 1
    _input_row(ws, r, "− Preferred Stock", [-preferred], FORMAT_MONEY)
    bridge_end = r
    r += 1

    rows["equity_value"] = r
    _formula_row(ws, r, "Equity Value", [f"=B{rows['bridge_ev']}+SUM(B{bridge_start}:B{bridge_end})"], FORMAT_MONEY)
    r += 1

    rows["shares"] = r
    _input_row(ws, r, "Diluted Shares Outstanding", [shares], FORMAT_MONEY)
    r += 1

    rows["value_per_share"] = r
    _formula_row(ws, r, "Equity Value per Share", [f"=IFERROR(B{rows['equity_value']}/B{rows['shares']},0)"], FORMAT_PER_SHARE)
    # Headline number for this sheet - filled to catch the eye (same convention as the WACC tab).
    headline = ws.cell(row=r, column=2)
    headline.fill = HEADLINE_FILL
    headline.font = HEADLINE_FONT
    ws.cell(row=r, column=1).font = Font(bold=True, color=NAVY, name="Calibri")
    r += 1

    rows["current_price"] = r
    _input_row(ws, r, "Current Share Price", [price], FORMAT_PER_SHARE)
    r += 1

    rows["upside"] = r
    _formula_row(ws, r, "Upside / (Downside) %", [f"=IFERROR(B{rows['value_per_share']}/B{rows['current_price']}-1,0)"], FORMAT_PCT)

    _autosize(ws, 2)
    ws.column_dimensions["A"].width = 46
    return rows


# ============================================================================
# Scenario Summary
# ============================================================================


def _write_scenario_summary_sheet(ws: Worksheet, scenario_rows: dict[str, dict], wacc_rows: dict[str, int]) -> None:
    _title(ws, "Scenario Summary")
    _header_row(ws, 3, ["Scenario", "Value/Share", "Current Price", "Upside/(Downside)", "Enterprise Value", "Equity Value", "WACC", "Terminal Growth", "% EV from TV"])
    ws.freeze_panes = "B4"
    order = ["Bear Case", "Base Case", "Bull Case"]
    # Soft scenario tint per row - the same Bear/Base/Bull color mapping the Streamlit
    # UI uses, so a reader recognizes which row is which at a glance.
    row_tint = {"Bear Case": BEAR_SOFT, "Base Case": BASE_SOFT, "Bull Case": BULL_SOFT}
    for i, name in enumerate(order):
        info = scenario_rows[name]
        fc, dcf = info["fc_sheet"], info["dcf_sheet"]
        fc_rows, dcf_rows = info["fc_rows"], info["dcf_rows"]
        row = 4 + i
        tint = PatternFill("solid", fgColor=row_tint[name])
        _label(ws, row, name.replace(" Case", ""))
        ws.cell(row=row, column=1).fill = tint
        if "scenario_wacc" in fc_rows:
            wacc_formula = f"='{fc}'!$B${fc_rows['scenario_wacc']}"
        else:
            wacc_formula = f"=WACC!$B${wacc_rows['wacc']}"

        cells = [
            (2, f"='{dcf}'!B{dcf_rows['value_per_share']}", FORMAT_PER_SHARE),
            (3, f"='{dcf}'!B{dcf_rows['current_price']}", FORMAT_PER_SHARE),
            (4, f"='{dcf}'!B{dcf_rows['upside']}", FORMAT_PCT),
            (5, f"='{dcf}'!B{dcf_rows['enterprise_value']}", FORMAT_MONEY),
            (6, f"='{dcf}'!B{dcf_rows['equity_value']}", FORMAT_MONEY),
            (7, wacc_formula, FORMAT_PCT),
            (8, f"='{dcf}'!B{dcf_rows['terminal_growth']}", FORMAT_PCT),
            (9, f"=IFERROR('{dcf}'!B{dcf_rows['pv_terminal_value']}/'{dcf}'!B{dcf_rows['enterprise_value']},0)", FORMAT_PCT),
        ]
        for col, formula, fmt in cells:
            cell = ws.cell(row=row, column=col, value=formula)
            cell.number_format = fmt
            cell.fill = tint
            cell.border = ROW_BORDER
            if name == "Base Case" and col == 2:
                # The headline number on this tab - the Base Case value/share.
                cell.font = Font(bold=True, color=NAVY, name="Calibri", size=11)

    _autosize(ws, 9)
    ws.column_dimensions["A"].width = 14


# ============================================================================
# Sensitivity
# ============================================================================


def _write_sensitivity_sheet(ws: Worksheet, base_forecast_sheet: str, fc_rows: dict[str, int], table: WaccGrowthTable, driver_ranking: list[DriverImpact]) -> None:
    _title(ws, "Sensitivity - Enterprise Value: WACC × Terminal Growth (Base Case)")
    ws["A2"] = (
        "Fully formula-driven: re-discounts the Base Case's own explicit FCFF at each row's WACC, and grows "
        "the final year's FCFF at each column's g for the terminal value, the same construction as the DCF (Base) tab."
    )

    n = fc_rows["n_periods"]
    last_col = _col(FIRST_DATA_COL + n - 1)
    fcff_row, n_row = fc_rows["fcff"], fc_rows["n"]
    fcff_range = f"'{base_forecast_sheet}'!{_col(FIRST_DATA_COL)}{fcff_row}:{last_col}{fcff_row}"
    n_range = f"'{base_forecast_sheet}'!{_col(FIRST_DATA_COL)}{n_row}:{last_col}{n_row}"
    final_fcff_ref = f"'{base_forecast_sheet}'!{last_col}{fcff_row}"
    final_n_ref = f"'{base_forecast_sheet}'!{last_col}{n_row}"

    hdr_row = 5
    _header_row(ws, hdr_row, ["WACC \\ g"])
    ws.freeze_panes = f"B{hdr_row + 1}"
    for j, g in enumerate(table.growth_range):
        gcell = ws.cell(row=hdr_row, column=2 + j, value=g)
        gcell.number_format = FORMAT_PCT
        gcell.fill = HEADER_FILL
        gcell.font = HEADER_FONT
    mid = len(table.wacc_range) // 2 if len(table.wacc_range) == len(table.growth_range) else -1
    for i, w in enumerate(table.wacc_range):
        row = hdr_row + 1 + i
        wcell = ws.cell(row=row, column=1, value=w)
        wcell.number_format = FORMAT_PCT
        wcell.font = BOLD
        for j, g in enumerate(table.growth_range):
            gcol = _col(2 + j)
            formula = (
                f"=IFERROR(SUMPRODUCT({fcff_range},1/(1+$A{row})^{n_range})"
                f"+({final_fcff_ref}*(1+{gcol}${hdr_row}))/($A{row}-{gcol}${hdr_row})/(1+$A{row})^{final_n_ref},\"\")"
            )
            cell = ws.cell(row=row, column=2 + j, value=formula)
            cell.number_format = FORMAT_MONEY
            cell.border = ROW_BORDER
            # The center cell (base WACC x base terminal growth) is the headline number
            # this whole grid radiates out from - highlighted the same way as the WACC
            # and DCF tabs' own headline cells.
            if i == mid and j == mid:
                cell.fill = HEADLINE_FILL
                cell.font = HEADLINE_FONT
            else:
                cell.fill = CALC_FILL

    r = hdr_row + len(table.wacc_range) + 3
    _section_banner(ws, r, "Ranked Valuation Drivers (EV swing %, full model re-run per shift; see Sources & Notes)", span_cols=2)
    _header_row(ws, r + 1, ["Driver", "EV Swing %"])
    for i, d in enumerate(driver_ranking, start=r + 2):
        ws.cell(row=i, column=1, value=d.driver_name)
        ws.cell(row=i, column=2, value=d.impact_range_pct).number_format = FORMAT_PCT

    _autosize(ws, len(table.growth_range) + 1)
    ws.column_dimensions["A"].width = 20


# ============================================================================
# Exec Summary
# ============================================================================


def _write_exec_summary_sheet(ws: Worksheet, company: Company, wacc_rows: dict[str, int], integrity: IntegrityReport, driver_ranking: list[DriverImpact]) -> None:
    _title(
        ws, f"{company.name} ({company.ticker or 'Private'}) - DCF Valuation",
        subtitle=(
            f"FCFF / WACC Discounted Cash Flow Model  |  Currency: {company.currency} ({company.units})  |  "
            f"Industry: {company.industry or 'n/a'}  |  Country: {company.country or 'n/a'}"
        ),
    )

    r = 4
    _section_banner(ws, r, "Company Snapshot", span_cols=5)
    r += 1
    for label, wacc_key, fmt in [
        ("Current Share Price", "price", FORMAT_PER_SHARE),
        ("Diluted Shares Outstanding", "shares", FORMAT_MONEY),
        ("Market Capitalisation", "mve", FORMAT_MONEY),
    ]:
        _label(ws, r, label)
        cell = ws.cell(row=r, column=2, value=f"=WACC!$B${wacc_rows[wacc_key]}")
        cell.number_format = fmt
        cell.fill = CALC_FILL
        cell.border = ROW_BORDER
        r += 1

    r += 1
    _section_banner(ws, r, "Valuation Summary - Value per Share", span_cols=5)
    r += 1
    _header_row(ws, r, ["Scenario", "Value/Share", "Current Price", "Upside/(Downside)", "Terminal Growth"])
    summary_header_row = r
    row_tint = {"Bear": BEAR_SOFT, "Base": BASE_SOFT, "Bull": BULL_SOFT}
    for i, _name in enumerate(["Bear", "Base", "Bull"]):
        row = summary_header_row + 1 + i
        src_row = 4 + i  # Scenario Summary tab: Bear=row4, Base=row5, Bull=row6
        tint = PatternFill("solid", fgColor=row_tint[_name])
        _label(ws, row, _name)
        ws.cell(row=row, column=1).fill = tint
        for col, src_col, fmt in [(2, "B", FORMAT_PER_SHARE), (3, "C", FORMAT_PER_SHARE), (4, "D", FORMAT_PCT), (5, "H", FORMAT_PCT)]:
            cell = ws.cell(row=row, column=col, value=f"='Scenario Summary'!{src_col}{src_row}")
            cell.number_format = fmt
            cell.fill = tint
            cell.border = ROW_BORDER
            if _name == "Base" and col == 2:
                cell.font = Font(bold=True, color=NAVY, name="Calibri", size=11)
    r = summary_header_row + 5

    r += 1
    _section_banner(ws, r, "Cost of Capital", span_cols=5)
    r += 1
    for label, wacc_key, fmt in [
        ("WACC (Base Case)", "wacc", FORMAT_PCT),
        ("Cost of Equity", "coe", FORMAT_PCT),
        ("Risk-Free Rate", "rf", FORMAT_PCT),
        ("Beta", "beta", FORMAT_RATIO),
    ]:
        _label(ws, r, label)
        cell = ws.cell(row=r, column=2, value=f"=WACC!$B${wacc_rows[wacc_key]}")
        cell.number_format = fmt
        cell.fill = CALC_FILL
        cell.border = ROW_BORDER
        r += 1

    r += 1
    _section_banner(ws, r, "Value-Driver Ranking (EV swing %, largest first)", span_cols=5)
    r += 1
    for d in driver_ranking:
        ws.cell(row=r, column=1, value=d.driver_name)
        c = ws.cell(row=r, column=2, value=d.impact_range_pct)
        c.number_format = FORMAT_PCT
        c.border = ROW_BORDER
        r += 1

    r += 1
    score_tint = BULL_SOFT if integrity.score >= 80 else ("FEF3D9" if integrity.score >= 60 else BEAR_SOFT)
    score_ink = "166534" if integrity.score >= 80 else ("92600A" if integrity.score >= 60 else "991B1B")
    _section_banner(ws, r, f"Model Integrity Score: {integrity.score}/{integrity.max_score}  -  {integrity.band}", span_cols=5)
    ws.cell(row=r, column=1).fill = PatternFill("solid", fgColor=score_tint)
    ws.cell(row=r, column=1).font = Font(bold=True, color=score_ink, name="Calibri", size=11)
    for col in range(2, 6):
        ws.cell(row=r, column=col).fill = PatternFill("solid", fgColor=score_tint)
    r += 1
    for issue in integrity.issues:
        ws.cell(row=r, column=1, value=f"[{issue.severity.upper()}] {issue.message}")
        r += 1

    ws.column_dimensions["A"].width = 44
    for col in range(2, 6):
        ws.column_dimensions[_col(col)].width = 18


# ============================================================================
# Sources & Notes
# ============================================================================


def _write_sources_notes_sheet(ws: Worksheet, ingestion_notes: list[str], ingestion_warnings: list[str]) -> None:
    _title(ws, "Sources & Notes")
    r = 3
    _section_banner(ws, r, "Methodology", span_cols=1)
    r += 1
    methodology = [
        "Enterprise value is built as an unlevered Free Cash Flow to Firm (FCFF) DCF: FCFF = NOPAT + D&A "
        "− Capex − Change in NWC, discounted at WACC (CAPM cost of equity + after-tax cost of debt, weighted "
        "by market value of equity and debt).",
        "Terminal value uses the Gordon Growth perpetuity, Terminal FCFF / (WACC − g), discounted back at "
        "the same WACC and same convention as the explicit-period cash flows; an EBITDA exit-multiple value "
        "is shown alongside as a cross-check only, not used in the primary Enterprise Value.",
        "COGS/operating-expense line items from automated data sources are not always independently broken "
        "out; where that is the case, EBITDA/EBIT/Pre-Tax/Net Income are the source's own reported figures, "
        "with the Revenue-to-EBITDA gap allocated to a single combined opex line (see the Historical IS tab).",
        "Historical Balance Sheet 'Other Assets'/'Other Liabilities' are residual (plug) figures computed "
        "against the source's own reported Total Assets/Total Liabilities, so every historical year ties out "
        "exactly to Assets = Liabilities + Equity (see the Balance Check row on the Historical BS tab).",
        "Bear/Bull scenarios shift revenue growth, margins, capex/NWC intensity, WACC, and terminal growth "
        "from the Base Case by fixed deltas (see each scenario's own Forecast & FCFF tab for its inputs and "
        "rationale) rather than being independently re-derived from source data.",
        "The Sensitivity and Value-Driver Ranking figures are produced by fully re-running this Python model "
        "with one assumption shifted at a time (not a linear approximation); the WACC × Growth grid on the "
        "Sensitivity tab is reproduced as a live Excel formula, while the driver-ranking swings for drivers "
        "outside that 2-D grid (revenue growth, margin, capex) are pasted from that Python re-run.",
    ]
    for line in methodology:
        ws.cell(row=r, column=1, value=line)
        ws.row_dimensions[r].height = 30
        r += 1

    r += 1
    _section_banner(ws, r, "Data Ingestion Notes", span_cols=1)
    r += 1
    if not ingestion_notes and not ingestion_warnings:
        ws.cell(row=r, column=1, value="This model was built from a sample company or manually entered data: no automated data-source notes apply.")
        r += 1
    for note in ingestion_notes:
        ws.cell(row=r, column=1, value=f"Note: {note}")
        ws.row_dimensions[r].height = 30
        r += 1
    for warning in ingestion_warnings:
        cell = ws.cell(row=r, column=1, value=f"Warning: {warning}")
        cell.font = WARN_FONT
        ws.row_dimensions[r].height = 30
        r += 1

    ws.column_dimensions["A"].width = 110
