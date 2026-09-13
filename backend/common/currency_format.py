"""
Shared currency/scale display formatting, used by the Streamlit UI and the PDF
report (the Excel export deliberately keeps its own millions-based formatting -
see excel_export.py's module docstring for why).

This is presentation-only: every value handed in here is still the engine's own
millions-of-reporting-currency figure (see backend/engine/models.py's Company
docstring) - nothing here changes what gets computed, only how it's displayed.
Indian company figures are shown in Lakhs/Crores (the convention Indian
financial figures are actually read in); everything else stays in Millions.
"""
from __future__ import annotations

CURRENCY_SYMBOLS = {"USD": "$", "INR": "₹", "EUR": "€", "GBP": "£", "JPY": "¥", "CNY": "¥"}

CRORE_IN_MILLIONS = 10.0  # 1 crore = 1,00,00,000 = 10 million
LAKH_IN_MILLIONS = 0.1  # 1 lakh = 1,00,000 = 0.1 million


def currency_symbol(currency: str) -> str:
    code = (currency or "USD").upper()
    return CURRENCY_SYMBOLS.get(code, code + " ")


def is_india(currency: str, country: str = "") -> bool:
    return (currency or "").upper() == "INR" or (country or "").strip().lower() == "india"


def scale_label(currency: str, country: str = "") -> str:
    if is_india(currency, country):
        return "₹ Crore/Lakh"
    return f"{currency_symbol(currency)} Millions"


def format_scaled_money(value_millions: float | None, currency: str, country: str = "", symbol_override: str | None = None) -> str:
    """A whole-company monetary figure (already in millions of the reporting currency),
    formatted per local convention: Crore/Lakh for India, Millions everywhere else.

    `symbol_override` lets a caller substitute an ASCII-safe label (e.g. "Rs." instead of
    "₹") for a renderer that can't display the real currency glyph - see pdf_report.py -
    without duplicating the Crore/Lakh/Millions scale math itself."""
    if value_millions is None:
        return "n/a"
    symbol = symbol_override if symbol_override is not None else currency_symbol(currency)
    if is_india(currency, country):
        crores = value_millions / CRORE_IN_MILLIONS
        if abs(crores) >= 1:
            return f"{symbol}{crores:,.2f} Cr"
        lakhs = value_millions / LAKH_IN_MILLIONS
        return f"{symbol}{lakhs:,.2f} L"
    return f"{symbol}{round(value_millions):,}M"


def format_per_share(value: float | None, currency: str, symbol_override: str | None = None) -> str:
    """A per-share price - never scaled to Crore/Lakh/Millions, just currency-symbol + 2dp."""
    if value is None:
        return "n/a"
    symbol = symbol_override if symbol_override is not None else currency_symbol(currency)
    return f"{symbol}{value:,.2f}"
