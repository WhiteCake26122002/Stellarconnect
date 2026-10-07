"""Mutual fund holdings for the signed-in Connect account."""
from __future__ import annotations

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from backend import regulatory
from backend.mutual_funds import benchmarks, context, costs, insights, lots as lotlib, metrics, nav, sip, tax as taxlib
from backend.mutual_funds.portfolio import analysis_view, portfolio_view

from ..auth import require_user
from ..db import get_db
from ..orm import MfFundSetting, MfHolding, MfTransaction

router = APIRouter(prefix="/v1/funds", tags=["funds"])


class AddHoldingRequest(BaseModel):
    scheme_code: int = Field(gt=0)
    units: float | None = Field(default=None, gt=0)
    #: Money paid, as an alternative to units. Stamp duty comes out of it and units are allotted on the rest.
    amount: float | None = Field(default=None, gt=0)
    avg_nav: float | None = Field(default=None, gt=0)
    purchase_date: str | None = None

    @model_validator(mode="after")
    def _one_of_units_or_amount(self):
        if (self.units is None) == (self.amount is None):
            raise ValueError("Give either units or the amount paid, not both.")
        return self


class SipRequest(BaseModel):
    scheme_code: int = Field(gt=0)
    amount: float = Field(gt=0, description="Rupees per instalment")
    day_of_month: int = Field(ge=1, le=31)
    start_date: str
    installments: int | None = Field(default=None, ge=1, le=sip.MAX_INSTALMENTS)
    end_date: str | None = None


class RedeemRequest(BaseModel):
    units: float | None = Field(default=None, gt=0)
    all: bool = False
    nav: float | None = Field(default=None, gt=0)
    date: str | None = None

    @model_validator(mode="after")
    def _units_or_all(self):
        if (self.units is None) == (not self.all):
            raise ValueError("Give the units to redeem, or set all to redeem every unit.")
        return self


class PreviewRequest(RedeemRequest):
    slab_rate_pct: float | None = Field(default=None, ge=0, le=45)
    income_band: str | None = None
    regime: Literal["new", "old"] = "new"


class ExitLoadTier(BaseModel):
    days: int = Field(gt=0, le=3650)
    pct: float = Field(ge=0, le=10)


class SettingsRequest(BaseModel):
    #: null clears the override and goes back to the AMFI category.
    tax_class: Literal["equity", "specified", "other"] | None = None
    #: null clears it; [] is the same.
    exit_load: list[ExitLoadTier] | None = None


def _parse_date(value: str | None) -> dt.date:
    if not value:
        return dt.date.today()
    try:
        parsed = dt.date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD.") from exc
    if parsed > dt.date.today():
        raise HTTPException(status_code=400, detail="Date cannot be in the future.")
    return parsed


def _holdings(db: Session, user_id: str) -> list[MfHolding]:
    return (
        db.query(MfHolding)
        .filter(MfHolding.user_id == user_id)
        .order_by(MfHolding.scheme_name)
        .all()
    )


def _transactions(db: Session, user_id: str) -> list[MfTransaction]:
    return (
        db.query(MfTransaction)
        .filter(MfTransaction.user_id == user_id)
        .order_by(MfTransaction.trade_date, MfTransaction.created_at)
        .all()
    )


def _settings(db: Session, user_id: str) -> dict[int, dict]:
    rows = db.query(MfFundSetting).filter(MfFundSetting.user_id == user_id).all()
    return {r.scheme_code: {"tax_class": r.tax_class, "exit_load": r.exit_load_json or None} for r in rows}


def _profile(slab: str | None, band: str | None, regime: str | None) -> taxlib.TaxProfile:
    return taxlib.TaxProfile.from_params(slab=slab, band=band, regime=regime)


def _backfill(db: Session, user_id: str, scheme_code: int) -> None:
    """A holding that predates the transactions table gets one aggregated lot before anything is
    recorded against it, so its original units are not dropped from the cash-flow history."""
    existing = (
        db.query(MfTransaction)
        .filter(MfTransaction.user_id == user_id, MfTransaction.scheme_code == scheme_code)
        .first()
    )
    if existing:
        return
    holding = (
        db.query(MfHolding)
        .filter(MfHolding.user_id == user_id, MfHolding.scheme_code == scheme_code)
        .one_or_none()
    )
    if holding:
        db.add(MfTransaction(
            user_id=user_id, scheme_code=scheme_code, kind="buy", trade_date=holding.purchase_date,
            units=holding.units, nav=holding.avg_nav, source="aggregated",
        ))
        db.flush()


