"""
Equity-bridge overlay from Yahoo Finance annual balance sheets.

Screener.in's compact balance sheet omits cash, receivables, inventory,
payables, leases, and NCI. Yahoo's annual `balance_sheet` typically has ~4
fiscal years. Each Screener period is matched by fiscal year and filled only
where Yahoo actually has a number. Unmatched historical years stay labelled
unavailable; they are not filled with zeros.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
import yfinance as yf

from ..engine.models import Company, HistoricalFinancials
from .yfinance_ingestion import MILLION, IngestionResult, _match_index


def _raw(df: pd.DataFrame, *labels: str) -> pd.Series | None:
    name = _match_index(df, *labels)
    if not name:
        return None
    return df.loc[name]


def _cell(series: pd.Series | None, col) -> float | None:
    if series is None or col is None:
        return None
    try:
        value = series.loc[col]
    except Exception:
        return None
    if pd.isna(value):
        return None
    return float(value) / MILLION


def _period_key(col) -> str:
    year = getattr(col, "year", None)
    if year is None:
        text = str(col)
        digits = "".join(ch for ch in text if ch.isdigit())
        year = int(digits[:4]) if len(digits) >= 4 else text
    return f"FY{year}"


def _bridge_items_for_column(bs: pd.DataFrame, col) -> dict[str, Any]:
    out: dict[str, Any] = {"period": _period_key(col)}
    cash = _cell(_raw(bs, "Cash And Cash Equivalents"), col)
    st_inv = _cell(_raw(bs, "Other Short Term Investments"), col)
    cash_and_st = _cell(_raw(bs, "Cash Cash Equivalents And Short Term Investments"), col)
    ar = _cell(_raw(bs, "Accounts Receivable"), col)
    inv = _cell(_raw(bs, "Inventory"), col)
    other_ca_raw = _cell(_raw(bs, "Other Current Assets"), col)
    ap = _cell(_raw(bs, "Accounts Payable"), col)
    other_cl = _cell(_raw(bs, "Other Current Liabilities"), col)
    current_debt = _cell(_raw(bs, "Current Debt And Capital Lease Obligation"), col)
    current_lease = _cell(_raw(bs, "Current Capital Lease Obligation"), col)
    lt_debt = _cell(_raw(bs, "Long Term Debt And Capital Lease Obligation"), col)
    lt_lease = _cell(_raw(bs, "Long Term Capital Lease Obligation"), col)
    nci = _cell(_raw(bs, "Minority Interest"), col)
    ppe = _cell(_raw(bs, "Net PPE"), col)
    goodwill = _cell(_raw(bs, "Goodwill"), col)
    intangibles = _cell(_raw(bs, "Other Intangible Assets"), col)
    total_assets = _cell(_raw(bs, "Total Assets"), col)
    restricted = _cell(_raw(bs, "Restricted Cash"), col)
    prepaid = _cell(_raw(bs, "Prepaid Assets"), col)
    hedging = _cell(_raw(bs, "Hedging Assets Current"), col)
    held_for_sale = _cell(_raw(bs, "Assets Held For Sale Current"), col)
    dta = _cell(_raw(bs, "Non Current Deferred Taxes Assets"), col)
    lt_equity = _cell(_raw(bs, "Long Term Equity Investment"), col)
    fin_assets = _cell(_raw(bs, "Financial Assets"), col)
    lt_inv = _cell(
        _raw(bs, "Long Term Investments", "Investments And Advances", "Investmentin Financial Assets"),
        col,
    )
    other_inv = _cell(_raw(bs, "Other Investments", "Available For Sale Securities"), col)
    if cash is not None:
        out["cash"] = cash
    if st_inv is not None:
        out["marketable_securities"] = st_inv
    elif cash is not None and cash_and_st is not None and cash_and_st > cash:
        out["marketable_securities"] = cash_and_st - cash
    if ar is not None:
        out["accounts_receivable"] = ar
    if inv is not None:
        out["inventory"] = inv
    other_ca = 0.0
    other_ca_found = False
    if prepaid is not None:
        other_ca += prepaid
        other_ca_found = True
    if hedging is not None:
        other_ca += hedging
        other_ca_found = True
    if other_ca_found:
        out["other_current_assets"] = other_ca
    elif other_ca_raw is not None:
        out["other_current_assets"] = other_ca_raw
    if ap is not None:
        out["accounts_payable"] = ap
    if other_cl is not None:
        out["accrued_liabilities"] = other_cl
    if current_debt is not None or current_lease is not None:
        out["short_term_debt"] = max((current_debt or 0.0) - (current_lease or 0.0), 0.0)
    if lt_debt is not None or lt_lease is not None:
        out["long_term_debt"] = max((lt_debt or 0.0) - (lt_lease or 0.0), 0.0)
    if current_lease is not None or lt_lease is not None:
        out["lease_liabilities"] = (current_lease or 0.0) + (lt_lease or 0.0)
    if nci is not None:
        out["minority_interest"] = nci
    if current_debt is not None:
        out["current_debt_and_leases"] = current_debt
    if lt_debt is not None:
        out["long_term_debt_and_leases"] = lt_debt
    if current_lease is not None:
        out["current_leases"] = current_lease
    if lt_lease is not None:
        out["long_term_leases"] = lt_lease
    if ppe is not None:
        out["ppe"] = ppe
    if goodwill is not None:
        out["goodwill"] = goodwill
    if intangibles is not None:
        out["intangibles"] = intangibles
    if total_assets is not None:
        out["total_assets"] = total_assets
    if restricted is not None:
        out["restricted_cash"] = restricted
    if dta is not None:
        out["deferred_tax_assets"] = dta
    if held_for_sale is not None:
        out["assets_held_for_sale"] = held_for_sale
    if lt_inv is not None:
        out["long_term_investments"] = lt_inv
    if other_inv is not None:
        out["available_for_sale"] = other_inv
    if lt_equity is not None:
        out["associate_investments"] = lt_equity
    if fin_assets is not None:
        out["other_financial_assets"] = fin_assets
    noi = 0.0
    noi_found = False
    for part in (lt_inv, other_inv, lt_equity, fin_assets):
        if part is not None:
            noi += part
            noi_found = True
    if noi_found:
        out["non_operating_investments"] = noi
    return out


def _overlay_sheet(sheet, items: dict[str, Any], *, latest: bool) -> tuple[Any, list[str]]:
    """Return (updated_sheet, notes) for one historical period."""
    updates: dict[str, Any] = {}
    notes: list[str] = []
    label = items.get("period") or sheet.period
    scope = "Latest-year" if latest else f"{sheet.period}"

    if "cash" in items:
        updates["cash"] = items["cash"]
        updates["cash_reported"] = True
        updates["cash_status"] = "available"
        updates["cash_source"] = f"Yahoo Finance annual balance sheet ({label})"
        notes.append(f"{scope} cash {items['cash']:,.1f}m overlaid from Yahoo Finance ({label}).")
    if "marketable_securities" in items:
        updates["marketable_securities"] = items["marketable_securities"]
        if latest:
            notes.append(
                "Short-term investments taken from Yahoo Finance (cash-like), not Screener's undifferentiated Investments line."
            )
    if "accounts_receivable" in items:
        updates["accounts_receivable"] = items["accounts_receivable"]
    if "inventory" in items:
        updates["inventory"] = items["inventory"]
    if "other_current_assets" in items:
        updates["other_current_assets"] = items["other_current_assets"]
    if "accounts_payable" in items:
        updates["accounts_payable"] = items["accounts_payable"]
    if "accrued_liabilities" in items:
        updates["accrued_liabilities"] = items["accrued_liabilities"]
    wc_ok = "accounts_receivable" in items and "accounts_payable" in items
    if wc_ok:
        updates["operating_wc_complete"] = True
        updates["nwc_status"] = "available"
        if latest:
            notes.append("Operating WC (AR/AP) overlaid from Yahoo for each matched fiscal year.")
    if "short_term_debt" in items or "long_term_debt" in items:
        if "short_term_debt" in items:
            updates["short_term_debt"] = items["short_term_debt"]
        if "long_term_debt" in items:
            updates["long_term_debt"] = items["long_term_debt"]
        updates["debt_status"] = "available"
        updates["debt_source"] = f"Yahoo Finance annual balance sheet ({label})"
        if latest:
            notes.append("Debt split (ST/LT) overlaid from Yahoo Finance for matched fiscal years.")
    if "lease_liabilities" in items:
        updates["lease_liabilities"] = items["lease_liabilities"]
        if latest:
            notes.append(
                "Lease liabilities overlaid from Yahoo Finance (current + non-current capital leases). "
                "These are separate from ST/LT borrowings, which already exclude the lease component of "
                "Yahoo's 'Debt and Capital Lease Obligation' totals."
            )
    if "ppe" in items:
        updates["ppe"] = items["ppe"]
    if "goodwill" in items:
        updates["goodwill"] = items["goodwill"]
    if "intangibles" in items:
        updates["intangibles"] = items["intangibles"]
    if "non_operating_investments" in items:
        noi = items["non_operating_investments"] + float(items.get("assets_held_for_sale") or 0.0)
        updates["non_operating_investments"] = noi
        updates["non_operating_investments_status"] = "available"
        updates["non_operating_investments_source"] = "Yahoo Finance long-term / associate / held-for-sale investments"
        if latest:
            notes.append(
                f"Non-operating investments {noi:,.1f}m from Yahoo. "
                "These are added in the equity bridge as non-operating assets, not as cash."
            )
    updates["source_overlay"] = {k: v for k, v in items.items() if k not in {"shares", "price", "years"}}
    if "total_assets" in items:
        updates["reported_total_assets"] = items["total_assets"]
        working = sheet.model_copy(update=updates)
        mapped = (
            working.cash
            + working.marketable_securities
            + working.accounts_receivable
            + working.inventory
            + working.other_current_assets
            + working.ppe
            + working.goodwill
            + working.intangibles
            + working.non_operating_investments
            + float(items.get("restricted_cash") or 0.0)
            + float(items.get("deferred_tax_assets") or 0.0)
        )
        residual = items["total_assets"] - mapped
        updates["other_assets"] = residual
        plug = sheet.screener_other_assets_plug
        if latest:
            notes.append(
                f"{scope} other_assets residual reset to {residual:,.1f}m = Yahoo Total Assets "
                f"{items['total_assets']:,.1f}m minus mapped lines. "
                f"Screener compact plug was {plug:,.1f}m and is not a remaining unidentified asset."
                if plug is not None
                else f"{scope} other_assets residual {residual:,.1f}m versus Yahoo Total Assets."
            )

    if not updates:
        return sheet, notes
    return sheet.model_copy(update=updates), notes


def fetch_yahoo_latest_bridge(ticker: str) -> dict[str, Any]:
    """Return Yahoo annual bridge lines by fiscal year, plus shares/price, or {}."""
    out: dict[str, Any] = {}
    try:
        handle = yf.Ticker(ticker)
        bs = handle.balance_sheet
        if bs is None or getattr(bs, "empty", True):
            return out
        columns = list(bs.columns)
        if not columns:
            return out
        latest = columns[0]
        for c in columns:
            try:
                if c > latest:
                    latest = c
            except TypeError:
                continue
        years: dict[str, dict[str, Any]] = {}
        for col in columns:
            year_items = _bridge_items_for_column(bs, col)
            years[year_items["period"]] = year_items
        latest_items = years.get(_period_key(latest), {})
        out.update(latest_items)
        out["period"] = latest_items.get("period") or _period_key(latest)
        out["years"] = years
        try:
            info = handle.info or {}
            shares = info.get("sharesOutstanding")
            if shares:
                out["shares"] = float(shares) / MILLION
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            if price:
                out["price"] = float(price)
        except Exception:
            pass
        return out
    except Exception:
        return out


def _year_map(items: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Accept the new {years: {...}} shape or the legacy latest-only dict."""
    years = items.get("years")
    if isinstance(years, dict) and years:
        return {str(k): dict(v) for k, v in years.items() if isinstance(v, dict)}
    period = items.get("period")
    if period:
        return {str(period): {k: v for k, v in items.items() if k not in {"years", "shares", "price"}}}
    return {}


