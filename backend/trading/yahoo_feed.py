"""
Streamlit-free Yahoo market feed for the FastAPI terminal.

Same source the DCF engine already uses (yfinance). Quotes are cached ~45s
server-side so a desk of clients does not hammer Yahoo. Heatmap and world
downloads run in parallel on a dedicated pool; stale cache is served while a
refresh runs. Failures return empty payloads rather than raising — the client
keeps simulated candles.
"""
from __future__ import annotations

import concurrent.futures
import threading
import time
from typing import Any, Callable, TypeVar

import pandas as pd
import yfinance as yf

QUOTE_TTL_SECONDS = 45
OHLC_TTL_INTRADAY = 30
OHLC_TTL_DAILY = 3600
HEATMAP_TTL_SECONDS = 90
FINANCIALS_TTL_SECONDS = 3600
MARKET_CAP_TTL_SECONDS = 3600
FETCH_TIMEOUT_SECONDS = 8.0
BATCH_QUOTE_TIMEOUT_SECONDS = 18.0
HEATMAP_TIMEOUT_SECONDS = 12.0
WORLD_TIMEOUT_SECONDS = 10.0
FINANCIALS_TIMEOUT_SECONDS = 40.0
MAX_QUOTE_SYMBOLS = 300
QUOTE_CHUNK = 50
MAX_CANDLES = 2500
MAX_HEATMAP_TILES = 250
HEATMAP_DOWNLOAD_CHUNK = 50
QUOTE_DOWNLOAD_CHUNK = 40
HEATMAP_RANGES: dict[str, int] = {"D": 1, "W": 5, "M": 21, "Y": 252}

INCOME_ROWS: list[tuple[str, str, list[str]]] = [
    ("revenue", "Revenue", ["Total Revenue", "Operating Revenue"]),
    ("cogs", "Cost of revenue", ["Cost Of Revenue", "Reconciled Cost Of Revenue"]),
    ("gross_profit", "Gross profit", ["Gross Profit"]),
    ("operating_income", "Operating income", ["Operating Income"]),
    ("ebit", "EBIT", ["EBIT", "Ebit"]),
    ("ebitda", "EBITDA", ["EBITDA", "Normalized EBITDA"]),
    ("interest", "Interest expense", ["Interest Expense", "Interest Expense Non Operating"]),
    ("pretax", "Profit before tax", ["Pretax Income"]),
    ("tax", "Tax", ["Tax Provision"]),
    ("net_income", "Net income", ["Net Income", "Net Income Common Stockholders"]),
    ("eps", "Diluted EPS", ["Diluted EPS", "Basic EPS"]),
]

