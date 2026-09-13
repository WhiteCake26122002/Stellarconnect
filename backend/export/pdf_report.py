"""
Generates a professional investment-style PDF valuation report (spec section
29). This is the narrative companion to the Excel workbook: a short,
readable document with the valuation summary, an auto-generated investment
view, scenario/sensitivity tables, key assumptions, and data-quality notes.

All numbers here are pulled directly from the same DCFValuationResult /
ScenarioOutput / IntegrityReport objects used everywhere else in the app -
nothing is recomputed or guessed for the report.
"""
from __future__ import annotations

import io
from datetime import date

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# Brand palette - matches ui_theme.py exactly (black + deep indigo) so the PDF/Excel
# exports read as the same product as the Streamlit UI rather than a generic report.
INK_COLOR = colors.HexColor("#000000")       # BLACK
ACCENT_COLOR = colors.HexColor("#2A1FB0")    # NAVY_LIGHT
NAVY_COLOR = colors.HexColor("#160D70")      # NAVY
MUTED_TEXT = colors.HexColor("#6B67A6")      # a print-legible darker tint of ui_theme's MUTED lavender
BORDER_COLOR = colors.HexColor("#DDDAF0")    # light lavender-gray, not a generic gray
MUTED_FILL = colors.HexColor("#F6F5FC")      # near-white with a lavender cast, for zebra rows
BEAR_COLOR = "#EF4444"
BASE_COLOR = "#8B85E8"
BULL_COLOR = "#22C55E"
HISTORICAL_COLOR = "#9C97D6"  # ui_theme.MUTED - same role (historical series) as the web charts
FORECAST_COLOR = "#2A1FB0"    # ui_theme.NAVY_LIGHT - same role (forecast series) as the web charts

from ..common import currency_format
from ..engine.forecast import ForecastResult
from ..engine.historical import HistoricalSummary
from ..engine.models import Company, HistoricalFinancials
from ..engine.scenarios import ScenarioOutput
from ..engine.sensitivity import DriverImpact, WaccGrowthTable
from ..engine.valuation import DCFValuationResult
from ..engine.validation import IntegrityReport
from ..engine.wacc import WaccResult

# reportlab's base14 fonts (Helvetica) don't reliably render non-Latin-1
# currency glyphs (e.g. Rupee U+20B9), so the PDF uses text abbreviations
# instead of the Unicode symbols the Streamlit UI shows.
PDF_CURRENCY_LABELS = {"USD": "$", "INR": "Rs.", "EUR": "EUR", "GBP": "GBP", "JPY": "JPY", "CNY": "CNY"}


def _currency_label(code: str) -> str:
    return PDF_CURRENCY_LABELS.get((code or "USD").upper(), (code or "USD").upper())


def _esc(text: str) -> str:
    """
    Escapes text for reportlab's mini-XML Paragraph markup. Required for any
    dynamic/sourced text (industry names, historical commentary, rationale
    strings) since a bare '&' - e.g. "D&A", or a live-fetched industry like
    "Oil & Gas Refining & Marketing" - is otherwise parsed as a malformed
    entity reference and renders as garbled text or drops content.
    """
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _money(x: float | None, currency: str, country: str, label: str, suffix: str = "M") -> str:
    """A whole-company monetary figure: Crore/Lakh for India, Millions elsewhere - delegates
    the actual scale math to currency_format so the UI and this report can never disagree on
    it, while keeping `label` (an ASCII-safe symbol like "Rs.") instead of a Unicode glyph
    reportlab's base font can't render. `suffix` is unused outside the non-India path, kept
    only for call-site compatibility."""
    return currency_format.format_scaled_money(x, currency, country, symbol_override=label)


def _per_share(x: float | None, label: str) -> str:
    if x is None:
        return "n/a"
    return f"{label} {x:,.2f}"


def _pct(x: float | None) -> str:
    if x is None:
        return "n/a"
    return f"{x:.1%}"


def _confidence_label(integrity: IntegrityReport, valuation: DCFValuationResult) -> str:
    if integrity.score >= 85 and valuation.terminal_value_pct_of_ev < 0.90:
        return "High"
    if integrity.score >= 65:
        return "Medium"
    return "Low"