def apply_yahoo_bridge_overlay(result: IngestionResult, ticker: str) -> IngestionResult:
    items = fetch_yahoo_latest_bridge(ticker)
    years = _year_map(items) if items else {}
    if not items or not years:
        result.notes.append(
            "Yahoo Finance annual balance sheet could not be overlaid. Cash/NCI remain unavailable "
            "from Screener's compact statement; they are not treated as zero."
        )
        return result

    hist: HistoricalFinancials = result.historicals
    notes: list[str] = []
    matched: list[str] = []
    new_sheets = []
    latest_period = hist.balance_sheets[-1].period if hist.balance_sheets else ""
    for sheet in hist.balance_sheets:
        year_items = years.get(sheet.period)
        if not year_items:
            new_sheets.append(sheet)
            continue
        updated, year_notes = _overlay_sheet(sheet, year_items, latest=sheet.period == latest_period)
        new_sheets.append(updated)
        notes.extend(year_notes)
        matched.append(sheet.period)
    hist.balance_sheets = new_sheets

    unmatched = [bs.period for bs in hist.balance_sheets if bs.period not in matched]
    if matched:
        notes.append(
            "Yahoo Finance annual balance sheet overlaid for "
            + ", ".join(matched)
            + ". Unmatched Screener years stay unavailable and are not filled with zeros."
            if unmatched
            else "Yahoo Finance annual balance sheet overlaid for " + ", ".join(matched) + "."
        )

    company: Company = result.company
    company_updates: dict[str, Any] = {}
    latest_items = years.get(latest_period) or items
    if "minority_interest" in latest_items:
        company_updates["minority_interest"] = latest_items["minority_interest"]
        company_updates["minority_interest_reported"] = True
        notes.append(f"Minority interest {latest_items['minority_interest']:,.1f}m from Yahoo Finance ({latest_period or 'latest'}).")
    if items.get("shares"):
        company_updates["diluted_shares_outstanding"] = items["shares"]
        company_updates["shares_status"] = "available"
        company_updates["shares_source"] = "Yahoo Finance sharesOutstanding"
    if items.get("price"):
        company_updates["current_share_price"] = items["price"]
    if company_updates:
        result.company = company.model_copy(update=company_updates)
    result.notes.extend(notes)
    return result