BALANCE_ROWS: list[tuple[str, str, list[str]]] = [
    ("cash", "Cash", ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"]),
    ("current_assets", "Current assets", ["Current Assets"]),
    ("total_assets", "Total assets", ["Total Assets"]),
    ("current_liabilities", "Current liabilities", ["Current Liabilities"]),
    ("total_debt", "Total debt", ["Total Debt"]),
    ("total_liabilities", "Total liabilities", ["Total Liabilities Net Minority Interest", "Total Liabilities"]),
    ("equity", "Shareholders' equity", ["Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"]),
    ("retained", "Retained earnings", ["Retained Earnings"]),
    ("working_capital", "Working capital", ["Working Capital"]),
]

CASHFLOW_ROWS: list[tuple[str, str, list[str]]] = [
    ("ocf", "Operating cash flow", ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"]),
    ("capex", "Capital expenditure", ["Capital Expenditure"]),
    ("fcf", "Free cash flow", ["Free Cash Flow"]),
    ("icf", "Investing cash flow", ["Investing Cash Flow", "Cash Flow From Continuing Investing Activities"]),
    ("fcf_fin", "Financing cash flow", ["Financing Cash Flow", "Cash Flow From Continuing Financing Activities"]),
    ("dividends", "Dividends paid", ["Cash Dividends Paid", "Common Stock Dividend Paid"]),
    ("buyback", "Share issuance/(buyback)", ["Repurchase Of Capital Stock", "Net Common Stock Issuance"]),
    ("net_change", "Net change in cash", ["Changes In Cash", "Change In Cash Supplemental As Reported"]),
]

T = TypeVar("T")

YAHOO_SYMBOLS: dict[str, str] = {
    "NIFTY": "^NSEI",
    "BANKNIFTY": "^NSEBANK",
    "SENSEX": "^BSESN",
    "FINNIFTY": "NIFTY_FIN_SERVICE.NS",
    "CNXIT": "^CNXIT",
    "CNXAUTO": "^CNXAUTO",
    "CNXPHARMA": "^CNXPHARMA",
    "CNXMETAL": "^CNXMETAL",
    "CNXMIDCAP": "NIFTYMIDCAP150.NS",
    "CNXSMALLCAP": "NIFTYSMLCAP250.NS",
    "CNX500": "^CRSLDX",
    "RELIANCE": "RELIANCE.NS",
    "TCS": "TCS.NS",
    "INFY": "INFY.NS",
    "HDFCBANK": "HDFCBANK.NS",
    "ICICIBANK": "ICICIBANK.NS",
    "SBIN": "SBIN.NS",
    "ITC": "ITC.NS",
    "BHARTIARTL": "BHARTIARTL.NS",
    "LT": "LT.NS",
    "HINDUNILVR": "HINDUNILVR.NS",
    "NIFTYBEES": "NIFTYBEES.NS",
    "BANKBEES": "BANKBEES.NS",
    "GOLDBEES": "GOLDBEES.NS",
    "GOLD": "GC=F",
    "SILVER": "SI=F",
    "CRUDEOIL": "CL=F",
    "USDINR": "INR=X",
    "EURUSD": "EURUSD=X",
    "BTCUSD": "BTC-USD",
    "ETHUSD": "ETH-USD",
    "SPX": "^GSPC",
    "N225": "^N225",
    "FTSE": "^FTSE",
    "DAX": "^GDAXI",
    "CAC": "^FCHI",
    "SSEC": "000001.SS",
    "HSI": "^HSI",
    "KS11": "^KS11",
    "AXJO": "^AXJO",
    "BVSP": "^BVSP",
    "GSPTSE": "^GSPTSE",
    "TWII": "^TWII",
    "FTMIB": "FTSEMIB.MI",
    "IBEX": "^IBEX",
    "AEX": "^AEX",
    "SSMI": "^SSMI",
    "MXX": "^MXX",
    "JKSE": "^JKSE",
    "STI": "^STI",
    "J203": "^J203.JO",
    "TASI": "^TASI.SR",
    "XU100": "XU100.IS",
    "WIG20": "WIG20.WA",
    "OMX": "^OMX",
    "OSEBX": "OSEBX.OL",
    "BFX": "^BFX",
    "ATX": "^ATX",
    "PSI20": "PSI20.LS",
    "ASE": "GD.AT",
    "ISEQ": "^ISEQ",
    "NZ50": "^NZ50",
    "IPSA": "SPIPSA.SN",
    "MERV": "^MERV",
    "SET": "^SET.BK",
    "KLSE": "^KLSE",
    "PSEI": "PSEI.PS",
    "TA35": "TA35.TA",
    "EGX30": "^CASE30",
    "IMOEX": "IMOEX.ME",
}

WORLD_INDEX_DESKS: tuple[str, ...] = (
    "SPX",
    "NIFTY",
    "N225",
    "FTSE",
    "DAX",
    "CAC",
    "SSEC",
    "HSI",
    "KS11",
    "AXJO",
    "BVSP",
    "GSPTSE",
    "TWII",
    "FTMIB",
    "IBEX",
    "AEX",
    "SSMI",
    "MXX",
    "JKSE",
    "STI",
    "J203",
    "TASI",
    "XU100",
    "WIG20",
    "OMX",
    "OSEBX",
    "BFX",
    "ATX",
    "PSI20",
    "ASE",
    "ISEQ",
    "NZ50",
    "IPSA",
    "MERV",
    "SET",
    "KLSE",
    "PSEI",
    "TA35",
    "EGX30",
    "IMOEX",
)

# Desk timeframe -> (yfinance interval, period). Seconds bars have no Yahoo
# interval; callers should keep simulated history and overlay the live last.
TIMEFRAME_PRESETS: dict[str, tuple[str, str]] = {
    "1m": ("1m", "5d"),
    "5m": ("5m", "60d"),
    "15m": ("15m", "60d"),
    "30m": ("30m", "60d"),
    "1H": ("60m", "2y"),
    "4H": ("60m", "2y"),
    "1D": ("1d", "5y"),
    "1W": ("1wk", "10y"),
    "1M": ("1mo", "max"),
}

_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = threading.Lock()
_quote_by_symbol: dict[str, tuple[float, dict]] = {}
_refreshing: set[str] = set()
_pool = concurrent.futures.ThreadPoolExecutor(max_workers=16, thread_name_prefix="yf-feed")
_map_pool = concurrent.futures.ThreadPoolExecutor(max_workers=8, thread_name_prefix="yf-map")
_fin_pool = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="yf-fin")


def yahoo_symbol(desk_symbol: str) -> str | None:
    symbol = (desk_symbol or "").strip().upper()
    if not symbol:
        return None
    if symbol in YAHOO_SYMBOLS:
        return YAHOO_SYMBOLS[symbol]
    if symbol.endswith((".NS", ".BO", "=X", "=F", "-USD")) or symbol.startswith("^"):
        return symbol
    if any(ch.isdigit() for ch in symbol) and (symbol.endswith("CE") or symbol.endswith("PE") or "FUT" in symbol):
        return None
    return f"{symbol}.NS"


def overlay_last(candles: list[dict], last: float) -> list[dict]:
    if not candles or last <= 0:
        return candles
    out = [dict(c) for c in candles]
    bar = out[-1]
    bar["c"] = last
    bar["h"] = max(float(bar.get("h") or last), last)
    bar["l"] = min(float(bar.get("l") or last), last)
    out[-1] = bar
    return out


def _cached(
    key: str,
    ttl: float,
    fn: Callable[[], T],
    ttl_fn: Callable[[T], float] | None = None,
    stale_for: float = 0.0,
) -> T:
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit:
            ts, value, *rest = hit
            until = rest[0] if rest else ttl
            age = now - ts
            if age < until:
                return value
            if stale_for > 0 and age < until + stale_for:
                if key not in _refreshing:
                    _refreshing.add(key)

                    def refresh() -> None:
                        try:
                            nxt = fn()
                            keep = ttl_fn(nxt) if ttl_fn else ttl
                            with _cache_lock:
                                _cache[key] = (time.time(), nxt, keep)
                        finally:
                            with _cache_lock:
                                _refreshing.discard(key)

                    threading.Thread(target=refresh, name=f"yf-swr-{key[:20]}", daemon=True).start()
                return value
    value = fn()
    keep = ttl_fn(value) if ttl_fn else ttl
    with _cache_lock:
        _cache[key] = (time.time(), value, keep)
    return value


def _run(fn: Callable[[], T], timeout: float = FETCH_TIMEOUT_SECONDS) -> T | None:
    fut = _pool.submit(fn)
    try:
        return fut.result(timeout=timeout)
    except Exception:
        return None


def _fast_info_float(fi: Any, *keys: str) -> float | None:
    for key in keys:
        try:
            value = fi[key]
        except Exception:
            continue
        number = _finite(value)
        if number is not None:
            return number
    return None


def _quote_one(yahoo: str, desk: str) -> dict | None:
    try:
        fi = yf.Ticker(yahoo).fast_info
        last = _fast_info_float(fi, "lastPrice", "last_price")
        if last is None:
            return None
        prev = _fast_info_float(fi, "previousClose", "previous_close", "regularMarketPreviousClose") or last
        opened = _fast_info_float(fi, "open") or last
        high = _fast_info_float(fi, "dayHigh", "day_high") or last
        low = _fast_info_float(fi, "dayLow", "day_low") or last
        volume = _fast_info_float(fi, "lastVolume", "last_volume") or 0.0
        try:
            currency = (fi["currency"] or "INR").upper()
        except Exception:
            currency = "INR"
        change = last - prev
        return {
            "symbol": desk,
            "yahoo": yahoo,
            "last": last,
            "prev_close": prev,
            "open": opened,
            "high": high,
            "low": low,
            "change": change,
            "change_pct": (change / prev) if prev else 0.0,
            "volume": volume,
            "currency": currency,
            "ts": int(time.time() * 1000),
            "live": True,
        }
    except Exception:
        return None


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except Exception:
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _series_for(frame: pd.DataFrame, yahoo: str, field: str) -> pd.Series | None:
    cols = frame.columns
    if isinstance(cols, pd.MultiIndex):
        for key in ((field, yahoo), (yahoo, field)):
            try:
                series = frame[key]
                if isinstance(series, pd.DataFrame):
                    series = series.iloc[:, 0]
                return series
            except Exception:
                continue
        for col in cols:
            parts = [str(part) for part in (col if isinstance(col, tuple) else (col,))]
            if field in parts and yahoo in parts:
                series = frame[col]
                if isinstance(series, pd.DataFrame):
                    series = series.iloc[:, 0]
                return series
        return None
    if field in frame.columns:
        return frame[field]
    return None


def _last_values(series: pd.Series | None) -> tuple[float | None, float | None]:
    if series is None:
        return None, None
    values: list[float] = []
    for raw in series.tolist():
        number = _finite(raw)
        if number is not None:
            values.append(number)
    if not values:
        return None, None
    last = values[-1]
    prev = values[-2] if len(values) > 1 else last
    return last, prev


def quote_row(
    desk: str,
    yahoo: str,
    last: float,
    prev: float | None = None,
    opened: float | None = None,
    high: float | None = None,
    low: float | None = None,
    volume: float | None = None,
) -> dict:
    prev_close = prev if prev and prev > 0 else last
    change = last - prev_close
    return {
        "symbol": desk,
        "yahoo": yahoo,
        "last": last,
        "prev_close": prev_close,
        "open": opened if opened and opened > 0 else last,
        "high": high if high and high > 0 else last,
        "low": low if low and low > 0 else last,
        "change": change,
        "change_pct": (change / prev_close) if prev_close else 0.0,
        "volume": volume or 0.0,
        "currency": "INR",
        "ts": int(time.time() * 1000),
        "live": True,
    }


def parse_download_quotes(frame: pd.DataFrame | None, yahoo_to_desk: dict[str, str]) -> list[dict]:
    if frame is None or not isinstance(frame, pd.DataFrame) or frame.empty or not yahoo_to_desk:
        return []
    out: list[dict] = []
    tickers = list(yahoo_to_desk)
    if not isinstance(frame.columns, pd.MultiIndex) and len(tickers) == 1:
        tickers_iter = tickers
    else:
        tickers_iter = tickers
    for yahoo in tickers_iter:
        close, prev = _last_values(_series_for(frame, yahoo, "Close"))
        if close is None:
            close, prev = _last_values(_series_for(frame, yahoo, "Adj Close"))
        if close is None:
            continue
        opened, _ = _last_values(_series_for(frame, yahoo, "Open"))
        high, _ = _last_values(_series_for(frame, yahoo, "High"))
        low, _ = _last_values(_series_for(frame, yahoo, "Low"))
        volume, _ = _last_values(_series_for(frame, yahoo, "Volume"))
        desk = yahoo_to_desk.get(yahoo)
        if not desk:
            continue
        out.append(quote_row(desk, yahoo, close, prev, opened, high, low, volume))
    return out


def _download_quotes(yahoo_symbols: list[str]) -> pd.DataFrame | None:
    if not yahoo_symbols:
        return None
    return yf.download(
        yahoo_symbols,
        period="5d",
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=True,
        group_by="column",
        timeout=12,
        multi_level_index=True,
    )


def fetch_quotes(symbols: list[str]) -> list[dict]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in symbols:
        sym = (raw or "").strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        cleaned.append(sym)
        if len(cleaned) >= MAX_QUOTE_SYMBOLS:
            break
    if not cleaned:
        return []

    now = time.time()
    found: dict[str, dict] = {}
    missing: list[str] = []
    with _cache_lock:
        for desk in cleaned:
            hit = _quote_by_symbol.get(desk)
            if hit and now - hit[0] < QUOTE_TTL_SECONDS:
                found[desk] = hit[1]
            else:
                missing.append(desk)

    for i in range(0, len(missing), QUOTE_DOWNLOAD_CHUNK):
        chunk = missing[i : i + QUOTE_DOWNLOAD_CHUNK]
        yahoo_to_desk: dict[str, str] = {}
        for desk in chunk:
            yahoo = yahoo_symbol(desk)
            if yahoo:
                yahoo_to_desk[yahoo] = desk
        if not yahoo_to_desk:
            continue
        frame = _run(lambda mapping=yahoo_to_desk: _download_quotes(list(mapping)), timeout=BATCH_QUOTE_TIMEOUT_SECONDS)
        rows = parse_download_quotes(frame if isinstance(frame, pd.DataFrame) else None, yahoo_to_desk)
        with _cache_lock:
            for row in rows:
                _quote_by_symbol[row["symbol"]] = (time.time(), row)
                found[row["symbol"]] = row
        still = [desk for desk in chunk if desk not in found]
        if still:
            futs: dict[concurrent.futures.Future, str] = {}
            for desk in still:
                yahoo = yahoo_symbol(desk)
                if yahoo:
                    futs[_pool.submit(_quote_one, yahoo, desk)] = desk
            try:
                for fut in concurrent.futures.as_completed(futs, timeout=14):
                    desk = futs[fut]
                    try:
                        row = fut.result()
                    except Exception:
                        continue
                    if not row:
                        continue
                    with _cache_lock:
                        _quote_by_symbol[desk] = (time.time(), row)
                    found[desk] = row
            except concurrent.futures.TimeoutError:
                pass

    return [found[desk] for desk in cleaned if desk in found]


def fetch_world_quotes() -> dict:
    def _load() -> dict:
        now = time.time()
        found: dict[str, dict] = {}
        yahoo_to_desk: dict[str, str] = {}
        with _cache_lock:
            for desk in WORLD_INDEX_DESKS:
                hit = _quote_by_symbol.get(desk)
                if hit and now - hit[0] < QUOTE_TTL_SECONDS:
                    found[desk] = hit[1]
                    continue
                yahoo = yahoo_symbol(desk)
                if yahoo:
                    yahoo_to_desk[yahoo] = desk
        if yahoo_to_desk:
            frame = None
            fut = _map_pool.submit(_download_quotes, list(yahoo_to_desk))
            try:
                frame = fut.result(timeout=WORLD_TIMEOUT_SECONDS)
            except Exception:
                frame = None
            rows = parse_download_quotes(frame if isinstance(frame, pd.DataFrame) else None, yahoo_to_desk)
            with _cache_lock:
                for row in rows:
                    _quote_by_symbol[row["symbol"]] = (time.time(), row)
                    found[row["symbol"]] = row
            still = [desk for desk in yahoo_to_desk.values() if desk not in found]
            if still:
                futs: dict[concurrent.futures.Future, str] = {}
                for desk in still:
                    yahoo = yahoo_symbol(desk)
                    if yahoo:
                        futs[_map_pool.submit(_quote_one, yahoo, desk)] = desk
                done, _pending = concurrent.futures.wait(futs, timeout=4.0)
                for fut in done:
                    desk = futs[fut]
                    try:
                        row = fut.result()
                    except Exception:
                        continue
                    if not row:
                        continue
                    with _cache_lock:
                        _quote_by_symbol[desk] = (time.time(), row)
                    found[desk] = row
        quotes = [found[desk] for desk in WORLD_INDEX_DESKS if desk in found]
        return {
            "quotes": quotes,
            "live": any(row.get("live") for row in quotes),
            "count": len(quotes),
        }

    return _cached(
        "world-quotes",
        QUOTE_TTL_SECONDS,
        _load,
        lambda payload: QUOTE_TTL_SECONDS if payload.get("live") else 20.0,
        stale_for=180.0,
    )


def reset_quote_cache() -> None:
    with _cache_lock:
        _quote_by_symbol.clear()
        _cache.clear()


def _history_rows(yahoo: str, interval: str, period: str) -> list[dict]:
    hist = yf.Ticker(yahoo).history(period=period, interval=interval, auto_adjust=False)
    if hist is None or hist.empty:
        return []
    rows: list[dict] = []
    for idx, row in hist.iterrows():
        try:
            ts = int(idx.timestamp() * 1000)
            o = float(row["Open"])
            h = float(row["High"])
            l = float(row["Low"])
            c = float(row["Close"])
            v = float(row["Volume"]) if "Volume" in row and row["Volume"] == row["Volume"] else 0.0
        except Exception:
            continue
        if not all(x == x for x in (o, h, l, c)):
            continue
        rows.append({"t": ts, "o": o, "h": h, "l": l, "c": c, "v": v})
    if len(rows) > MAX_CANDLES:
        rows = rows[-MAX_CANDLES:]
    return rows


def _resample_4h(rows: list[dict]) -> list[dict]:
    if not rows:
        return rows
    buckets: dict[int, dict] = {}
    step = 4 * 3600 * 1000
    for bar in rows:
        key = (bar["t"] // step) * step
        existing = buckets.get(key)
        if existing is None:
            buckets[key] = {"t": key, "o": bar["o"], "h": bar["h"], "l": bar["l"], "c": bar["c"], "v": bar["v"]}
        else:
            existing["h"] = max(existing["h"], bar["h"])
            existing["l"] = min(existing["l"], bar["l"])
            existing["c"] = bar["c"]
            existing["v"] += bar["v"]
    return [buckets[k] for k in sorted(buckets)]


def fetch_ohlc(desk_symbol: str, timeframe: str) -> dict:
    symbol = (desk_symbol or "").strip().upper()
    tf = timeframe if timeframe in TIMEFRAME_PRESETS else "1D"
    yahoo = yahoo_symbol(symbol)
    empty = {"symbol": symbol, "timeframe": tf, "yahoo": yahoo, "live": False, "candles": []}
    if not yahoo:
        return empty
    interval, period = TIMEFRAME_PRESETS[tf]
    ttl = OHLC_TTL_DAILY if tf in ("1D", "1W", "1M") else OHLC_TTL_INTRADAY
    key = f"ohlc:{yahoo}:{tf}"

    def _load() -> dict:
        rows = _run(lambda: _history_rows(yahoo, interval, period)) or []
        if tf == "4H":
            rows = _resample_4h(rows)
        return {
            "symbol": symbol,
            "timeframe": tf,
            "yahoo": yahoo,
            "live": bool(rows),
            "candles": rows,
        }

    return _cached(key, ttl, _load)


def range_change_pct(closes: list[float], bars_back: int) -> float | None:
    numbers = [value for value in closes if value == value]
    if len(numbers) < 2:
        return None
    last = numbers[-1]
    steps = max(1, int(bars_back))
    prev = numbers[max(0, len(numbers) - 1 - steps)]
    if not prev:
        return None
    return (last - prev) / prev


def _closes_for(frame: pd.DataFrame | None, yahoo: str) -> list[float]:
    if frame is None or not isinstance(frame, pd.DataFrame) or frame.empty:
        return []
    series = _series_for(frame, yahoo, "Close")
    if series is None:
        series = _series_for(frame, yahoo, "Adj Close")
    if series is None:
        return []
    out: list[float] = []
    for raw in series.tolist():
        number = _finite(raw)
        if number is not None:
            out.append(number)
    return out


def _market_cap_one(yahoo: str) -> float | None:
    try:
        fi = yf.Ticker(yahoo).fast_info
        cap = _fast_info_float(fi, "marketCap", "market_cap")
        if cap and cap > 0:
            return cap
        last = _fast_info_float(fi, "lastPrice", "last_price")
        shares = _fast_info_float(fi, "shares", "shares_outstanding", "sharesOutstanding")
        if last and shares and last > 0 and shares > 0:
            return last * shares
    except Exception:
        return None
    return None


def _fold_label(value: str) -> str:
    return "".join(ch for ch in str(value).casefold() if ch.isalnum())


def _pick_statement_row(frame: pd.DataFrame, aliases: list[str]) -> pd.Series | None:
    index_map = {_fold_label(label): label for label in frame.index}
    for alias in aliases:
        key = _fold_label(alias)
        if key in index_map:
            return frame.loc[index_map[key]]
    for alias in aliases:
        needle = _fold_label(alias)
        if len(needle) < 10:
            continue
        for folded, raw in index_map.items():
            if needle in folded:
                return frame.loc[raw]
    return None


def statement_table(frame: pd.DataFrame | None, spec: list[tuple[str, str, list[str]]]) -> dict:
    if frame is None or not isinstance(frame, pd.DataFrame) or frame.empty:
        return {"columns": [], "rows": []}
    cols = list(frame.columns)[:5]
    columns: list[str] = []
    for col in cols:
        if hasattr(col, "strftime"):
            columns.append(col.strftime("%Y"))
        else:
            columns.append(str(col)[:10])
    rows: list[dict] = []
    for row_id, label, aliases in spec:
        series = _pick_statement_row(frame, aliases)
        values: list[float | None] = []
        for col in cols:
            if series is None:
                values.append(None)
                continue
            try:
                values.append(_finite(series[col]))
            except Exception:
                values.append(None)
        rows.append({"id": row_id, "label": label, "values": values})
    return {"columns": columns, "rows": rows}


def statement_latest(table: dict, row_id: str) -> float | None:
    for row in table.get("rows") or []:
        if row.get("id") != row_id:
            continue
        for value in row.get("values") or []:
            if value is not None:
                return float(value)
    return None


def compute_roce(income: dict, balance: dict) -> float | None:
    ebit = statement_latest(income, "ebit") or statement_latest(income, "operating_income")
    assets = statement_latest(balance, "total_assets")
    current = statement_latest(balance, "current_liabilities")
    if ebit is None or assets is None or current is None:
        return None
    employed = assets - current
    if not employed:
        return None
    return ebit / employed


def _normalize_ratio(value: Any, kind: str) -> float | None:
    number = _finite(value)
    if number is None:
        return None
    if kind == "pct" and abs(number) > 5:
        return number / 100.0
    return number


def _ratio_row(row_id: str, label: str, value: Any, fmt: str) -> dict:
    return {
        "id": row_id,
        "label": label,
        "value": _normalize_ratio(value, fmt) if fmt == "pct" else _finite(value),
        "format": fmt,
    }


def _empty_financials(symbol: str, yahoo: str | None, message: str) -> dict:
    return {
        "symbol": symbol,
        "yahoo": yahoo,
        "name": symbol,
        "currency": "INR",
        "live": False,
        "message": message,
        "ratios": [],
        "income": {"columns": [], "rows": []},
        "balance": {"columns": [], "rows": []},
        "cashflow": {"columns": [], "rows": []},
    }


def _cache_market_cap(yahoo: str) -> None:
    cap = _market_cap_one(yahoo)
    if cap and cap > 0:
        with _cache_lock:
            _cache[f"mcap:{yahoo}"] = (time.time(), cap, MARKET_CAP_TTL_SECONDS)


def _download_heatmap_chunk(tickers: list[str], period: str) -> pd.DataFrame | None:
    if not tickers:
        return None
    return yf.download(
        tickers,
        period=period,
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=True,
        group_by="column",
        timeout=8,
        multi_level_index=True,
    )


def _heatmap_closes(yahoo_symbols: list[str], period: str) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    if not yahoo_symbols:
        return out
    chunks = [yahoo_symbols[i : i + HEATMAP_DOWNLOAD_CHUNK] for i in range(0, len(yahoo_symbols), HEATMAP_DOWNLOAD_CHUNK)]
    futs = {_map_pool.submit(_download_heatmap_chunk, chunk, period): chunk for chunk in chunks}
    done, pending = concurrent.futures.wait(futs, timeout=HEATMAP_TIMEOUT_SECONDS)
    for fut in pending:
        fut.cancel()
    for fut in done:
        chunk = futs[fut]
        try:
            frame = fut.result()
        except Exception:
            continue
        if not isinstance(frame, pd.DataFrame):
            continue
        for yahoo in chunk:
            closes = _closes_for(frame, yahoo)
            if closes:
                out[yahoo] = closes
    return out


def fetch_heatmap(index: str = "Nifty 50", range_code: str = "D") -> dict:
    from backend.trading.nse_universe import canonical_index_name, get_universe, search_universe

    code = "D"
    index_name = canonical_index_name((index or "Nifty 50").strip()) or "Nifty 50"
    key = f"heatmap:{index_name}:{code}"

    def _load() -> dict:
        payload = get_universe()
        searched = search_universe(payload, index=index_name, limit=MAX_HEATMAP_TILES)
        items = list(searched.get("items") or [])
        yahoo_to_item: dict[str, dict] = {}
        ordered: list[tuple[str | None, dict]] = []
        for item in items:
            yahoo = yahoo_symbol(item["symbol"])
            ordered.append((yahoo, item))
            if yahoo:
                yahoo_to_item[yahoo] = item
        closes_by_yahoo = _heatmap_closes(list(yahoo_to_item), "5d")
        caps: dict[str, float] = {}
        missing: list[str] = []
        now = time.time()
        with _cache_lock:
            for yahoo in yahoo_to_item:
                hit = _cache.get(f"mcap:{yahoo}")
                if hit and now - hit[0] < MARKET_CAP_TTL_SECONDS:
                    caps[yahoo] = float(hit[1] or 0.0)
                else:
                    missing.append(yahoo)
        if missing:
            for yahoo in missing:
                _map_pool.submit(_cache_market_cap, yahoo)

        tiles: list[dict] = []
        for yahoo, item in ordered:
            closes = closes_by_yahoo.get(yahoo or "", [])
            last = closes[-1] if closes else None
            change = range_change_pct(closes, HEATMAP_RANGES[code]) if closes else None
            cap = caps.get(yahoo or "", 0.0) or 0.0
            tiles.append(
                {
                    "symbol": item["symbol"],
                    "name": item.get("name") or item["symbol"],
                    "industry": item.get("industry") or "Market",
                    "last": last or 0.0,
                    "change_pct": change or 0.0,
                    "market_cap": cap if cap and cap > 0 else 0.0,
                    "live": bool(closes),
                }
            )
        tiles.sort(key=lambda row: (row["market_cap"], abs(row["change_pct"])), reverse=True)
        if len(tiles) > MAX_HEATMAP_TILES:
            tiles = tiles[:MAX_HEATMAP_TILES]
        return {
            "index": index_name,
            "range": code,
            "live": any(tile["live"] for tile in tiles),
            "tiles": tiles,
        }

    return _cached(key, HEATMAP_TTL_SECONDS, _load, lambda payload: HEATMAP_TTL_SECONDS if payload.get("live") else 20.0, stale_for=300.0)


def compute_roe(income: dict, balance: dict) -> float | None:
    net = statement_latest(income, "net_income")
    equity = statement_latest(balance, "equity")
    if net is None or not equity:
        return None
    return net / equity


def _first_frame(*frames: Any) -> pd.DataFrame | None:
    for frame in frames:
        if isinstance(frame, pd.DataFrame) and not frame.empty:
            return frame
    return None


def assemble_financials(symbol: str, yahoo: str, info: dict, income: Any, balance: Any, cash: Any) -> dict:
    income_t = statement_table(_first_frame(income), INCOME_ROWS)
    balance_t = statement_table(_first_frame(balance), BALANCE_ROWS)
    cash_t = statement_table(_first_frame(cash), CASHFLOW_ROWS)
    last = _finite(info.get("last_price") or info.get("lastPrice") or info.get("regularMarketPrice"))
    shares = _finite(info.get("shares") or info.get("sharesOutstanding") or info.get("shares_outstanding"))
    mcap = _finite(info.get("market_cap") or info.get("marketCap"))
    if (not mcap or mcap <= 0) and last and shares:
        mcap = last * shares
    net = statement_latest(income_t, "net_income")
    revenue = statement_latest(income_t, "revenue")
    ebit = statement_latest(income_t, "ebit") or statement_latest(income_t, "operating_income")
    eps = statement_latest(income_t, "eps") or _finite(info.get("trailingEps"))
    equity = statement_latest(balance_t, "equity")
    assets = statement_latest(balance_t, "total_assets")
    debt = statement_latest(balance_t, "total_debt")
    current_assets = statement_latest(balance_t, "current_assets")
    current_liab = statement_latest(balance_t, "current_liabilities")
    book = (equity / shares) if equity and shares else _finite(info.get("bookValue"))
    roce = compute_roce(income_t, balance_t)
    roe = _finite(info.get("returnOnEquity")) or compute_roe(income_t, balance_t)
    roa = _finite(info.get("returnOnAssets"))
    if roa is None and net is not None and assets:
        roa = net / assets
    pe = _finite(info.get("trailingPE"))
    if pe is None and last and eps:
        pe = last / eps
    pb = _finite(info.get("priceToBook"))
    if pb is None and last and book:
        pb = last / book
    op_margin = _finite(info.get("operatingMargins"))
    if op_margin is None and ebit is not None and revenue:
        op_margin = ebit / revenue
    net_margin = _finite(info.get("profitMargins"))
    if net_margin is None and net is not None and revenue:
        net_margin = net / revenue
    current_ratio = _finite(info.get("currentRatio"))
    if current_ratio is None and current_assets and current_liab:
        current_ratio = current_assets / current_liab
    debt_equity = _finite(info.get("debtToEquity"))
    if debt_equity is None and debt is not None and equity:
        debt_equity = debt / equity
    ratios = [
        _ratio_row("roe", "ROE", roe, "pct"),
        _ratio_row("roce", "ROCE", roce, "pct"),
        _ratio_row("roa", "ROA", roa, "pct"),
        _ratio_row("pe", "PE", pe, "number"),
        _ratio_row("forward_pe", "Forward PE", info.get("forwardPE"), "number"),
        _ratio_row("pb", "PB", pb, "number"),
        _ratio_row("dividend_yield", "Dividend yield", info.get("dividendYield") or info.get("trailingAnnualDividendYield"), "pct"),
        _ratio_row("payout", "Payout ratio", info.get("payoutRatio"), "pct"),
        _ratio_row("op_margin", "Operating margin", op_margin, "pct"),
        _ratio_row("net_margin", "Net margin", net_margin, "pct"),
        _ratio_row("current_ratio", "Current ratio", current_ratio, "number"),
        _ratio_row("debt_equity", "Debt / equity", debt_equity, "number"),
        _ratio_row("ev_ebitda", "EV / EBITDA", info.get("enterpriseToEbitda"), "number"),
        _ratio_row("eps", "Trailing EPS", eps, "number"),
        _ratio_row("book", "Book value / share", book, "number"),
        _ratio_row("beta", "Beta", info.get("beta"), "number"),
        _ratio_row("market_cap", "Market cap", mcap, "money"),
    ]
    live = bool(income_t["columns"] or balance_t["columns"] or cash_t["columns"] or any(row["value"] is not None for row in ratios))
    return {
        "symbol": symbol,
        "yahoo": yahoo,
        "name": info.get("shortName") or info.get("longName") or symbol,
        "currency": str(info.get("currency") or "INR").upper(),
        "live": live,
        "message": None if live else "Yahoo has no financials for this symbol.",
        "ratios": ratios,
        "income": income_t,
        "balance": balance_t,
        "cashflow": cash_t,
    }


def _statement_frame(ticker: Any, *names: str) -> pd.DataFrame | None:
    for name in names:
        attr = getattr(ticker, name, None)
        try:
            frame = attr() if callable(attr) else attr
        except Exception:
            frame = None
        if isinstance(frame, pd.DataFrame) and not frame.empty:
            return frame
    return None


def fetch_financials(desk_symbol: str) -> dict:
    symbol = (desk_symbol or "").strip().upper()
    yahoo = yahoo_symbol(symbol)
    if not yahoo:
        return _empty_financials(symbol, None, "No Yahoo symbol for this instrument.")
    key = f"fin:{yahoo}"

    def _load() -> dict:
        def _pull() -> tuple[dict, Any, Any, Any]:
            ticker = yf.Ticker(yahoo)
            income = _statement_frame(ticker, "income_stmt", "get_income_stmt", "quarterly_income_stmt")
            balance = _statement_frame(ticker, "balance_sheet", "get_balance_sheet", "quarterly_balance_sheet")
            cash = _statement_frame(ticker, "cashflow", "cash_flow", "get_cash_flow", "get_cashflow", "quarterly_cashflow")
            info: dict[str, Any] = {}
            try:
                fi = ticker.fast_info
                info["last_price"] = _fast_info_float(fi, "lastPrice", "last_price")
                info["market_cap"] = _fast_info_float(fi, "marketCap", "market_cap")
                info["shares"] = _fast_info_float(fi, "shares", "sharesOutstanding", "shares_outstanding")
                try:
                    info["currency"] = fi["currency"]
                except Exception:
                    info["currency"] = "INR"
            except Exception:
                pass
            return info, income, balance, cash

        pulled = _fin_pool.submit(_pull)
        try:
            result = pulled.result(timeout=FINANCIALS_TIMEOUT_SECONDS)
        except Exception:
            return _empty_financials(symbol, yahoo, "Yahoo timed out reading financials. Try again.")
        info, income, balance, cash = result
        return assemble_financials(symbol, yahoo, info if isinstance(info, dict) else {}, income, balance, cash)

    return _cached(key, FINANCIALS_TTL_SECONDS, _load, lambda payload: FINANCIALS_TTL_SECONDS if payload.get("live") else 15.0)