def _nav_for(detail: dict, day: dt.date) -> tuple[dt.date, float]:
    """The NAV the scheme actually published on `day` (or the last business day before it)."""
    found = metrics.nav_on_date(detail["nav_history"], day)
    if found is None:
        first = min(d for d, _ in detail["nav_history"])
        raise HTTPException(
            status_code=400,
            detail=(
                f"No NAV is published for {day.isoformat()}. This scheme's history starts {first.isoformat()}."
                if day < first
                else f"No NAV is published within a week of {day.isoformat()}. Enter the NAV you paid instead."
            ),
        )
    return found


def _view(db: Session, user_id: str) -> dict:
    return portfolio_view(_holdings(db, user_id), _transactions(db, user_id))


def _record_purchase(db: Session, user_id: str, detail: dict, scheme_code: int, units: float, price: float, day: dt.date, source: str) -> None:
    """One dated purchase: a transaction (its own tax lot) and the running holding."""
    existing = (
        db.query(MfHolding)
        .filter(MfHolding.user_id == user_id, MfHolding.scheme_code == scheme_code)
        .one_or_none()
    )
    name = detail["scheme_name"]
    if existing:
        _backfill(db, user_id, scheme_code)
        new_units = existing.units + units
        existing.avg_nav = (existing.units * existing.avg_nav + units * price) / new_units
        existing.units = new_units
        existing.scheme_name = name
        existing.purchase_date = min(existing.purchase_date, day.isoformat())
    else:
        db.add(MfHolding(
            user_id=user_id, scheme_code=scheme_code, scheme_name=name,
            units=units, avg_nav=price, purchase_date=day.isoformat(),
        ))
    db.add(MfTransaction(
        user_id=user_id, scheme_code=scheme_code, kind="buy", trade_date=day.isoformat(),
        units=units, nav=price, source=source,
    ))
    db.flush()


@router.get("/schemes")
def search_schemes(
    request: Request,
    db: Session = Depends(get_db),
    q: str = Query(default="", max_length=80),
    limit: int = Query(default=12, ge=1, le=25),
):
    require_user(request, db)
    query = q.strip()
    if len(query) < 2:
        return {"results": []}
    schemes = nav.get_all_schemes()
    if not schemes:
        raise HTTPException(status_code=503, detail="The NAV list is unavailable right now. Try again shortly.")
    return {"results": nav.search_schemes(query, schemes, limit=limit)}


@router.get("/schemes/{scheme_code}")
def scheme_quote(scheme_code: int, request: Request, db: Session = Depends(get_db)):
    require_user(request, db)
    detail = nav.get_scheme_detail(scheme_code)
    if detail is None:
        raise HTTPException(status_code=404, detail="Could not fetch a live NAV for this scheme.")
    nav_date, price = nav.latest_nav(detail)
    return {
        "scheme_code": scheme_code,
        "scheme_name": detail["scheme_name"],
        "fund_house": detail["fund_house"],
        "scheme_category": detail["scheme_category"],
        "nav": price,
        "nav_date": nav_date.isoformat(),
        "inception_date": min(d for d, _ in detail["nav_history"]).isoformat(),
        "changes": metrics.trailing_changes(detail["nav_history"]),
    }


def _thin(history: list[tuple[dt.date, float]], daily_days: int = 400) -> list[tuple[dt.date, float]]:
    """Oldest-first marks, daily for the recent past and weekly (the last mark of each week) before it,
    so a twenty-year fund stays a chart-sized payload. The latest mark is always kept."""
    if not history:
        return []
    cutoff = history[-1][0] - dt.timedelta(days=daily_days)
    out: list[tuple[dt.date, float]] = []
    week: tuple[int, int] | None = None
    for day, value in history:
        if day >= cutoff:
            if week is not None:
                week = None
            out.append((day, value))
            continue
        iso = day.isocalendar()
        key = (iso[0], iso[1])
        if key == week and out:
            out[-1] = (day, value)  # a later mark in the same week replaces the earlier one
        else:
            out.append((day, value))
            week = key
    return out


def _on_or_before(sorted_days: list[dt.date], values: list[float], day: dt.date) -> float | None:
    from bisect import bisect_right

    i = bisect_right(sorted_days, day) - 1
    # An index close more than a week stale is a gap, not a value.
    return values[i] if i >= 0 and (day - sorted_days[i]).days <= 7 else None


