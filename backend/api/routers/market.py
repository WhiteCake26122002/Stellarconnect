from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from backend.trading.nse_universe import get_universe, search_universe
from backend.trading.yahoo_feed import fetch_financials, fetch_heatmap, fetch_ohlc, fetch_quotes, fetch_world_quotes

from ..auth import require_user
from ..db import get_db
from ..schemas import QuotesRequest

router = APIRouter(prefix="/v1/market", tags=["market"])


@router.get("/universe")
def universe(
    request: Request,
    q: str = Query("", max_length=64),
    index: str = Query("", max_length=64),
    limit: int = Query(4000, ge=1, le=4000),
    db: Session = Depends(get_db),
):
    require_user(request, db)
    payload = get_universe()
    return search_universe(payload, q=q, index=index or None, limit=limit)


@router.get("/quotes")
def quotes(
    request: Request,
    symbols: str = Query(..., min_length=1, max_length=4000),
    db: Session = Depends(get_db),
):
    require_user(request, db)
    names = [part.strip() for part in symbols.split(",") if part.strip()]
    return {"quotes": fetch_quotes(names)}


@router.post("/quotes")
def quotes_post(request: Request, body: QuotesRequest, db: Session = Depends(get_db)):
    require_user(request, db)
    return {"quotes": fetch_quotes(body.symbols)}


@router.get("/world")
def world_quotes(request: Request, db: Session = Depends(get_db)):
    require_user(request, db)
    return fetch_world_quotes()


@router.get("/ohlc")
def ohlc(
    request: Request,
    symbol: str = Query(..., min_length=1, max_length=32),
    timeframe: str = Query("1D", min_length=1, max_length=8),
    db: Session = Depends(get_db),
):
    require_user(request, db)
    return fetch_ohlc(symbol, timeframe)


@router.get("/heatmap")
def heatmap(
    request: Request,
    index: str = Query("Nifty 50", max_length=64),
    range_code: str = Query("D", max_length=8, alias="range"),
    db: Session = Depends(get_db),
):
    require_user(request, db)
    return fetch_heatmap(index, range_code)


@router.get("/financials")
def financials(
    request: Request,
    symbol: str = Query(..., min_length=1, max_length=32),
    db: Session = Depends(get_db),
):
    require_user(request, db)
    return fetch_financials(symbol)
