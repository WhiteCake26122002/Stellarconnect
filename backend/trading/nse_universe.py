"""
NSE listed-equity universe for the paper-trading desk.

Sources (official, unauthenticated CSVs):
- niftyindices.com IndexConstituent files (NSE Indices)
- NSE EQUITY_L.csv (full listed equity board)

Yahoo Finance is used only as the quote/OHLC feed (`SYMBOL.NS`), not as the
constituent source. Index composition changes at most quarterly, so a 24-hour
cache is enough. A failed fetch never raises into the request path: callers
get the last good snapshot, or an empty stock list plus the desk's core
instruments.
"""
from __future__ import annotations

import csv
import io
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable

import requests

UNIVERSE_TTL_SECONDS = 24 * 3600
FETCH_TIMEOUT_SECONDS = 12.0
MAX_WORKERS = 6
_HEADERS = {"User-Agent": "Mozilla/5.0"}

INDEX_CSV_URLS: dict[str, str] = {
    "Nifty 50": "https://niftyindices.com/IndexConstituent/ind_nifty50list.csv",
    "Nifty Next 50": "https://niftyindices.com/IndexConstituent/ind_niftynext50list.csv",
    "Nifty 100": "https://niftyindices.com/IndexConstituent/ind_nifty100list.csv",
    "Nifty Midcap 50": "https://niftyindices.com/IndexConstituent/ind_niftymidcap50list.csv",
    "Nifty Midcap 100": "https://niftyindices.com/IndexConstituent/ind_niftymidcap100list.csv",
    "Nifty Midcap 150": "https://niftyindices.com/IndexConstituent/ind_niftymidcap150list.csv",
    "Nifty LargeMidcap 250": "https://niftyindices.com/IndexConstituent/ind_niftylargemidcap250list.csv",
    "Nifty Smallcap 50": "https://niftyindices.com/IndexConstituent/ind_niftysmallcap50list.csv",
    "Nifty Smallcap 100": "https://niftyindices.com/IndexConstituent/ind_niftysmallcap100list.csv",
    "Nifty Smallcap 250": "https://niftyindices.com/IndexConstituent/ind_niftysmallcap250list.csv",
    "Nifty Microcap 250": "https://niftyindices.com/IndexConstituent/ind_niftymicrocap250_list.csv",
    "Nifty MidSmallcap 400": "https://niftyindices.com/IndexConstituent/ind_niftymidsmallcap400list.csv",
    "Nifty 500": "https://niftyindices.com/IndexConstituent/ind_nifty500list.csv",
    "Nifty Total Market": "https://niftyindices.com/IndexConstituent/ind_niftytotalmarket_list.csv",
    "Nifty Bank": "https://niftyindices.com/IndexConstituent/ind_niftybanklist.csv",
    "Nifty IT": "https://niftyindices.com/IndexConstituent/ind_niftyitlist.csv",
}

# NSE does not publish a "Nifty Midcap 250". LargeMidcap 250 is the 250-name
# mid/large blend; Midcap 150 is ranks 101-250 by market cap.
INDEX_ALIASES: dict[str, str] = {
    "Nifty Midcap 250": "Nifty LargeMidcap 250",
    "NIFTY MIDCAP 250": "Nifty LargeMidcap 250",
    "MIDCAP250": "Nifty LargeMidcap 250",
    "Nifty Smallcap": "Nifty Smallcap 250",
    "NIFTY SMALLCAP": "Nifty Smallcap 250",
    "SMALLCAP": "Nifty Smallcap 250",
}

NSE_EQUITY_LIST_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"

INDEX_SIZE_HINTS: dict[str, tuple[int, int]] = {
    "Nifty 50": (45, 55),
    "Nifty Next 50": (45, 55),
    "Nifty 100": (95, 105),
    "Nifty Midcap 50": (45, 55),
    "Nifty Midcap 100": (95, 110),
    "Nifty Midcap 150": (140, 160),
    "Nifty LargeMidcap 250": (240, 260),
    "Nifty Smallcap 50": (45, 55),
    "Nifty Smallcap 100": (95, 110),
    "Nifty Smallcap 250": (240, 270),
    "Nifty Microcap 250": (240, 270),
    "Nifty MidSmallcap 400": (380, 420),
    "Nifty 500": (480, 520),
    "Nifty Total Market": (700, 900),
    "Nifty Bank": (10, 16),
    "Nifty IT": (8, 16),
}