@router.get("/schemes/{scheme_code}/history")
def scheme_history(scheme_code: int, request: Request, db: Session = Depends(get_db)):
    """A scheme's published NAV path, with the closes of its own benchmark index on the same dates when one exists.
    Both are raw levels; the page rebases them to 100 at whatever start the reader picks."""
    require_user(request, db)
    detail = nav.get_scheme_detail(scheme_code)
    if detail is None or not detail["nav_history"]:
        raise HTTPException(status_code=404, detail="Could not fetch NAV history for this scheme.")
    history = sorted((d, float(v)) for d, v in detail["nav_history"])
    mapping = benchmarks.benchmark_for(detail["scheme_category"], detail["scheme_name"])
    bench_days: list[dt.date] = []
    bench_vals: list[float] = []
    bench_meta = None
    if mapping["key"]:
        ticker, label = benchmarks.INDEX_TICKERS[mapping["key"]]
        index = sorted(nav.get_index_history(ticker))
        if index:
            bench_days = [d for d, _ in index]
            bench_vals = [v for _, v in index]
            bench_meta = {"key": mapping["key"], "label": label, "proxy": bool(mapping.get("proxy")), "note": mapping.get("note") or "", "basis": benchmarks.PRICE_BASIS_NOTE}
    points = []
    for day, value in _thin(history):
        points.append({"date": day.isoformat(), "nav": value, "bench": _on_or_before(bench_days, bench_vals, day) if bench_meta else None})
    return {
        "scheme_code": scheme_code,
        "scheme_name": detail["scheme_name"],
        "category": detail["scheme_category"],
        "inception_date": history[0][0].isoformat(),
        "as_of": history[-1][0].isoformat(),
        "points": points,
        "benchmark": bench_meta,
        "benchmark_reason": None if bench_meta else (mapping.get("reason") or "No benchmark history is available for this scheme."),
    }


@router.get("/schemes/{scheme_code}/nav")
def scheme_nav_on(scheme_code: int, request: Request, db: Session = Depends(get_db), date: str = Query(...)):
    """The NAV a scheme published on a given date, for pre-filling a historical purchase."""
    require_user(request, db)
    detail = nav.get_scheme_detail(scheme_code)
    if detail is None:
        raise HTTPException(status_code=404, detail="Could not fetch NAV history for this scheme.")
    day = _parse_date(date)
    used, price = _nav_for(detail, day)
    return {"scheme_code": scheme_code, "requested": day.isoformat(), "nav_date": used.isoformat(), "nav": price}


@router.get("/schemes/{scheme_code}/tax")
def scheme_tax(scheme_code: int, request: Request, db: Session = Depends(get_db)):
    """How a scheme is classified for tax and under what rules, whether or not it is held."""
    user = require_user(request, db)
    detail = nav.get_scheme_detail(scheme_code)
    if detail is None:
        raise HTTPException(status_code=404, detail="Could not fetch this scheme.")
    cfg = _settings(db, user.id).get(scheme_code, {})
    classification = taxlib.classify_scheme(detail["scheme_category"], detail["scheme_name"], cfg.get("tax_class"))
    tiers = costs.normalize_exit_load(cfg.get("exit_load")) if cfg.get("exit_load") else None
    return {
        "scheme_code": scheme_code,
        "scheme_name": detail["scheme_name"],
        "category": detail["scheme_category"],
        "classification": classification,
        "rules": taxlib.rule_summary(classification["tax_class"]),
        "exit_load": {
            "status": "entered" if tiers else "unavailable", "terms": tiers, "text": costs.exit_load_text(tiers),
            "source": "Entered by you" if tiers else None, "note": costs.disclosure()["exit_load"],
        },
        "expense_ratio_note": costs.disclosure()["expense_ratio"],
        "disclosure": taxlib.DISCLOSURE,
        "classes": regulatory.tax_rules()["mutualFunds"]["classes"],
    }


@router.put("/schemes/{scheme_code}/settings")
def put_settings(scheme_code: int, body: SettingsRequest, request: Request, db: Session = Depends(get_db)):
    """Record what you know about a scheme that the data sources cannot tell us: its tax class and exit-load terms."""
    user = require_user(request, db)
    if nav.get_scheme_detail(scheme_code) is None:
        raise HTTPException(status_code=404, detail="Could not fetch this scheme.")
    try:
        tiers = costs.normalize_exit_load([t.model_dump() for t in body.exit_load]) if body.exit_load else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    row = (
        db.query(MfFundSetting)
        .filter(MfFundSetting.user_id == user.id, MfFundSetting.scheme_code == scheme_code)
        .one_or_none()
    )
    if row is None:
        row = MfFundSetting(user_id=user.id, scheme_code=scheme_code)
        db.add(row)
    row.tax_class = body.tax_class
    row.exit_load_json = tiers
    db.flush()
    return {"scheme_code": scheme_code, "tax_class": row.tax_class, "exit_load": row.exit_load_json}


