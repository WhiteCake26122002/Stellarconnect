"""Mutual fund holdings for the signed-in Connect account."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.mutual_funds import nav
from backend.mutual_funds.portfolio import analysis_view, portfolio_view

from ..auth import require_user
from ..db import get_db
from ..orm import MfHolding

router = APIRouter(prefix="/v1/funds", tags=["funds"])


class AddHoldingRequest(BaseModel):
    scheme_code: int = Field(gt=0)
    units: float = Field(gt=0)
    avg_nav: float | None = Field(default=None, gt=0)
    purchase_date: str | None = None


def _parse_date(value: str | None) -> dt.date:
    if not value:
        return dt.date.today()
    try:
        parsed = dt.date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Purchase date must be YYYY-MM-DD.") from exc
    if parsed > dt.date.today():
        raise HTTPException(status_code=400, detail="Purchase date cannot be in the future.")
    return parsed


def _holdings(db: Session, user_id: str) -> list[MfHolding]:
    return (
        db.query(MfHolding)
        .filter(MfHolding.user_id == user_id)
        .order_by(MfHolding.scheme_name)
        .all()
    )


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
    }


@router.get("")
def get_portfolio(request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    return portfolio_view(_holdings(db, user.id))


@router.get("/analysis")
def get_analysis(request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    return analysis_view(_holdings(db, user.id))


@router.post("/holdings", status_code=201)
def add_holding(body: AddHoldingRequest, request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    detail = nav.get_scheme_detail(body.scheme_code)
    if detail is None:
        raise HTTPException(status_code=404, detail="Could not fetch a live NAV for this scheme.")
    nav_date, latest = nav.latest_nav(detail)
    purchase_nav = latest if body.avg_nav is None else body.avg_nav
    purchase_date = nav_date if body.avg_nav is None and not body.purchase_date else _parse_date(body.purchase_date)
    name = detail["scheme_name"]

    existing = (
        db.query(MfHolding)
        .filter(MfHolding.user_id == user.id, MfHolding.scheme_code == body.scheme_code)
        .one_or_none()
    )
    if existing:
        new_units = existing.units + body.units
        existing.avg_nav = (existing.units * existing.avg_nav + body.units * purchase_nav) / new_units
        existing.units = new_units
        existing.scheme_name = name
    else:
        db.add(MfHolding(
            user_id=user.id,
            scheme_code=body.scheme_code,
            scheme_name=name,
            units=body.units,
            avg_nav=purchase_nav,
            purchase_date=purchase_date.isoformat(),
        ))
    db.flush()
    return portfolio_view(_holdings(db, user.id))


@router.delete("/holdings/{scheme_code}")
def remove_holding(scheme_code: int, request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    row = (
        db.query(MfHolding)
        .filter(MfHolding.user_id == user.id, MfHolding.scheme_code == scheme_code)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="That fund is not on this account.")
    db.delete(row)
    db.flush()
    return portfolio_view(_holdings(db, user.id))