Fetcher = Callable[[str], str]

_lock = threading.Lock()
_cache: tuple[float, dict] | None = None


def _http_get(url: str) -> str:
    resp = requests.get(url, headers=_HEADERS, timeout=FETCH_TIMEOUT_SECONDS)
    resp.raise_for_status()
    return resp.text


def _norm_row(row: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in row.items():
        if key is None:
            continue
        out[str(key).strip()] = str(value).strip() if value is not None else ""
    return out


def parse_index_csv(text: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    reader = csv.DictReader(io.StringIO(text))
    for raw in reader:
        row = _norm_row(raw)
        symbol = (row.get("Symbol") or row.get("SYMBOL") or "").upper()
        if not symbol or symbol.startswith("DUMMY"):
            continue
        rows.append(
            {
                "symbol": symbol,
                "name": row.get("Company Name") or row.get("Company") or symbol,
                "industry": row.get("Industry") or "",
            }
        )
    return rows


def parse_equity_list_csv(text: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    reader = csv.DictReader(io.StringIO(text))
    for raw in reader:
        row = _norm_row(raw)
        symbol = (row.get("SYMBOL") or "").upper()
        if not symbol or symbol.startswith("DUMMY"):
            continue
        series = (row.get("SERIES") or "").upper()
        if series and series not in {"EQ", "BE", "BZ", "SM"}:
            continue
        lot_raw = row.get("MARKET LOT") or "1"
        try:
            lot = max(1, int(float(lot_raw)))
        except ValueError:
            lot = 1
        rows.append(
            {
                "symbol": symbol,
                "name": row.get("NAME OF COMPANY") or symbol,
                "series": series or "EQ",
                "isin": row.get("ISIN NUMBER") or "",
                "lot_size": str(lot),
            }
        )
    return rows


def canonical_index_name(name: str) -> str | None:
    needle = (name or "").strip()
    if not needle:
        return None
    if needle in INDEX_CSV_URLS:
        return needle
    alias = INDEX_ALIASES.get(needle) or INDEX_ALIASES.get(needle.upper())
    if alias:
        return alias
    lower = needle.casefold()
    for official in INDEX_CSV_URLS:
        if official.casefold() == lower:
            return official
    return None


def _fetch_one(fetcher: Fetcher, name: str, url: str) -> tuple[str, list[dict[str, str]]]:
    try:
        text = fetcher(url)
        return name, parse_index_csv(text) if name != "__equity__" else parse_equity_list_csv(text)
    except Exception as exc:
        print(f"[nse_universe] fetch({name!r}) failed: {type(exc).__name__}: {exc}")
        return name, []


def build_universe(fetcher: Fetcher | None = None) -> dict:
    get = fetcher or _http_get
    index_rows: dict[str, list[dict[str, str]]] = {}
    equity_rows: list[dict[str, str]] = []

    jobs: list[tuple[str, str]] = [(name, url) for name, url in INDEX_CSV_URLS.items()]
    jobs.append(("__equity__", NSE_EQUITY_LIST_URL))

    with ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="nse-univ") as pool:
        futs = {pool.submit(_fetch_one, get, name, url): name for name, url in jobs}
        for fut in as_completed(futs):
            name, rows = fut.result()
            if name == "__equity__":
                equity_rows = rows
            else:
                index_rows[name] = rows

    by_symbol: dict[str, dict] = {}

    def upsert(symbol: str, name: str, industry: str = "", lot_size: int = 1, series: str = "EQ") -> dict:
        row = by_symbol.get(symbol)
        if row is None:
            row = {
                "symbol": symbol,
                "name": name,
                "industry": industry,
                "exchange": "NSE",
                "asset_class": "stock",
                "currency": "INR",
                "lot_size": lot_size,
                "series": series,
                "indices": [],
            }
            by_symbol[symbol] = row
        else:
            if name and (row["name"] == row["symbol"] or len(name) > len(row["name"])):
                row["name"] = name
            if industry and not row["industry"]:
                row["industry"] = industry
            if lot_size > 1:
                row["lot_size"] = lot_size
            if series:
                row["series"] = series
        return row

    for eq in equity_rows:
        try:
            lot = int(eq.get("lot_size") or 1)
        except ValueError:
            lot = 1
        upsert(eq["symbol"], eq["name"], lot_size=lot, series=eq.get("series") or "EQ")

    membership: dict[str, list[str]] = {name: [] for name in INDEX_CSV_URLS}
    for index_name, rows in index_rows.items():
        seen: set[str] = set()
        for row in rows:
            symbol = row["symbol"]
            if symbol in seen:
                continue
            seen.add(symbol)
            item = upsert(symbol, row["name"], row.get("industry") or "")
            if index_name not in item["indices"]:
                item["indices"].append(index_name)
            membership[index_name].append(symbol)

    items = sorted(by_symbol.values(), key=lambda r: r["symbol"])
    indices = [
        {"name": name, "count": len(membership[name]), "symbols": membership[name]}
        for name in INDEX_CSV_URLS
    ]
    source_bits = []
    if equity_rows:
        source_bits.append("nse-equity-list")
    if any(membership.values()):
        source_bits.append("niftyindices")
    return {
        "source": "+".join(source_bits) or "unavailable",
        "fetched_at": int(time.time()),
        "stale": not bool(items),
        "indices": indices,
        "items": items,
    }


def get_universe(*, force: bool = False, fetcher: Fetcher | None = None) -> dict:
    global _cache
    now = time.time()
    with _lock:
        if not force and _cache and now - _cache[0] < UNIVERSE_TTL_SECONDS:
            return _cache[1]
    payload = build_universe(fetcher)
    if payload["items"] or _cache is None:
        with _lock:
            _cache = (time.time(), payload)
        return payload
    return _cache[1]


def reset_universe_cache() -> None:
    global _cache
    with _lock:
        _cache = None


def search_universe(
    payload: dict,
    *,
    q: str = "",
    index: str | None = None,
    limit: int = 4000,
) -> dict:
    limit = max(1, min(int(limit), 4000))
    needle = (q or "").strip().casefold()
    allowed: set[str] | None = None
    index_name = None
    if index:
        index_name = canonical_index_name(index)
        if index_name:
            for entry in payload.get("indices") or []:
                if entry["name"] == index_name:
                    allowed = set(entry.get("symbols") or [])
                    break
            if allowed is None:
                allowed = set()
        else:
            allowed = set()

    hits = []
    for item in payload.get("items") or []:
        if allowed is not None and item["symbol"] not in allowed:
            continue
        if needle:
            blob = " ".join(
                [
                    item["symbol"],
                    item.get("name") or "",
                    item.get("industry") or "",
                    " ".join(item.get("indices") or []),
                ]
            ).casefold()
            if needle not in blob:
                continue
        hits.append(
            {
                "symbol": item["symbol"],
                "name": item["name"],
                "industry": item.get("industry") or "",
                "exchange": "NSE",
                "asset_class": "stock",
                "currency": "INR",
                "lot_size": item.get("lot_size") or 1,
                "indices": item.get("indices") or [],
            }
        )
        if len(hits) >= limit:
            break

    index_meta = [
        {"name": entry["name"], "count": entry["count"]}
        for entry in payload.get("indices") or []
    ]
    return {
        "source": payload.get("source") or "unavailable",
        "fetched_at": payload.get("fetched_at") or 0,
        "stale": bool(payload.get("stale")),
        "index": index_name,
        "q": q,
        "count": len(hits),
        "indices": index_meta,
        "items": hits,
    }
