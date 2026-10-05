"""Classify balance-sheet lines for the EV → equity bridge.

Screener's compact sheet parks (Total Assets − PPE) in `other_assets`. That
plug is not a real asset. After a structured overlay, each mapped line is
labelled operating / non-operating / unknown. Only identified non-operating
financial assets are added to equity. Residual unknown is flagged, never
auto-added. Primary annual-report PDF extraction is not implemented.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from .models import BalanceSheet, Company
from .valuation import DCFValuationResult


class AssetLine(BaseModel):
    name: str
    amount: float
    source: str
    accounting: str
    operating: str  # operating | non_operating | mixed | unknown
    already_in_ev: bool
    equity_adjustment: bool
    reason: str
    confidence: str  # High | Medium | Low


class AssetClassification(BaseModel):
    lines: list[AssetLine] = Field(default_factory=list)
    reported_total_assets: float | None = None
    mapped_explicit: float = 0.0
    residual_unknown: float = 0.0
    equity_additions: float = 0.0
    screener_plug: float | None = None
    primary_statements: str = "unavailable"
    primary_statements_note: str = (
        "Audited annual-report PDF extraction is not implemented. "
        "Classification uses Screener compact statements plus the latest Yahoo Finance balance sheet."
    )
    material_unclassified: bool = False
    materiality_vs_ev: float | None = None


def _line(
    name: str,
    amount: float,
    *,
    source: str,
    accounting: str,
    operating: str,
    already_in_ev: bool,
    equity_adjustment: bool,
    reason: str,
    confidence: str,
) -> AssetLine:
    return AssetLine(
        name=name,
        amount=amount,
        source=source,
        accounting=accounting,
        operating=operating,
        already_in_ev=already_in_ev,
        equity_adjustment=equity_adjustment,
        reason=reason,
        confidence=confidence,
    )


def classify_latest_assets(
    bs: BalanceSheet,
    *,
    overlay: dict | None = None,
    enterprise_value: float | None = None,
    screener_plug: float | None = None,
) -> AssetClassification:
    overlay = dict(overlay) if overlay is not None else dict(bs.source_overlay or {})
    screener_plug = bs.screener_other_assets_plug if screener_plug is None else screener_plug
    yahoo = f"Yahoo Finance latest annual balance sheet ({overlay.get('period') or bs.period})"
    lines: list[AssetLine] = []

    def add(*args, **kwargs) -> None:
        line = _line(*args, **kwargs)
        if abs(line.amount) > 1e-9:
            lines.append(line)

    add(
        "Cash & cash equivalents",
        bs.cash,
        source=bs.cash_source or yahoo,
        accounting="Cash and cash equivalents",
        operating="non_operating",
        already_in_ev=False,
        equity_adjustment=True,
        reason="Financial asset. Added in the equity bridge. Not in FCFF.",
        confidence="High" if bs.cash_status == "available" else "Low",
    )
    add(
        "Short-term / marketable investments",
        bs.marketable_securities,
        source=yahoo,
        accounting="Current investments",
        operating="non_operating",
        already_in_ev=False,
        equity_adjustment=True,
        reason="Cash-like marketable securities. Added in the equity bridge, not as operating NWC.",
        confidence="High",
    )
    add(
        "Accounts receivable",
        bs.accounts_receivable,
        source=yahoo,
        accounting="Trade receivables",
        operating="operating",
        already_in_ev=True,
        equity_adjustment=False,
        reason="Operating working capital. Captured in ΔNWC / FCFF. Do not add again.",
        confidence="High",
    )
    add(
        "Inventory",
        bs.inventory,
        source=yahoo,
        accounting="Inventories",
        operating="operating",
        already_in_ev=True,
        equity_adjustment=False,
        reason="Operating working capital. Captured in ΔNWC / FCFF. Do not add again.",
        confidence="High",
    )
    add(
        "Other current operating assets",
        bs.other_current_assets,
        source=yahoo,
        accounting="Prepayments / other current assets",
        operating="operating",
        already_in_ev=True,
        equity_adjustment=False,
        reason="Treated as operating WC (prepayments, hedging, similar). Already in EV via FCFF.",
        confidence="Medium",
    )
    add(
        "Net PP&E (incl. CWIP)",
        bs.ppe,
        source=yahoo if overlay.get("ppe") is not None else "Screener Fixed Assets + CWIP",
        accounting="Property, plant and equipment",
        operating="operating",
        already_in_ev=True,
        equity_adjustment=False,
        reason="Operating asset. Future capex/D&A are in FCFF. Do not add again.",
        confidence="High",
    )
    add(
        "Goodwill",
        bs.goodwill,
        source=yahoo,
        accounting="Goodwill",
        operating="operating",
        already_in_ev=True,
        equity_adjustment=False,
        reason="Operating (acquired going-concern). Already in EV. Not a surplus cash-like asset.",
        confidence="High",
    )
    add(
        "Intangible assets",
        bs.intangibles,
        source=yahoo,
        accounting="Other intangible assets",
        operating="operating",
        already_in_ev=True,
        equity_adjustment=False,
        reason="Operating. Already in EV.",
        confidence="High",
    )
    components = [
        ("Long-term investments", "long_term_investments", "Non-current investments"),
        ("Available-for-sale / other investments", "available_for_sale", "Other investments / AFS"),
        ("Associate / equity-method investments", "associate_investments", "Long-term equity investment"),
        ("Other financial assets", "other_financial_assets", "Financial assets"),
    ]
    parts = [(name, overlay.get(key), acct) for name, key, acct in components if overlay.get(key)]
    if parts:
        for name, amount, acct in parts:
            add(
                name,
                float(amount or 0.0),
                source=bs.non_operating_investments_source or yahoo,
                accounting=acct,
                operating="non_operating",
                already_in_ev=False,
                equity_adjustment=True,
                reason="Identified financial / associate investment not in operating FCFF. Added to equity.",
                confidence="Medium",
            )
    else:
        add(
            "Long-term / strategic / other investments",
            bs.non_operating_investments,
            source=bs.non_operating_investments_source or yahoo,
            accounting="Non-current investments, associates, financial assets",
            operating="non_operating",
            already_in_ev=False,
            equity_adjustment=True,
            reason="Identified financial / associate investments not in operating FCFF. Added to equity.",
            confidence="Medium" if bs.non_operating_investments_status == "available" else "Low",
        )
    restricted = float(overlay.get("restricted_cash") or 0.0)
    add(
        "Restricted cash",
        restricted,
        source=yahoo,
        accounting="Restricted cash",
        operating="mixed",
        already_in_ev=False,
        equity_adjustment=False,
        reason="Not treated as free cash. Flagged, not auto-added.",
        confidence="Medium",
    )
    dta = float(overlay.get("deferred_tax_assets") or 0.0)
    add(
        "Deferred tax assets",
        dta,
        source=yahoo,
        accounting="Deferred tax assets",
        operating="operating",
        already_in_ev=True,
        equity_adjustment=False,
        reason="Tax timing difference. Forecast NOPAT already uses a statutory tax rate. Do not add.",
        confidence="Medium",
    )
    held = float(overlay.get("assets_held_for_sale") or 0.0)
    add(
        "Assets held for sale",
        held,
        source=yahoo,
        accounting="Assets held for sale",
        operating="non_operating",
        already_in_ev=False,
        equity_adjustment=False,
        reason="Folded into identified non-operating investments when the overlay maps held-for-sale. Not added a second time.",
        confidence="Low",
    )

    reported = overlay.get("total_assets")
    if reported is None:
        reported = bs.reported_total_assets
    mapped = (
        bs.cash
        + bs.marketable_securities
        + bs.accounts_receivable
        + bs.inventory
        + bs.other_current_assets
        + bs.ppe
        + bs.goodwill
        + bs.intangibles
        + bs.non_operating_investments
        + restricted
        + dta
    )
    # Held-for-sale is already folded into non_operating_investments by the overlay.
    residual = (reported - mapped) if reported is not None else bs.other_assets
    add(
        "Unclassified residual (other assets)",
        residual,
        source=yahoo if reported is not None else "Screener compact plug (Total Assets − PPE)",
        accounting="Residual after mapped lines",
        operating="unknown",
        already_in_ev=False,
        equity_adjustment=False,
        reason=(
            "Not added. Could mix operating WC, financial assets, or mapping residuals. "
            "Primary statements would be required to allocate this line."
        ),
        confidence="Low",
    )

    equity_add = sum(ln.amount for ln in lines if ln.equity_adjustment)
    material = False
    mat_vs_ev = None
    if enterprise_value and abs(enterprise_value) > 1:
        mat_vs_ev = abs(residual) / abs(enterprise_value)
        material = mat_vs_ev > 0.10
    elif abs(residual) > 0:
        material = True

    return AssetClassification(
        lines=lines,
        reported_total_assets=reported,
        mapped_explicit=mapped,
        residual_unknown=residual,
        equity_additions=equity_add,
        screener_plug=screener_plug,
        material_unclassified=material,
        materiality_vs_ev=mat_vs_ev,
    )


def nci_consistent_with_consolidated_fcff(company: Company) -> dict:
    """FCFF is built from consolidated EBIT, so NCI is a claim on consolidated EV."""
    reported = bool(company.minority_interest_reported)
    return {
        "nci": company.minority_interest if reported else None,
        "nci_reported": reported,
        "fcff_basis": "consolidated_ebit",
        "subtract_nci": reported,
        "reason": (
            "Consolidated EBIT/FCFF includes subsidiaries. NCI is subtracted in the equity bridge."
            if reported
            else "NCI is not a verified line; it is not treated as zero in the narrative."
        ),
    }


def detect_group_structure(
    company: Company,
    bs: BalanceSheet,
    valuation: DCFValuationResult | None,
) -> dict:
    ev = valuation.enterprise_value if valuation else 0.0
    nci = company.minority_interest if company.minority_interest_reported else 0.0
    noi = bs.non_operating_investments
    equity_bv = abs(bs.shareholders_equity) or 1.0
    flags: list[str] = []
    if ev and nci > 0.15 * abs(ev):
        flags.append("NCI is large versus enterprise value.")
    if nci > 0.15 * equity_bv:
        flags.append("NCI is large versus book equity.")
    if ev and noi > 0.20 * abs(ev):
        flags.append("Identified investments are large versus enterprise value.")
    if ev and nci > abs(ev):
        flags.append("NCI exceeds enterprise value — standard FCFF + NCI subtraction may be the wrong architecture.")
    complex_ = bool(flags)
    sotp = bool(ev and (nci > abs(ev) or noi > abs(ev)))
    return {
        "complex_group_structure": complex_,
        "sotp_review_required": sotp,
        "nci": nci,
        "non_operating_investments": noi,
        "enterprise_value": ev,
        "flags": flags,
        "note": (
            "SOTP REVIEW REQUIRED: large NCI/investments relative to consolidated EV. "
            "A holding-company or sum-of-the-parts model is not implemented."
            if sotp
            else ("COMPLEX GROUP STRUCTURE" if complex_ else "No group-structure flag.")
        ),
    }