def _chart_revenue(hist: HistoricalFinancials, forecast: ForecastResult) -> io.BytesIO:
    fig, ax = plt.subplots(figsize=(6.2, 2.6))
    ax.bar(hist.periods, [i.revenue for i in hist.income_statements], color=HISTORICAL_COLOR, label="Historical")
    ax.bar([y.period for y in forecast.years], [y.revenue for y in forecast.years], color=FORECAST_COLOR, label="Forecast")
    ax.set_ylabel("Revenue")
    ax.legend(frameon=False, fontsize=8)
    ax.tick_params(axis="x", labelrotation=45, labelsize=7)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150)
    plt.close(fig)
    buf.seek(0)
    return buf


def _chart_scenarios(scenarios: dict[str, ScenarioOutput], current_price: float | None, label: str) -> io.BytesIO:
    """
    "Football field" range chart: a shaded Bear->Bull value-per-share range
    with each scenario marked on it and the current market price overlaid -
    the standard equity-research way to show a valuation range, and directly
    comparable to the market price (unlike a bare Enterprise Value bar chart).
    """
    order = ["Bear Case", "Base Case", "Bull Case"]
    colors_map = {"Bear Case": BEAR_COLOR, "Base Case": BASE_COLOR, "Bull Case": BULL_COLOR}
    prices = {
        n: scenarios[n].valuation.equity_bridge.equity_value_per_share
        for n in order
        if n in scenarios and scenarios[n].valuation.equity_bridge.equity_value_per_share is not None
    }

    fig, ax = plt.subplots(figsize=(6.2, 2.3))
    vals = list(prices.values()) or [0.0]
    lo, hi = min(vals), max(vals)
    if current_price:
        lo, hi = min(lo, current_price), max(hi, current_price)
    pad = max((hi - lo) * 0.12, abs(hi) * 0.03, 1.0)

    if len(prices) >= 2:
        range_lo, range_hi = min(prices.values()), max(prices.values())
        ax.barh([0], [range_hi - range_lo], left=range_lo, height=0.5, color=FORECAST_COLOR, alpha=0.12, edgecolor=FORECAST_COLOR, linewidth=1.2, zorder=1)

    for name in order:
        v = prices.get(name)
        if v is None:
            continue
        ax.scatter([v], [0], s=170, color=colors_map[name], edgecolors="white", linewidths=1.5, zorder=3)
        y_off = 0.22 if name != "Bear Case" else -0.30
        va = "bottom" if y_off > 0 else "top"
        ax.annotate(
            f"{name.replace(' Case', '')}\n{label} {v:,.0f}", (v, 0), xytext=(v, y_off), textcoords="data",
            ha="center", va=va, fontsize=8, color=colors_map[name], fontweight="bold",
        )

    if current_price:
        ax.axvline(current_price, color="#160D70", linestyle="--", linewidth=1.3, zorder=2)
        ax.annotate(
            f"Current {label} {current_price:,.0f}", (current_price, -0.46), ha="center", va="top",
            fontsize=8, color="#160D70",
        )

    ax.set_xlim(lo - pad, hi + pad)
    ax.set_ylim(-0.62, 0.62)
    ax.set_yticks([])
    ax.set_xlabel(f"Value per Share ({label})")
    ax.spines[["top", "right", "left"]].set_visible(False)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150)
    plt.close(fig)
    buf.seek(0)
    return buf


