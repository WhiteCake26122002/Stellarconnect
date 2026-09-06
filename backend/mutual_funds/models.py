from __future__ import annotations

from pydantic import BaseModel


class MFHolding(BaseModel):
    user_key: str
    scheme_code: int
    scheme_name: str
    units: float
    avg_nav: float
    purchase_date: str
