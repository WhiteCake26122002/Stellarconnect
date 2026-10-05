"""
Indian-company statement ingestion from Screener.in company pages.

Yahoo Finance stays the source for international tickers and for live price /
share count when it answers. This adapter is India-listed (.NS / .BO) only.

Screener has no public API. We fetch the consolidated company page, parse the
annual Profit & Loss / Balance Sheet / Cash Flow tables, and map them into the
same engine models Yahoo ingestion already produces. Units on the page are
crore; the engine stores millions (1 crore = 10 million).

Not instant on results day: Screener updates after the exchange filing, and
this app only reloads when the user refreshes the model.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote, urlparse

import requests
from bs4 import BeautifulSoup, Tag

from ..engine.models import (
    BalanceSheet,
    CashFlowStatement,
    Company,
    CompanyType,
    HistoricalFinancials,
)
from .yahoo_bridge_overlay import apply_yahoo_bridge_overlay
from .yfinance_ingestion import IngestionResult, MILLION, build_income_statement

SCREENER_HOSTS = frozenset({"www.screener.in", "screener.in"})
SCREENER_ORIGIN = "https://www.screener.in"
FETCH_TIMEOUT_SECONDS = 15
MAX_BODY_BYTES = 2_000_000
CRORE_TO_MILLIONS = 10.0
TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.&-]{0,19}$")
_FINANCIAL_INDUSTRY = re.compile(
    r"\b(bank|nbfc|insurer|insurance|housing finance|credit services|non.?banking)\b",
    re.I,
)


class ScreenerUnavailable(RuntimeError):
    """Network, HTML, or empty-table failure. Caller may fall back to Yahoo."""


class ScreenerUnsupported(ValueError):
    """Company is out of scope for this FCFF engine (banks, empty book). Do not fall back."""


def india_nse_code(ticker: str) -> str | None:
    """Return the NSE/BSE code for an India-listed Yahoo ticker, or None."""
    raw = (ticker or "").strip().upper()
    if raw.endswith(".NS") or raw.endswith(".BO"):
        code = raw.rsplit(".", 1)[0]
    else:
        return None
    if not TICKER_RE.fullmatch(code):
        return None
    return code


def is_india_listed(ticker: str) -> bool:
    return india_nse_code(ticker) is not None


def _fold(label: str) -> str:
    return "".join(ch for ch in str(label).casefold() if ch.isalnum())


def _parse_number(text: str) -> float | None:
    raw = (text or "").replace("\xa0", " ").strip()
    if not raw or raw in {".", "-", "—", "na", "n/a", "NA"}:
        return None
    if raw.endswith("%"):
        return None
    raw = raw.replace("₹", "").replace(",", "").replace("?", "").replace("Cr.", "").replace("Cr", "")
    raw = raw.strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _parse_table(table: Tag) -> tuple[list[str], dict[str, list[float | None]]]:
    rows = table.find_all("tr")
    if len(rows) < 2:
        return [], {}
    headers = [c.get_text(" ", strip=True) for c in rows[0].find_all(["th", "td"])]
    periods = headers[1:]
    data: dict[str, list[float | None]] = {}
    for row in rows[1:]:
        cells = [c.get_text(" ", strip=True) for c in row.find_all(["th", "td"])]
        if not cells:
            continue
        key = _fold(cells[0])
        if not key:
            continue
        values = [_parse_number(c) for c in cells[1 : 1 + len(periods)]]
        while len(values) < len(periods):
            values.append(None)
        data[key] = values[: len(periods)]
    return periods, data


def _data_table(soup: BeautifulSoup, table_id: str) -> Tag | None:
    direct = soup.find("table", id=table_id, class_=lambda c: c and "data-table" in c)
    if isinstance(direct, Tag) and "ranges-table" not in (direct.get("class") or []):
        return direct
    section = soup.find(id=table_id)
    if not isinstance(section, Tag):
        return None
    for table in section.find_all("table"):
        classes = table.get("class") or []
        if "data-table" in classes and "ranges-table" not in classes:
            return table
    return None


def _period_label(header: str) -> str | None:
    text = (header or "").strip()
    if not text or text.upper() in {"TTM", "LAST 12M", "LTM"}:
        return None
    match = re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})", text, re.I)
    if match:
        return f"FY{match.group(2)}"
    year = re.fullmatch(r"20\d{2}", text)
    if year:
        return f"FY{text}"
    return None


def _row_at(data: dict[str, list[float | None]], index: int, *names: str) -> float | None:
    for name in names:
        values = data.get(_fold(name))
        if values is None or index >= len(values):
            continue
        value = values[index]
        if value is not None:
            return value
    return None


def _cr(value: float | None) -> float:
    if value is None:
        return 0.0
    return float(value) * CRORE_TO_MILLIONS


def _industry(soup: BeautifulSoup) -> str:
    labels = [
        a.get_text(" ", strip=True)
        for a in soup.select('a[href*="/market/"]')
        if a.get_text(" ", strip=True)
    ]
    return max(labels, key=len) if labels else ""


def _top_ratio(soup: BeautifulSoup, name: str) -> float | None:
    want = _fold(name)
    for item in soup.select("#top-ratios li"):
        label = item.select_one(".name")
        value = item.select_one(".value, .number")
        if label is None:
            continue
        if _fold(label.get_text()) != want:
            continue
        text = value.get_text(" ", strip=True) if value else item.get_text(" ", strip=True)
        return _parse_number(text)
    return None


def _website(soup: BeautifulSoup) -> str:
    for anchor in soup.select("a[href]"):
        href = (anchor.get("href") or "").strip()
        parsed = urlparse(href)
        host = (parsed.hostname or "").lower()
        if parsed.scheme in {"http", "https"} and host and host not in SCREENER_HOSTS and "nseindia" not in host and "bseindia" not in host:
            return href
    return ""


def parse_screener_html(html: str, ticker: str) -> IngestionResult:
    """Turn a Screener company HTML page into engine historicals. No network."""
    yahoo_ticker = ticker.strip().upper()
    code = india_nse_code(yahoo_ticker) or yahoo_ticker
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.find("h1")
    name = heading.get_text(" ", strip=True) if heading else code
    industry = _industry(soup)
    about = soup.select_one(".company-profile p, #company-info p")
    about_text = about.get_text(" ", strip=True) if about else ""
    if _FINANCIAL_INDUSTRY.search(industry) or _FINANCIAL_INDUSTRY.search(about_text[:240]):
        raise ScreenerUnsupported(
            f"'{yahoo_ticker}' ({industry or 'financial institution'}) is a balance-sheet-driven financial "
            "institution (bank, NBFC/lender, or insurer). A standard unlevered FCFF DCF is not "
            "methodologically appropriate here. Use 'Enter My Own Company' for a custom model."
        )

    pnl_table = _data_table(soup, "profit-loss")
    bs_table = _data_table(soup, "balance-sheet")
    cf_table = _data_table(soup, "cash-flow")
    if pnl_table is None or bs_table is None or cf_table is None:
        raise ScreenerUnavailable(f"'{yahoo_ticker}': Screener.in page is missing annual statement tables.")

    pnl_heads, pnl = _parse_table(pnl_table)
    bs_heads, bs = _parse_table(bs_table)
    cf_heads, cf = _parse_table(cf_table)

    pnl_years = {h: i for i, h in enumerate(pnl_heads) if _period_label(h)}
    bs_years = {h: i for i, h in enumerate(bs_heads) if _period_label(h)}
    cf_years = {h: i for i, h in enumerate(cf_heads) if _period_label(h)}
    shared = [h for h in pnl_heads if h in pnl_years and h in bs_years and h in cf_years]
    warnings: list[str] = []
    income_statements = []
    balance_sheets = []
    cash_flows = []

    for header in shared:
        fy = _period_label(header)
        if fy is None:
            continue
        pi, bi, ci = pnl_years[header], bs_years[header], cf_years[header]
        sales = _row_at(pnl, pi, "Sales", "Revenue")
        op = _row_at(pnl, pi, "Operating Profit")
        da = _row_at(pnl, pi, "Depreciation")
        pbt = _row_at(pnl, pi, "Profit before tax", "Profit Before Tax")
        np_ = _row_at(pnl, pi, "Net Profit")
        cfo = _row_at(cf, ci, "Cash from Operating Activity")
        total_assets = _row_at(bs, bi, "Total Assets")
        if sales is None or op is None or da is None or pbt is None or np_ is None or cfo is None or total_assets is None:
            continue
        if sales <= 0:
            continue

        interest = _row_at(pnl, pi, "Interest") or 0.0
        taxes = pbt - np_
        ebitda = op
        ebit = op - da
        inc = build_income_statement(
            fy,
            revenue=_cr(sales),
            ebitda=_cr(ebitda),
            ebit=_cr(ebit),
            pretax=_cr(pbt),
            interest=_cr(interest),
            taxes=_cr(taxes),
            cogs=0.0,
            rnd=0.0,
            sm=0.0,
            warnings=warnings,
        )
        income_statements.append(inc)

        equity_cap = _row_at(bs, bi, "Equity Capital") or 0.0
        reserves = _row_at(bs, bi, "Reserves") or 0.0
        borrowings = _row_at(bs, bi, "Borrowings") or 0.0
        other_liab = _row_at(bs, bi, "Other Liabilities") or 0.0
        fixed = _row_at(bs, bi, "Fixed Assets") or 0.0
        cwip = _row_at(bs, bi, "CWIP") or 0.0
        investments = _row_at(bs, bi, "Investments") or 0.0
        equity = equity_cap + reserves
        ppe = fixed + cwip
        # Screener "Investments" mixes cash-like, non-operating, and operating holdings.
        # Do not treat that line as cash. Park it in other assets until a structured source classifies it.
        explicit_assets = ppe
        other_assets_plug = total_assets - explicit_assets
        explicit_liab = borrowings
        other_liab_plug = total_assets - equity - explicit_liab
        if other_liab is not None and abs(other_liab_plug - other_liab) > max(1.0, 0.02 * abs(total_assets)):
            warnings.append(
                f"{fy}: Screener Other Liabilities ({other_liab:,.0f} Cr) differs from the residual "
                f"that ties the balance sheet ({other_liab_plug:,.0f} Cr). Using the residual so assets still balance."
            )
        balance_sheets.append(
            BalanceSheet(
                period=fy,
                cash=0.0,
                cash_reported=False,
                cash_status="unavailable",
                cash_source="Screener compact balance sheet omits cash",
                operating_wc_complete=False,
                nwc_status="unavailable",
                debt_status="available",
                debt_source="Screener Borrowings",
                marketable_securities=0.0,
                accounts_receivable=0.0,
                inventory=0.0,
                other_current_assets=0.0,
                ppe=_cr(ppe),
                goodwill=0.0,
                intangibles=0.0,
                other_assets=_cr(other_assets_plug),
                screener_other_assets_plug=_cr(other_assets_plug),
                screener_investments=_cr(investments),
                screener_borrowings=_cr(borrowings),
                accounts_payable=0.0,
                accrued_liabilities=0.0,
                short_term_debt=0.0,
                long_term_debt=_cr(borrowings),
                lease_liabilities=0.0,
                other_liabilities=_cr(other_liab_plug),
                shareholders_equity=_cr(equity),
            )
        )

        fcf = _row_at(cf, ci, "Free Cash Flow")
        cfi = _row_at(cf, ci, "Cash from Investing Activity") or 0.0
        cff = _row_at(cf, ci, "Cash from Financing Activity") or 0.0
        capex_cr = max((cfo - fcf), 0.0) if fcf is not None else 0.0
        if fcf is None:
            warnings.append(f"{fy}: Screener did not publish Free Cash Flow; capex is left at 0.")
        change_nwc_cr = (np_ + da) - cfo
        other_investing_cr = cfi + capex_cr
        payout = _row_at(pnl, pi, "Dividend Payout")
        dividends_cr = abs(np_) * (payout / 100.0) if payout is not None else 0.0
        debt_plug_cr = cff - 0.0 + dividends_cr
        cash_flows.append(
            CashFlowStatement(
                period=fy,
                net_income=_cr(np_),
                da=_cr(da),
                stock_based_comp=0.0,
                other_noncash=0.0,
                change_in_nwc=_cr(change_nwc_cr),
                capex=_cr(capex_cr),
                acquisitions=0.0,
                other_investing=_cr(other_investing_cr),
                debt_issuance_repayment=_cr(debt_plug_cr),
                equity_issuance_repurchase=0.0,
                dividends=_cr(dividends_cr),
            )
        )

    if len(income_statements) < 3:
        raise ScreenerUnavailable(
            f"'{yahoo_ticker}': Screener.in has fewer than 3 complete annual years "
            f"({len(income_statements)} usable)."
        )

    price = _top_ratio(soup, "Current Price")
    face = _top_ratio(soup, "Face Value") or 1.0
    latest_equity_cap = _row_at(bs, bs_years[shared[-1]], "Equity Capital") if shared else None
    shares_millions = None
    if latest_equity_cap and face:
        # Equity capital (crore) / face value = crore shares; *10 = millions of shares.
        shares_millions = (latest_equity_cap / face) * CRORE_TO_MILLIONS

    latest_bs = balance_sheets[-1]
    company = Company(
        name=name,
        ticker=yahoo_ticker,
        company_type=CompanyType.PUBLIC,
        currency="INR",
        units="millions",
        industry=industry,
        country="India",
        website=_website(soup),
        diluted_shares_outstanding=shares_millions,
        current_share_price=price,
        minority_interest=0.0,
        minority_interest_reported=False,
        preferred_stock=0.0,
        shares_status="estimated" if shares_millions else "unavailable",
        shares_source="Screener equity capital / face value" if shares_millions else "",
    )
    notes = [
        "Historical financials sourced from Screener.in (consolidated annual statements). "
        "Figures converted from INR crore to millions of INR.",
        "Screener Sales is operating revenue (other income is below EBIT). Expense is not split "
        "into COGS / R&D / S&M, so operating cost above EBITDA is shown as G&A.",
        "Cash, receivables, inventory, payables, and minority interest are not separate lines on "
        "Screener's compact balance sheet. They are stored as unavailable, not zero. "
        "Screener Investments is unclassified and is not treated as cash. "
        "Borrowings are treated as long-term debt. Capex is inferred as CFO minus Screener Free Cash Flow when both exist.",
        f"Last filed year on Screener: {income_statements[-1].period}. "
        "Refresh statements after results; Screener usually updates hours after the exchange filing, not live.",
    ]
    if not latest_bs.cash_reported:
        notes.append(
            "Screener compact statements do not itemise cash. The current-period cash line is filled from "
            "Yahoo Finance when that overlay succeeds. Historical years stay unavailable and are not treated as zero."
        )
    return IngestionResult(
        company=company,
        historicals=HistoricalFinancials(
            income_statements=income_statements,
            balance_sheets=balance_sheets,
            cash_flows=cash_flows,
        ),
        notes=notes,
        warnings=warnings,
    )


def _get(url: str) -> str:
    response = requests.get(
        url,
        timeout=FETCH_TIMEOUT_SECONDS,
        allow_redirects=True,
        headers={
            "User-Agent": "ConnectDCF/1.0 (local valuation; +https://screener.in)",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-IN,en;q=0.8",
        },
    )
    host = (urlparse(response.url).hostname or "").lower()
    if host not in SCREENER_HOSTS:
        raise ScreenerUnavailable("Screener.in redirected off-site; refused.")
    if response.status_code == 404:
        raise ScreenerUnavailable("Screener.in has no company page for this ticker.")
    if response.status_code >= 400:
        raise ScreenerUnavailable(f"Screener.in returned HTTP {response.status_code}.")
    body = response.content
    if len(body) > MAX_BODY_BYTES:
        raise ScreenerUnavailable("Screener.in response was larger than expected; refused.")
    return body.decode(response.encoding or "utf-8", errors="replace")


def _yahoo_overlay(ticker: str) -> dict[str, Any]:
    """Live price / shares from Yahoo. Failures are ignored — statements already loaded."""
    try:
        import yfinance as yf

        handle = yf.Ticker(ticker)
        info: dict[str, Any] = {}
        try:
            fast = handle.fast_info
            info["price"] = float(fast["lastPrice"])
            shares = float(fast["shares"])
            info["shares"] = shares / MILLION if shares >= 100_000 else shares
            info["currency"] = str(fast["currency"] or "INR")
        except Exception:
            pass
        try:
            blob = handle.info or {}
            if blob.get("longName"):
                info["name"] = blob["longName"]
            if blob.get("industry"):
                info["industry"] = blob["industry"]
            if blob.get("website"):
                info["website"] = blob["website"]
            price = blob.get("currentPrice") or blob.get("regularMarketPrice")
            if price and "price" not in info:
                info["price"] = float(price)
            shares = blob.get("sharesOutstanding")
            if shares and "shares" not in info:
                info["shares"] = float(shares) / MILLION
        except Exception:
            pass
        return info
    except Exception:
        return {}


def fetch_screener_company(ticker: str) -> IngestionResult:
    code = india_nse_code(ticker)
    if not code:
        raise ScreenerUnsupported(f"'{ticker}' is not an NSE/BSE Yahoo ticker (expected .NS or .BO).")
    path = quote(code, safe="")
    html = None
    last_error: Exception | None = None
    for suffix in (f"/company/{path}/consolidated/", f"/company/{path}/"):
        try:
            html = _get(f"{SCREENER_ORIGIN}{suffix}")
            break
        except ScreenerUnavailable as exc:
            last_error = exc
    if html is None:
        raise ScreenerUnavailable(str(last_error) if last_error else f"No Screener.in page for {code}.")
    result = parse_screener_html(html, ticker.strip().upper())
    overlay = _yahoo_overlay(ticker.strip().upper())
    updates: dict[str, Any] = {}
    if overlay.get("price"):
        updates["current_share_price"] = float(overlay["price"])
    if overlay.get("shares"):
        updates["diluted_shares_outstanding"] = float(overlay["shares"])
        updates["shares_status"] = "available"
        updates["shares_source"] = "Yahoo Finance sharesOutstanding"
    if overlay.get("name"):
        updates["name"] = overlay["name"]
    if overlay.get("website") and not result.company.website:
        updates["website"] = overlay["website"]
    if overlay.get("currency"):
        updates["currency"] = overlay["currency"]
    if updates:
        result.company = result.company.model_copy(update=updates)
        result.notes.append("Current share price and share count overlaid from Yahoo Finance when available.")
    result = apply_yahoo_bridge_overlay(result, ticker.strip().upper())
    return result
