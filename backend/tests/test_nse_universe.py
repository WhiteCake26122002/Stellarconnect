from __future__ import annotations

from backend.trading.nse_universe import (
    INDEX_CSV_URLS,
    INDEX_SIZE_HINTS,
    build_universe,
    canonical_index_name,
    parse_equity_list_csv,
    parse_index_csv,
    reset_universe_cache,
    search_universe,
)


NIFTY50_CSV = """Company Name,Industry,Symbol,Series,ISIN Code
Reliance Industries Ltd.,Oil Gas,RELIANCE,EQ,INE002A01018
HDFC Bank Ltd.,Financial Services,HDFCBANK,EQ,INE040A01034
Infosys Ltd.,Information Technology,INFY,EQ,INE009A01021
"""

MIDCAP_CSV = """Company Name,Industry,Symbol,Series,ISIN Code
Persistent Systems Ltd.,Information Technology,PERSISTENT,EQ,INE262H01021
"""

SMALLCAP_CSV = """Company Name,Industry,Symbol,Series,ISIN Code
JK Paper Ltd.,Forest Materials,JKPAPER,EQ,INE789E01012
"""

LARGEMID_CSV = """Company Name,Industry,Symbol,Series,ISIN Code
Persistent Systems Ltd.,Information Technology,PERSISTENT,EQ,INE262H01021
ABB India Ltd.,Capital Goods,ABB,EQ,INE117A01022
"""

EQUITY_CSV = """SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE
RELIANCE,Reliance Industries Limited,EQ,06-JAN-1995,10,1,INE002A01018,10
HDFCBANK,HDFC Bank Limited,EQ,08-NOV-1995,1,1,INE040A01034,1
INFY,Infosys Limited,EQ,08-FEB-1995,5,1,INE009A01021,5
PERSISTENT,Persistent Systems Limited,EQ,06-APR-2010,5,1,INE262H01021,5
JKPAPER,JK Paper Limited,EQ,16-JUN-2005,10,1,INE789E01012,10
ABB,ABB India Limited,EQ,08-FEB-1995,2,1,INE117A01022,2
20MICRONS,20 Microns Limited,EQ,06-OCT-2008,5,1,INE144J01027,5
"""


def _fake_fetcher(url: str) -> str:
    if url.endswith("ind_nifty50list.csv"):
        return NIFTY50_CSV
    if url.endswith("ind_niftymidcap150list.csv"):
        return MIDCAP_CSV
    if url.endswith("ind_niftysmallcap250list.csv"):
        return SMALLCAP_CSV
    if url.endswith("ind_niftylargemidcap250list.csv"):
        return LARGEMID_CSV
    if url.endswith("EQUITY_L.csv"):
        return EQUITY_CSV
    if "IndexConstituent" in url:
        return "Company Name,Industry,Symbol,Series,ISIN Code\n"
    raise AssertionError(f"unexpected url {url}")


def test_parse_index_and_equity_csv():
    rows = parse_index_csv(NIFTY50_CSV)
    assert [r["symbol"] for r in rows] == ["RELIANCE", "HDFCBANK", "INFY"]
    eq = parse_equity_list_csv(EQUITY_CSV)
    assert {r["symbol"] for r in eq} >= {"RELIANCE", "JKPAPER", "20MICRONS"}
    dummy = parse_index_csv("Company Name,Industry,Symbol,Series,ISIN Code\nDummy HEG Ltd.,Test,DUMMYHEG,EQ,INE000D00001\n")
    assert dummy == []


def test_build_universe_merges_indices_and_full_board():
    reset_universe_cache()
    payload = build_universe(_fake_fetcher)
    symbols = {row["symbol"] for row in payload["items"]}
    assert symbols == {"RELIANCE", "HDFCBANK", "INFY", "PERSISTENT", "JKPAPER", "ABB", "20MICRONS"}
    jkp = next(row for row in payload["items"] if row["symbol"] == "JKPAPER")
    assert "Nifty Smallcap 250" in jkp["indices"]
    rel = next(row for row in payload["items"] if row["symbol"] == "RELIANCE")
    assert "Nifty 50" in rel["indices"]
    counts = {entry["name"]: entry["count"] for entry in payload["indices"]}
    assert counts["Nifty 50"] == 3
    assert counts["Nifty Smallcap 250"] == 1
    assert counts["Nifty LargeMidcap 250"] == 2


def test_search_filters_by_index_alias_and_query():
    payload = build_universe(_fake_fetcher)
    mid = search_universe(payload, index="Nifty Midcap 250")
    assert canonical_index_name("Nifty Midcap 250") == "Nifty LargeMidcap 250"
    assert {row["symbol"] for row in mid["items"]} == {"PERSISTENT", "ABB"}
    small = search_universe(payload, index="Nifty Smallcap")
    assert canonical_index_name("Nifty Smallcap") == "Nifty Smallcap 250"
    assert {row["symbol"] for row in small["items"]} == {"JKPAPER"}
    paper = search_universe(payload, q="jk paper")
    assert [row["symbol"] for row in paper["items"]] == ["JKPAPER"]
    empty = search_universe(payload, index="Not A Real Index")
    assert empty["items"] == []
    assert empty["index"] is None


def test_index_catalog_covers_large_mid_small():
    names = set(INDEX_CSV_URLS)
    for required in (
        "Nifty 50",
        "Nifty Midcap 150",
        "Nifty LargeMidcap 250",
        "Nifty Smallcap 250",
        "Nifty Microcap 250",
        "Nifty 500",
        "Nifty Total Market",
    ):
        assert required in names
        lo, hi = INDEX_SIZE_HINTS[required]
        assert lo < hi
