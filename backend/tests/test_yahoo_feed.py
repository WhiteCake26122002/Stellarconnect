from __future__ import annotations

import pandas as pd
import pytest

from backend.trading.yahoo_feed import overlay_last, parse_download_quotes, quote_row, yahoo_symbol


def test_yahoo_symbol_maps_indices_and_nse_stocks():
    assert yahoo_symbol("NIFTY") == "^NSEI"
    assert yahoo_symbol("BANKNIFTY") == "^NSEBANK"
    assert yahoo_symbol("RELIANCE") == "RELIANCE.NS"
    assert yahoo_symbol("SPX") == "^GSPC"
    assert yahoo_symbol("SSEC") == "000001.SS"
    assert yahoo_symbol("N225") == "^N225"
    assert yahoo_symbol("J203") == "^J203.JO"
    assert yahoo_symbol("TASI") == "^TASI.SR"
    assert yahoo_symbol("MERV") == "^MERV"
    assert yahoo_symbol("IPSA") == "SPIPSA.SN"
    assert yahoo_symbol("TA35") == "TA35.TA"
    assert yahoo_symbol("NIFTY24800CE") is None
    assert yahoo_symbol("") is None


def test_overlay_last_extends_high_low():
    candles = [{"t": 1, "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 1}]
    out = overlay_last(candles, 12)
    assert out[-1]["c"] == 12
    assert out[-1]["h"] == 12
    assert candles[-1]["c"] == 10.5


def test_parse_download_quotes_column_grouped():
    idx = pd.to_datetime(["2026-09-17", "2026-09-18"])
    cols = pd.MultiIndex.from_product(
        [["Close", "High", "Low", "Open", "Volume"], ["RELIANCE.NS", "TCS.NS"]],
    )
    data = []
    for _day in idx:
        data.append(
            [
                1380.0,
                3900.0,
                1390.0,
                3920.0,
                1370.0,
                3880.0,
                1375.0,
                3890.0,
                1_000_000,
                800_000,
            ]
        )
    data[1] = [1400.0, 4000.0, 1410.0, 4020.0, 1390.0, 3980.0, 1395.0, 3990.0, 1_100_000, 900_000]
    frame = pd.DataFrame(data, index=idx, columns=cols)
    rows = parse_download_quotes(frame, {"RELIANCE.NS": "RELIANCE", "TCS.NS": "TCS"})
    by_symbol = {row["symbol"]: row for row in rows}
    assert by_symbol["RELIANCE"]["last"] == 1400.0
    assert by_symbol["RELIANCE"]["prev_close"] == 1380.0
    assert by_symbol["TCS"]["last"] == 4000.0
    assert by_symbol["TCS"]["change"] == 100.0


def test_quote_row_change_pct():
    row = quote_row("INFY", "INFY.NS", last=110, prev=100, opened=101, high=111, low=99, volume=12)
    assert row["change"] == 10
    assert row["change_pct"] == 0.1
    assert row["live"] is True


def test_range_change_pct_uses_lookback_bars():
    from backend.trading.yahoo_feed import range_change_pct

    assert range_change_pct([100, 110], 1) == pytest.approx(0.1)
    assert range_change_pct([100, 102, 104, 110], 3) == pytest.approx(0.1)
    assert range_change_pct([100], 1) is None


def test_fetch_heatmap_uses_smallcap_members_not_nifty_fallback(monkeypatch):
    from backend.trading import yahoo_feed

    yahoo_feed.reset_quote_cache()
    payload = {
        "source": "test",
        "fetched_at": 1,
        "stale": False,
        "indices": [{"name": "Nifty Smallcap 250", "count": 1, "symbols": ["JKPAPER"]}],
        "items": [
            {
                "symbol": "JKPAPER",
                "name": "JK Paper",
                "industry": "Forest Materials",
                "indices": ["Nifty Smallcap 250"],
            }
        ],
    }
    monkeypatch.setattr("backend.trading.nse_universe.get_universe", lambda: payload)
    monkeypatch.setattr(yahoo_feed, "_heatmap_closes", lambda names, period: {})
    body = yahoo_feed.fetch_heatmap("Nifty Smallcap")
    assert body["index"] == "Nifty Smallcap 250"
    assert body["range"] == "D"
    assert [tile["symbol"] for tile in body["tiles"]] == ["JKPAPER"]


def test_fetch_heatmap_paints_closes_without_waiting_on_caps(monkeypatch):
    from backend.trading import yahoo_feed

    yahoo_feed.reset_quote_cache()
    payload = {
        "source": "test",
        "fetched_at": 1,
        "stale": False,
        "indices": [{"name": "Nifty 50", "count": 1, "symbols": ["RELIANCE"]}],
        "items": [
            {
                "symbol": "RELIANCE",
                "name": "Reliance Industries",
                "industry": "Oil Gas",
                "indices": ["Nifty 50"],
            }
        ],
    }
    submitted: list[str] = []
    monkeypatch.setattr("backend.trading.nse_universe.get_universe", lambda: payload)
    monkeypatch.setattr(yahoo_feed, "_heatmap_closes", lambda names, period: {"RELIANCE.NS": [100.0, 110.0]})
    monkeypatch.setattr(yahoo_feed._map_pool, "submit", lambda fn, *args: submitted.append(args[0] if args else "") or type("F", (), {"result": lambda self: None})())
    body = yahoo_feed.fetch_heatmap("Nifty 50")
    tile = body["tiles"][0]
    assert tile["symbol"] == "RELIANCE"
    assert tile["last"] == 110.0
    assert tile["change_pct"] == pytest.approx(0.1)
    assert tile["live"] is True
    assert tile["market_cap"] == 0.0
    assert "RELIANCE.NS" in submitted


def test_fetch_world_quotes_one_download(monkeypatch):
    from backend.trading import yahoo_feed

    yahoo_feed.reset_quote_cache()
    calls: list[list[str]] = []

    def fake_download(symbols):
        calls.append(list(symbols))
        return None

    monkeypatch.setattr(yahoo_feed, "_download_quotes", fake_download)
    monkeypatch.setattr(yahoo_feed, "_quote_one", lambda yahoo, desk: None)
    body = yahoo_feed.fetch_world_quotes()
    assert len(calls) == 1
    assert len(calls[0]) >= 20
    assert body["count"] == 0
    assert body["quotes"] == []
    from backend.trading import yahoo_feed

    yahoo_feed.reset_quote_cache()
    payload = {
        "source": "test",
        "fetched_at": 1,
        "stale": False,
        "indices": [{"name": "Nifty Smallcap 250", "count": 1, "symbols": ["JKPAPER"]}],
        "items": [
            {
                "symbol": "JKPAPER",
                "name": "JK Paper",
                "industry": "Forest Materials",
                "indices": ["Nifty Smallcap 250"],
            }
        ],
    }
    monkeypatch.setattr("backend.trading.nse_universe.get_universe", lambda: payload)
    monkeypatch.setattr(yahoo_feed, "_heatmap_closes", lambda names, period: {})
    body = yahoo_feed.fetch_heatmap("Nifty Smallcap")
    assert body["index"] == "Nifty Smallcap 250"
    assert body["range"] == "D"
    assert [tile["symbol"] for tile in body["tiles"]] == ["JKPAPER"]


def test_statement_table_and_roce():
    from backend.trading.yahoo_feed import BALANCE_ROWS, INCOME_ROWS, compute_roce, statement_table

    income = pd.DataFrame(
        {pd.Timestamp("2024-03-31"): [200.0, 40.0]},
        index=["Total Revenue", "EBIT"],
    )
    balance = pd.DataFrame(
        {pd.Timestamp("2024-03-31"): [500.0, 100.0]},
        index=["Total Assets", "Current Liabilities"],
    )
    income_t = statement_table(income, INCOME_ROWS)
    balance_t = statement_table(balance, BALANCE_ROWS)
    assert income_t["columns"] == ["2024"]
    revenue = next(row for row in income_t["rows"] if row["id"] == "revenue")
    assert revenue["values"][0] == 200.0
    assert compute_roce(income_t, balance_t) == pytest.approx(0.1)


def test_assemble_financials_computes_ratios_from_statements():
    from backend.trading.yahoo_feed import assemble_financials

    income = pd.DataFrame(
        {pd.Timestamp("2024-03-31"): [200.0, 40.0, 20.0, 5.0]},
        index=["Total Revenue", "EBIT", "Net Income", "Diluted EPS"],
    )
    balance = pd.DataFrame(
        {pd.Timestamp("2024-03-31"): [500.0, 100.0, 200.0]},
        index=["Total Assets", "Current Liabilities", "Stockholders Equity"],
    )
    cash = pd.DataFrame(
        {pd.Timestamp("2024-03-31"): [30.0]},
        index=["Operating Cash Flow"],
    )
    out = assemble_financials("INFY", "INFY.NS", {"last_price": 100.0, "shares": 10.0, "currency": "INR"}, income, balance, cash)
    assert out["live"] is True
    by_id = {row["id"]: row["value"] for row in out["ratios"]}
    assert by_id["roe"] == pytest.approx(0.1)
    assert by_id["roce"] == pytest.approx(0.1)
    assert by_id["pe"] == pytest.approx(20.0)
    assert out["income"]["rows"][0]["values"][0] == 200.0


def test_statement_table_reads_yahoo_camelcase_labels():
    from backend.trading.yahoo_feed import BALANCE_ROWS, CASHFLOW_ROWS, INCOME_ROWS, statement_table

    income = pd.DataFrame(
        {pd.Timestamp("2025-03-31"): [900.0, 90.0, 45.0]},
        index=["TotalRevenue", "OperatingIncome", "NetIncome"],
    )
    balance = pd.DataFrame(
        {pd.Timestamp("2025-03-31"): [1000.0, 400.0]},
        index=["TotalAssets", "StockholdersEquity"],
    )
    cash = pd.DataFrame(
        {pd.Timestamp("2025-03-31"): [70.0]},
        index=["OperatingCashFlow"],
    )
    revenue = next(row for row in statement_table(income, INCOME_ROWS)["rows"] if row["id"] == "revenue")
    equity = next(row for row in statement_table(balance, BALANCE_ROWS)["rows"] if row["id"] == "equity")
    ocf = next(row for row in statement_table(cash, CASHFLOW_ROWS)["rows"] if row["id"] == "ocf")
    assert revenue["values"][0] == 900.0
    assert equity["values"][0] == 400.0
    assert ocf["values"][0] == 70.0


def test_fetch_financials_timeout_does_not_look_like_missing_filings(monkeypatch):
    from backend.trading import yahoo_feed

    yahoo_feed.reset_quote_cache()

    class _Never:
        def result(self, timeout=None):
            raise TimeoutError()

    monkeypatch.setattr(yahoo_feed._fin_pool, "submit", lambda fn: _Never())
    out = yahoo_feed.fetch_financials("RELIANCE")
    assert out["live"] is False
    assert "timed out" in (out["message"] or "").lower()
    assert out["income"]["rows"] == []


def test_closes_for_reads_multiindex_close_without_bool_series():
    from backend.trading.yahoo_feed import _closes_for

    idx = pd.to_datetime(["2026-09-17", "2026-09-18"])
    cols = pd.MultiIndex.from_product([["Close"], ["RELIANCE.NS"]])
    frame = pd.DataFrame([[1380.0], [1400.0]], index=idx, columns=cols)
    assert _closes_for(frame, "RELIANCE.NS") == [1380.0, 1400.0]
