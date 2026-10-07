"""
Which index a fund should be compared with, and where its history comes from.

Not every fund is a Nifty 500 fund. A small-cap fund measured against the Nifty 500 (or a debt fund
against any equity index) produces a confident-looking number that means nothing, so each scheme is
mapped from its AMFI category, and its name where the category says "Index Fund". When there is no
sound mapping the answer is "no benchmark", with the reason, never a silent default.

Only indices whose daily history is actually obtainable are listed. Yahoo's index series are *price*
indices (they exclude dividends), which understates a total-return benchmark slightly; the UI says so.
"""
from __future__ import annotations

__all__ = ["INDEX_TICKERS", "REFERENCE_BENCHMARKS", "benchmark_for", "PRICE_BASIS_NOTE"]

PRICE_BASIS_NOTE = "Price index: excludes dividends, so a total-return benchmark would read slightly higher."

# key -> (yahoo ticker, display label)
INDEX_TICKERS: dict[str, tuple[str, str]] = {
    "NIFTY 50": ("^NSEI", "Nifty 50"),
    "NIFTY NEXT 50": ("^NSMIDCP", "Nifty Next 50"),
    "NIFTY 100": ("^CNX100", "Nifty 100"),
    "NIFTY 200": ("^CNX200", "Nifty 200"),
    "NIFTY 500": ("^CRSLDX", "Nifty 500"),
    "NIFTY MIDCAP 150": ("NIFTYMIDCAP150.NS", "Nifty Midcap 150"),
    "NIFTY SMALLCAP 250": ("NIFTYSMLCAP250.NS", "Nifty Smallcap 250"),
    "NIFTY BANK": ("^NSEBANK", "Nifty Bank"),
    "NIFTY IT": ("^CNXIT", "Nifty IT"),
    "NIFTY PHARMA": ("^CNXPHARMA", "Nifty Pharma"),
}

# Broad-market reference lines drawn for the portfolio as a whole (not any one fund's own benchmark).
REFERENCE_BENCHMARKS = ("NIFTY 50", "NIFTY 500")

_NO_DEBT = "No free debt-index history is available, so this fund is not compared with an equity index."
_NO_HYBRID = "A hybrid fund's blended benchmark has no free history here, and an equity index would mislead."
_NO_OTHER = "No suitable benchmark history is available for this kind of scheme."


def _pick(key: str, *, proxy: bool = False, note: str = "") -> dict:
    ticker, label = INDEX_TICKERS[key]
    return {"key": key, "ticker": ticker, "label": label, "proxy": proxy, "note": note, "reason": None}


def _none(reason: str) -> dict:
    return {"key": None, "ticker": None, "label": None, "proxy": False, "note": "", "reason": reason}


def _index_fund(name: str) -> dict | None:
    n = name.lower()
    if "next 50" in n:
        return _pick("NIFTY NEXT 50")
    if "midcap 150" in n or "mid cap 150" in n:
        return _pick("NIFTY MIDCAP 150")
    if "smallcap 250" in n or "small cap 250" in n:
        return _pick("NIFTY SMALLCAP 250")
    if "nifty 500" in n:
        return _pick("NIFTY 500")
    if "nifty 100" in n:
        return _pick("NIFTY 100")
    if "nifty 200" in n:
        return _pick("NIFTY 200")
    if "nifty bank" in n:
        return _pick("NIFTY BANK")
    if "nifty it" in n or "nifty it " in n:
        return _pick("NIFTY IT")
    if "nifty 50" in n or "nifty50" in n:
        return _pick("NIFTY 50")
    return None


def benchmark_for(scheme_category: str, scheme_name: str = "") -> dict:
    """
    {"key", "ticker", "label", "proxy", "note", "reason"}. `key` is None when there is no sound
    benchmark; `reason` then says why. `proxy` marks a stand-in for the fund's official index.
    """
    c = (scheme_category or "").lower()
    n = (scheme_name or "").lower()

    if "index" in c or "etf" in c or "index fund" in n:
        mapped = _index_fund(scheme_name)
        if mapped:
            return mapped
        return _none("This index fund tracks an index with no free history here.")

    if "debt" in c or "liquid" in c or "money market" in c or "gilt" in c or "overnight" in c:
        return _none(_NO_DEBT)
    if "hybrid" in c or "arbitrage" in c or "multi asset" in c or "balanced" in c:
        return _none(_NO_HYBRID)

    if "sectoral" in c or "thematic" in c:
        if "bank" in n or "financial" in n:
            return _pick("NIFTY BANK", proxy=True, note="Stand-in for the fund's financial-services index.")
        if "technology" in n or "digital" in n or "infotech" in n or " it " in f" {n} ":
            return _pick("NIFTY IT")
        if "pharma" in n or "health" in n:
            return _pick("NIFTY PHARMA", proxy=True, note="Stand-in for the fund's healthcare index.")
        return _pick("NIFTY 500", proxy=True, note="The fund's own thematic index has no free history here; the broad market is a stand-in.")

    if "large & mid" in c or "large and mid" in c:
        return _pick("NIFTY 200", proxy=True, note="Stand-in: the Nifty LargeMidcap 250 has no free history here.")
    if "large cap" in c:
        return _pick("NIFTY 100")
    if "mid cap" in c:
        return _pick("NIFTY MIDCAP 150")
    if "small cap" in c:
        return _pick("NIFTY SMALLCAP 250")
    if any(k in c for k in ("flexi", "multi cap", "elss", "focused", "value", "contra", "dividend yield")):
        return _pick("NIFTY 500")
    if "equity" in c:
        return _pick("NIFTY 500", proxy=True, note="Broad-market stand-in for an equity category with no specific index.")
    return _none(_NO_OTHER)