def _make_page_decorator(company_name: str):
    """Returns a canvas callback drawing a consistent footer: page number, generation date, company name."""

    def _decorate(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(BORDER_COLOR)
        canvas.setLineWidth(0.5)
        canvas.line(0.7 * inch, 0.5 * inch, letter[0] - 0.7 * inch, 0.5 * inch)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.grey)
        canvas.drawString(0.7 * inch, 0.35 * inch, _esc(company_name))
        canvas.drawCentredString(letter[0] / 2, 0.35 * inch, f"Generated {date.today().isoformat()} - Not investment advice")
        canvas.drawRightString(letter[0] - 0.7 * inch, 0.35 * inch, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    return _decorate


def _hero_metric(label: str, value: str, accent: bool = False) -> Table:
    # Keep the currency label glued to the first number chunk (e.g. "Rs. 2,466,801M") so it
    # never wraps onto its own line in the narrow card - a real layout bug seen with INR figures.
    value_nowrap = value.replace(" ", " ", 1)
    cell = Table(
        [[Paragraph(label, ParagraphStyle("HeroLabel", fontSize=7.5, textColor=MUTED_TEXT, leading=10))],
         [Paragraph(value_nowrap, ParagraphStyle("HeroValue", fontSize=12.5, textColor=ACCENT_COLOR if accent else INK_COLOR, fontName="Helvetica-Bold", leading=15))]],
        colWidths=[1.62 * inch],
    )
    cell.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), MUTED_FILL),
                ("BOX", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
                ("TOPPADDING", (0, 0), (-1, 0), 8),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
                ("TOPPADDING", (0, 1), (-1, 1), 0),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return cell


def generate_investment_report(
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
) -> None:
    label = _currency_label(company.currency)
    styles = getSampleStyleSheet()
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], spaceBefore=14, spaceAfter=6, textColor=NAVY_COLOR)
    h4 = ParagraphStyle("H4", parent=styles["Heading4"], spaceBefore=8, spaceAfter=3)
    body = ParagraphStyle("BodyX", parent=styles["BodyText"], fontSize=10, leading=14)
    small = ParagraphStyle("Small", parent=styles["BodyText"], fontSize=8, leading=11, textColor=MUTED_TEXT)
    cell_small = ParagraphStyle("CellSmall", parent=styles["BodyText"], fontSize=7.5, leading=10)

    doc = SimpleDocTemplate(
        path, pagesize=letter, topMargin=0.6 * inch, bottomMargin=0.75 * inch, leftMargin=0.7 * inch, rightMargin=0.7 * inch
    )
    story = []

    # ---------------------------------------------------------------- Header
    hero_title = Paragraph(
        _esc(company.name),
        ParagraphStyle("HeroTitle", fontSize=21, textColor=colors.white, fontName="Helvetica-Bold", leading=25),
    )
    hero_sub = Paragraph(
        f"{_esc(company.ticker or '')}  -  DCF Valuation &amp; Investment Summary",
        ParagraphStyle("HeroSub", fontSize=11.5, textColor=colors.HexColor("#B7AEF0"), fontName="Helvetica-Bold", leading=15),
    )
    _scale_note = "Crore/Lakh" if currency_format.is_india(company.currency, company.country) else "Millions"
    hero_meta = Paragraph(
        f"Company type: {_esc(company.company_type.value.title())} &nbsp;|&nbsp; Currency: {_esc(company.currency)} ({_scale_note}) "
        f"&nbsp;|&nbsp; Industry: {_esc(company.industry or 'n/a')} &nbsp;|&nbsp; Historical period: {hist.periods[0]}-{hist.periods[-1]}",
        ParagraphStyle("HeroMeta", fontSize=8.5, textColor=colors.HexColor("#9C97D6"), leading=12),
    )
    header_band = Table([[hero_title], [hero_sub], [hero_meta]], colWidths=[7.1 * inch])
    header_band.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), INK_COLOR),
                ("LEFTPADDING", (0, 0), (-1, -1), 18),
                ("RIGHTPADDING", (0, 0), (-1, -1), 18),
                ("TOPPADDING", (0, 0), (-1, 0), 16),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 3),
                ("TOPPADDING", (0, 1), (-1, 1), 0),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 6),
                ("TOPPADDING", (0, 2), (-1, 2), 0),
                ("BOTTOMPADDING", (0, 2), (-1, 2), 14),
            ]
        )
    )
    accent_bar = Table([[""]], colWidths=[7.1 * inch], rowHeights=[0.06 * inch])
    accent_bar.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), ACCENT_COLOR)]))
    story.append(header_band)
    story.append(accent_bar)
    story.append(Spacer(1, 14))

    # -------------------------------------------------------- Valuation summary
    per_share = valuation.equity_bridge.equity_value_per_share
    price = valuation.equity_bridge.current_share_price
    upside = valuation.equity_bridge.upside_downside

    hero_row1 = Table(
        [[
            _hero_metric("ENTERPRISE VALUE", _money(valuation.enterprise_value, company.currency, company.country, label)),
            _hero_metric("EQUITY VALUE", _money(valuation.equity_bridge.equity_value, company.currency, company.country, label)),
            _hero_metric("IMPLIED SHARE PRICE", _per_share(per_share, label), accent=True),
            _hero_metric("CURRENT SHARE PRICE", _per_share(price, label)),
        ]],
        colWidths=[1.6 * inch] * 4,
        spaceAfter=6,
    )
    hero_row1.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))

    hero_row2 = Table(
        [[
            _hero_metric("UPSIDE / (DOWNSIDE)", _pct(upside), accent=(upside is not None and upside > 0)),
            _hero_metric("WACC", _pct(wacc_result.wacc)),
            _hero_metric("TERMINAL GROWTH", _pct(valuation.terminal_growth)),
            _hero_metric("MODEL INTEGRITY", f"{integrity.score}/100"),
        ]],
        colWidths=[1.6 * inch] * 4,
    )
    hero_row2.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))

    story.append(KeepTogether([Paragraph("Valuation Summary", h2), hero_row1, Spacer(1, 6), hero_row2]))

    # ------------------------------------------------------------ Investment view
    story.append(Paragraph("Investment View", h2))
    if valuation.equity_bridge.equity_value < 0:
        warn_box = Table(
            [[Paragraph(
                "<b>Equity Value is negative.</b> Enterprise Value plus cash does not cover debt, lease "
                "liabilities, minority interest, and preferred stock combined. This can be legitimate for a "
                "distressed or heavily levered/minority-diluted company, but always verify the debt and "
                "minority interest figures independently before relying on the implied share price below.",
                ParagraphStyle("Warn", fontSize=9, leading=12, textColor=colors.HexColor("#7F1D1D")),
            )]],
            colWidths=[6.1 * inch],
        )
        warn_box.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FEF2F2")),
                    ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#FCA5A5")),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ]
            )
        )
        story.append(warn_box)
        story.append(Spacer(1, 8))
    if per_share and price:
        direction = "undervalued" if upside and upside > 0 else "overvalued"
        view_text = (
            f"At the Base Case DCF valuation of {label} {per_share:,.2f} per share, {_esc(company.name)} appears "
            f"approximately {abs(upside):.1%} {direction} relative to the current market price of {label} {price:,.2f}."
        )
    else:
        view_text = (
            f"The Base Case DCF valuation implies an Enterprise Value of "
            f"{_money(valuation.enterprise_value, company.currency, company.country, label)} "
            f"and an Equity Value of {_money(valuation.equity_bridge.equity_value, company.currency, company.country, label)}."
        )
    story.append(Paragraph(view_text, body))

    bull = scenarios.get("Bull Case")
    bear = scenarios.get("Bear Case")
    if bull:
        story.append(Paragraph("Key Upside Drivers", h4))
        for d in bull.definition.key_drivers:
            story.append(Paragraph(f"&bull; {_esc(d)}", body))
    if bear:
        story.append(Paragraph("Key Risks", h4))
        for d in bear.definition.key_drivers:
            story.append(Paragraph(f"&bull; {_esc(d)}", body))

    confidence = _confidence_label(integrity, valuation)
    story.append(Paragraph("Valuation Confidence", h4))
    story.append(
        Paragraph(
            f"<b>{confidence}.</b> Model integrity score {integrity.score}/100; terminal value represents "
            f"{_pct(valuation.terminal_value_pct_of_ev)} of Enterprise Value.",
            body,
        )
    )

    # --------------------------------------------------------- Historical trends
    trend_block = [Paragraph("Historical Performance", h2)]
    for line in summary.trend_commentary:
        trend_block.append(Paragraph(f"&bull; {_esc(line)}", body))
    trend_block.append(Spacer(1, 8))
    story.append(KeepTogether(trend_block))
    story.append(Image(_chart_revenue(hist, forecast), width=6.2 * inch, height=2.6 * inch))
    story.append(Spacer(1, 18))

    # -------------------------------------------------------------- Scenarios
    names = ["Bear Case", "Base Case", "Bull Case"]
    metric_defs = [
        ("Revenue CAGR", lambda s: _pct(s.revenue_cagr)),
        ("Terminal EBITDA Margin", lambda s: _pct(s.forecast.years[-1].ebitda_margin)),
        ("WACC", lambda s: _pct(s.wacc_result.wacc)),
        ("Terminal Growth", lambda s: _pct(s.terminal_growth)),
        ("Enterprise Value", lambda s: _money(s.valuation.enterprise_value, company.currency, company.country, label)),
        ("Equity Value", lambda s: _money(s.valuation.equity_bridge.equity_value, company.currency, company.country, label)),
    ]
    sc_rows = [["Metric", "Bear", "Base", "Bull"]] + [[m] + [fn(scenarios[n]) for n in names] for m, fn in metric_defs]
    t2 = Table(sc_rows, colWidths=[2 * inch] + [1.3 * inch] * 3)
    t2.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK_COLOR),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, MUTED_FILL]),
                ("GRID", (0, 0), (-1, -1), 0.4, BORDER_COLOR),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(KeepTogether([Paragraph("Scenario Analysis", h2), t2]))
    story.append(Spacer(1, 10))
    story.append(Image(_chart_scenarios(scenarios, price, label), width=6.2 * inch, height=2.3 * inch))
    story.append(Spacer(1, 18))

    # ------------------------------------------------------------ Sensitivity
    header = ["WACC \\ g"] + [f"{g:.1%}" for g in sensitivity_table.growth_range]
    rows = [header]
    for w in sensitivity_table.wacc_range:
        row = [f"{w:.1%}"]
        for g in sensitivity_table.growth_range:
            cell = sensitivity_table.value_at(w, g)
            v = cell.enterprise_value if cell and cell.enterprise_value == cell.enterprise_value else None
            row.append(f"{v:,.0f}" if v is not None else "n/a")
        rows.append(row)
    t3 = Table(rows, colWidths=[0.9 * inch] + [0.85 * inch] * len(sensitivity_table.growth_range))
    t3.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK_COLOR),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BACKGROUND", (0, 1), (0, -1), INK_COLOR),
                ("TEXTCOLOR", (0, 1), (0, -1), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.4, BORDER_COLOR),
                ("ALIGN", (1, 1), (-1, -1), "CENTER"),
            ]
        )
    )
    story.append(KeepTogether([Paragraph("Sensitivity: Enterprise Value (WACC vs. Terminal Growth)", h2), t3]))
    story.append(Spacer(1, 16))

    dr_rows = [["Driver", "EV Swing %"]] + [[d.driver_name, _pct(d.impact_range_pct)] for d in driver_ranking]
    t4 = Table(dr_rows, colWidths=[3.5 * inch, 1.5 * inch])
    t4.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK_COLOR),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, MUTED_FILL]),
                ("GRID", (0, 0), (-1, -1), 0.4, BORDER_COLOR),
            ]
        )
    )
    story.append(KeepTogether([Paragraph("Ranked Valuation Drivers", h2), t4]))
    story.append(Spacer(1, 18))

    # ----------------------------------------------------------- Assumptions
    a = forecast.assumptions
    key_assumptions = [a.revenue_growth[0], a.revenue_growth[-1], a.capex_pct_revenue[0], a.nwc_pct_revenue[0], a.tax_rate[0]]
    wacc_inputs = wacc_result.inputs
    key_assumptions += [wacc_inputs.risk_free_rate, wacc_inputs.beta, wacc_inputs.equity_risk_premium, wacc_inputs.pretax_cost_of_debt]

    assum_rows = [["Assumption", "Period", "Value", "Source", "Rationale"]]
    for x in key_assumptions:
        value_str = f"{x.effective_value:.2f}" if x.name == "Beta" else f"{x.effective_value:.1%}"
        assum_rows.append([x.name, x.period or "-", value_str, x.source.value, Paragraph(_esc(x.rationale), cell_small)])
    t5 = Table(assum_rows, colWidths=[1.2 * inch, 0.7 * inch, 0.7 * inch, 1.1 * inch, 2.5 * inch])
    t5.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK_COLOR),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, MUTED_FILL]),
                ("GRID", (0, 0), (-1, -1), 0.4, BORDER_COLOR),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(KeepTogether([Paragraph("Key Assumptions", h2), t5]))
    story.append(Spacer(1, 16))

    # ------------------------------------------------------------ Model quality
    story.append(KeepTogether([Paragraph("Model Quality &amp; Data Notes", h2), Paragraph(_esc(integrity.summary), body)]))
    for issue in integrity.issues:
        story.append(Paragraph(f"[{issue.severity.upper()}] {_esc(issue.message)}", small))

    story.append(Spacer(1, 14))
    story.append(HRFlowable(width="100%", color=BORDER_COLOR))
    story.append(
        Paragraph(
            "This report is generated by an automated DCF modeling tool for research purposes. Every figure above "
            "traces back to the assumptions and sources shown in the companion Excel workbook. This is not "
            "investment advice.",
            small,
        )
    )

    page_decorator = _make_page_decorator(company.name)
    doc.build(story, onFirstPage=page_decorator, onLaterPages=page_decorator)