@router.get("")
def get_portfolio(request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    return _view(db, user.id)


@router.get("/analysis")
def get_analysis(request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    return analysis_view(_holdings(db, user.id), _transactions(db, user.id))


@router.get("/tax")
def get_tax(
    request: Request,
    db: Session = Depends(get_db),
    fy: str | None = Query(default=None, pattern=r"^FY\d{4}-\d{2}$"),
    slab: str | None = Query(default=None, max_length=6),
    band: str | None = Query(default=None, max_length=16),
    regime: str | None = Query(default=None, max_length=4),
):
    """Realised gains and an estimate for a financial year, what a redemption today would estimate to, and each fund lot by lot."""
    user = require_user(request, db)
    return taxlib.calculate_mutual_fund_tax(
        _holdings(db, user.id), _transactions(db, user.id), _settings(db, user.id), _profile(slab, band, regime), fy
    )


@router.get("/context")
def get_context(request: Request, db: Session = Depends(get_db)):
    """Long-term index CAGRs for anchoring planning scenarios."""
    require_user(request, db)
    return context.long_term_context()


@router.get("/insights")
def get_insights(
    request: Request,
    db: Session = Depends(get_db),
    age: str | None = Query(default=None, max_length=12),
    horizon: str | None = Query(default=None, max_length=12),
    risk: str | None = Query(default=None, max_length=16),
    objective: str | None = Query(default=None, max_length=24),
    slab: str | None = Query(default=None, max_length=6),
    band: str | None = Query(default=None, max_length=16),
    regime: str | None = Query(default=None, max_length=4),
):
    user = require_user(request, db)
    profile = insights.InvestorProfile.from_params(age=age, horizon=horizon, risk=risk, objective=objective)
    holdings, txs = _holdings(db, user.id), _transactions(db, user.id)
    tax_view = taxlib.calculate_mutual_fund_tax(holdings, txs, _settings(db, user.id), _profile(slab, band, regime)) if holdings or txs else None
    return insights.insights_view(holdings, txs, profile, tax=tax_view)


@router.post("/holdings", status_code=201)
def add_holding(body: AddHoldingRequest, request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    detail = nav.get_scheme_detail(body.scheme_code)
    if detail is None:
        raise HTTPException(status_code=404, detail="Could not fetch a live NAV for this scheme.")
    nav_date, latest = nav.latest_nav(detail)
    if body.avg_nav is None and not body.purchase_date:
        # "Buy at the current NAV": the date is the NAV's own date, so the two always agree.
        purchase_nav, purchase_date = latest, nav_date
    elif body.avg_nav is None:
        # A historical purchase with no NAV given uses the NAV published on that date, never today's.
        purchase_date = _parse_date(body.purchase_date)
        _, purchase_nav = _nav_for(detail, purchase_date)
    else:
        purchase_nav, purchase_date = body.avg_nav, _parse_date(body.purchase_date)
    # Paid by amount: the 0.005% stamp duty comes out first and units are allotted on what is left.
    units = body.units if body.amount is None else costs.units_from_amount(body.amount, purchase_nav, purchase_date)["units"]
    _record_purchase(db, user.id, detail, body.scheme_code, units, purchase_nav, purchase_date, "entered")
    return _view(db, user.id)


@router.post("/sip", status_code=201)
def add_sip(body: SipRequest, request: Request, db: Session = Depends(get_db)):
    """Simulate a monthly SIP up to today: one dated purchase per instalment, each its own tax lot."""
    user = require_user(request, db)
    detail = nav.get_scheme_detail(body.scheme_code)
    if detail is None:
        raise HTTPException(status_code=404, detail="Could not fetch a live NAV for this scheme.")
    start = _parse_date(body.start_date)
    end = _parse_date(body.end_date) if body.end_date else None
    try:
        dates = sip.schedule(start, body.day_of_month, installments=body.installments, end=end, today=dt.date.today())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not dates:
        raise HTTPException(status_code=400, detail="No instalment falls between the start date and today.")
    history = detail["nav_history"]
    made = skipped = 0
    for day in dates:
        found = sip.nav_on_or_after(history, day)
        if found is None:
            skipped += 1
            continue
        used, price = found
        units = costs.units_from_amount(body.amount, price, used)["units"]
        _record_purchase(db, user.id, detail, body.scheme_code, units, price, used, "sip")
        made += 1
    if made == 0:
        raise HTTPException(status_code=400, detail="No NAV is published near any instalment date for this scheme.")
    out = _view(db, user.id)
    out["sip"] = {"instalments": made, "skipped": skipped, "first": dates[0].isoformat(), "last": dates[-1].isoformat(), "amount": body.amount}
    return out


def _units_to_redeem(row: MfHolding, body: RedeemRequest) -> float:
    return row.units if body.all else float(body.units)


@router.post("/holdings/{scheme_code}/redeem-preview")
def redeem_preview(scheme_code: int, body: PreviewRequest, request: Request, db: Session = Depends(get_db)):
    """What a redemption would do, with nothing recorded: lots used, exit load, STT, gains and the estimated tax."""
    user = require_user(request, db)
    row = (
        db.query(MfHolding)
        .filter(MfHolding.user_id == user.id, MfHolding.scheme_code == scheme_code)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="That fund is not on this account.")
    day = _parse_date(body.date) if body.date else None
    profile = taxlib.TaxProfile(
        slab_rate_pct=body.slab_rate_pct,
        income_band=body.income_band if body.income_band in regulatory.tax_rules()["surcharge"]["bands"] else None,
        regime=body.regime,
    )
    try:
        return taxlib.redemption_preview(
            _holdings(db, user.id), _transactions(db, user.id), scheme_code,
            units=None if body.all else body.units, sale_date=day, sale_nav=body.nav,
            settings=_settings(db, user.id), profile=profile,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/holdings/{scheme_code}/redeem")
def redeem_holding(scheme_code: int, body: RedeemRequest, request: Request, db: Session = Depends(get_db)):
    """Record a sale of units, oldest first. The exit load (where you entered the scheme's terms) and the
    STT on equity-oriented units are taken out of the proceeds and stored with the redemption."""
    user = require_user(request, db)
    row = (
        db.query(MfHolding)
        .filter(MfHolding.user_id == user.id, MfHolding.scheme_code == scheme_code)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="That fund is not on this account.")
    units = _units_to_redeem(row, body)
    if units > row.units + 1e-9:
        raise HTTPException(status_code=400, detail=f"You hold {row.units:g} units; cannot redeem {units:g}.")
    detail = nav.get_scheme_detail(scheme_code)
    if detail is None:
        raise HTTPException(status_code=404, detail="Could not fetch a live NAV for this scheme.")
    day = _parse_date(body.date)
    if day.isoformat() < row.purchase_date:
        raise HTTPException(status_code=400, detail="A redemption cannot be dated before the first purchase.")
    sale_nav = _nav_for(detail, day)[1] if body.nav is None else body.nav
    _backfill(db, user.id, scheme_code)
    try:
        preview = taxlib.redemption_preview(
            _holdings(db, user.id), _transactions(db, user.id), scheme_code,
            units=units, sale_date=day, sale_nav=sale_nav, settings=_settings(db, user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    load = preview["exit_load"]["amount"]  # None when no terms were entered: unknown, not zero
    db.add(MfTransaction(
        user_id=user.id, scheme_code=scheme_code, kind="sell", trade_date=day.isoformat(),
        units=units, nav=sale_nav, source="entered", exit_load=load, stt=preview["stt"]["amount"],
    ))
    row.units = max(0.0, row.units - units)
    db.flush()
    if row.units <= 1e-9:
        db.delete(row)
    else:
        remaining = lotlib.replay(
            [l for l in lotlib.build_lots([row], _transactions(db, user.id)) if l.scheme_code == scheme_code]
        ).open_lots
        if remaining:
            row.avg_nav = sum(o.units * o.nav for o in remaining) / sum(o.units for o in remaining)
    db.flush()
    return _view(db, user.id)


@router.delete("/holdings/{scheme_code}")
def remove_holding(scheme_code: int, request: Request, db: Session = Depends(get_db)):
    """Stop tracking a scheme: removes the holding and its recorded transactions."""
    user = require_user(request, db)
    row = (
        db.query(MfHolding)
        .filter(MfHolding.user_id == user.id, MfHolding.scheme_code == scheme_code)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="That fund is not on this account.")
    db.query(MfTransaction).filter(
        MfTransaction.user_id == user.id, MfTransaction.scheme_code == scheme_code
    ).delete()
    db.delete(row)
    db.flush()
    return _view(db, user.id)
