from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from ..auth import require_user
from ..db import get_db
from ..market import search_equities
from ..schemas import CompanySearchHit

router = APIRouter(prefix="/v1/companies", tags=["companies"])


@router.post("/search")
def search(request: Request, q: str = Query(..., min_length=2), db: Session = Depends(get_db)):
    require_user(request, db)
    hits = search_equities(q)
    return {"results": [CompanySearchHit(**h).model_dump() for h in hits]}
