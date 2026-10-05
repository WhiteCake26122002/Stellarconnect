"""Yahoo helpers that do not import Streamlit."""
from __future__ import annotations

import yfinance as yf

REFERENCE_RATES: dict[str, tuple[float, str]] = {
    "USD": (0.043, "US 10Y Treasury"),
    "INR": (0.069, "India 10Y G-Sec (RBI)"),
    "EUR": (0.024, "Germany 10Y Bund (ECB proxy)"),
    "GBP": (0.043, "UK 10Y Gilt (DMO)"),
    "JPY": (0.014, "Japan 10Y JGB (BoJ)"),
    "CNY": (0.018, "China 10Y Govt Bond (PBoC)"),
    "CAD": (0.033, "Canada 10Y Govt Bond"),
    "AUD": (0.043, "Australia 10Y Govt Bond"),
    "CHF": (0.006, "Switzerland 10Y Govt Bond"),
    "BRL": (0.115, "Brazil 10Y Govt Bond"),
    "ZAR": (0.095, "South Africa 10Y Govt Bond"),
    "KRW": (0.029, "South Korea 10Y Govt Bond"),
    "SGD": (0.026, "Singapore 10Y Govt Bond (MAS)"),
    "HKD": (0.035, "Hong Kong 10Y Govt Bond"),
    "IDR": (0.068, "Indonesia 10Y Govt Bond"),
    "MXN": (0.095, "Mexico 10Y Govt Bond"),
}
MATURE_MARKET_FALLBACK = (0.040, "mature-market reference (no per-currency data on file)")


def search_equities(query: str, limit: int = 6) -> list[dict]:
    query = query.strip()
    if len(query) < 2:
        return []
    try:
        results = yf.Search(query, max_results=limit, raise_errors=False).quotes
    except Exception:
        return []
    matches = []
    for r in results:
        if r.get("quoteType") != "EQUITY":
            continue
        symbol = r.get("symbol")
        name = r.get("longname") or r.get("shortname")
        if not symbol or not name:
            continue
        matches.append({"symbol": symbol, "name": name, "exchange": r.get("exchDisp") or r.get("exchange") or ""})
    return _annotate_listings(matches)


def _listing_meta(symbol: str, exchange: str) -> tuple[str, str]:
    sym = (symbol or "").upper()
    if sym.endswith(".NS"):
        return "NSE, INR", "INR"
    if sym.endswith(".BO"):
        return "BSE, INR", "INR"
    exch = exchange or "listed"
    if exch.upper() in {"NMS", "NGM", "NCM", "NYQ", "NYSE", "NASDAQ", "NASDAQGS", "NASDAQGM", "NASDAQCM"}:
        return f"{exch}, USD", "USD"
    return exch, ""


def _annotate_listings(matches: list[dict]) -> list[dict]:
    symbols = {str(m.get("symbol") or "").upper() for m in matches}
    out: list[dict] = []
    for m in matches:
        symbol = str(m.get("symbol") or "")
        listing, currency = _listing_meta(symbol, str(m.get("exchange") or ""))
        nse_eq = None
        if "." not in symbol:
            twin = f"{symbol.upper()}.NS"
            if twin in symbols:
                nse_eq = twin
                if currency == "USD":
                    listing = f"{m.get('exchange') or 'US'} — ADR/local-currency listing (not NSE)"
        out.append({**m, "listing": listing, "currency": currency, "nse_equivalent": nse_eq})
    return out


def fetch_beta(ticker: str) -> float | None:
    if not ticker or not ticker.strip():
        return None
    try:
        value = yf.Ticker(ticker.strip()).info.get("beta")
        if value is None:
            return None
        value = float(value)
        if value <= 0 or value > 5:
            return None
        return value
    except Exception:
        return None


def _live_10y_us_treasury() -> float | None:
    try:
        fi = yf.Ticker("^TNX").fast_info
        return float(fi["last_price"]) / 100
    except Exception:
        return None


def resolve_risk_free_rate(currency: str, *, live: bool = True) -> tuple[float, str]:
    code = (currency or "USD").upper()
    if code == "USD" and live:
        live_rate = _live_10y_us_treasury()
        if live_rate is not None:
            return live_rate, "Live: 10Y US Treasury yield (^TNX), Yahoo Finance"
    if code in REFERENCE_RATES:
        rate, label = REFERENCE_RATES[code]
        return rate, f"Reference: {label} - dated snapshot, override if you have a fresher number"
    rate, label = MATURE_MARKET_FALLBACK
    return rate, f"Reference: {label}"
