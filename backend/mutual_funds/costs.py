"""
Transaction costs on mutual-fund units. Not the equity brokerage structure: funds have no brokerage
and no distributor transaction charge (discontinued by SEBI on 8 Aug 2025); they have

  * stamp duty on purchases, taken out of the money invested, so it reduces the units allotted;
  * STT on redemption of equity-oriented units, deducted from the proceeds;
  * an exit load some schemes charge on early redemption, which this module only applies when it
    has been told the scheme's terms (there is no free source for them);
  * an expense ratio that is already inside the NAV and is never charged again here.

Rates come from backend/regulatory/charges.json.
"""
from __future__ import annotations

import datetime as dt
from decimal import ROUND_HALF_UP, Decimal
from typing import Sequence

from backend import regulatory

DAY = dt.date | str


def r2(x: float) -> float:
    """Round half up to the paisa."""
    return float(Decimal(repr(float(x))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _cfg() -> dict:
    return regulatory.charges()["mutualFunds"]


def stamp_duty_rate_pct(day: DAY) -> float:
    return regulatory.rate_on(_cfg()["stampDuty"]["ratePct"], day)


def calculate_stamp_duty(gross_amount: float, day: DAY) -> float:
    """Stamp duty on a purchase of `gross_amount` rupees made on `day`."""
    rate = stamp_duty_rate_pct(day)
    if gross_amount <= 0 or rate <= 0:
        return 0.0
    return r2(gross_amount * rate / 100)


def units_from_amount(amount: float, nav: float, day: DAY) -> dict:
    """
    A purchase described by the money paid. Stamp duty comes out of the amount first, and units are
    allotted on what is left: units = (amount - duty) / NAV.
    """
    duty = calculate_stamp_duty(amount, day)
    net = amount - duty
    return {"gross": r2(amount), "stamp_duty": duty, "net_invested": r2(net), "units": net / nav}


def gross_from_units(units: float, nav: float, day: DAY) -> dict:
    """
    A purchase described by the units allotted (as on a statement, where they are already net of
    duty). The amount paid is the net value grossed up so that gross - duty = units x NAV.
    """
    net = units * nav
    rate = stamp_duty_rate_pct(day)
    if net <= 0 or rate <= 0:
        return {"gross": r2(net), "stamp_duty": 0.0, "net_invested": r2(net)}
    duty = r2(net / (1 - rate / 100) * rate / 100)
    return {"gross": r2(net + duty), "stamp_duty": duty, "net_invested": r2(net)}


def stt_rate_pct(fund_class: str, day: DAY) -> float:
    cfg = _cfg()["sttOnRedemption"]
    return regulatory.rate_on(cfg["equityOriented"] if fund_class == "equity" else cfg["other"], day)


def stt_on_redemption(value: float, fund_class: str, day: DAY) -> float:
    """STT the AMC deducts when equity-oriented units are redeemed. Zero for every other class."""
    rate = stt_rate_pct(fund_class, day)
    if value <= 0 or rate <= 0:
        return 0.0
    return r2(value * rate / 100)


def normalize_exit_load(tiers) -> list[dict] | None:
    """
    A scheme's exit load as a list of {days, pct}: pct is charged on units redeemed before `days`
    days of holding have passed. Returns None when nothing usable was given.
    """
    if not tiers:
        return None
    out = []
    for t in tiers:
        days, pct = int(t["days"]), float(t["pct"])
        if days <= 0 or pct < 0 or pct > 10:
            raise ValueError("Exit load needs a number of days above 0 and a percentage between 0 and 10.")
        out.append({"days": days, "pct": pct})
    return sorted(out, key=lambda t: t["days"])


def exit_load_pct_for(held_days: int, tiers: Sequence[dict] | None) -> float:
    """The exit-load percentage for units held `held_days`: the first tier whose window has not passed."""
    for t in tiers or []:
        if held_days < t["days"]:
            return float(t["pct"])
    return 0.0


def calculate_exit_load(value: float, held_days: int, tiers: Sequence[dict] | None) -> float:
    pct = exit_load_pct_for(held_days, tiers)
    return r2(value * pct / 100) if value > 0 and pct > 0 else 0.0


def exit_load_text(tiers: Sequence[dict] | None) -> str:
    if not tiers:
        return "Exit load information unavailable."
    parts = [f"{t['pct']:g}% if redeemed within {t['days']} days" for t in tiers]
    return "; ".join(parts) + "."


def disclosure() -> dict:
    """What a screen needs to say about costs a fund does and does not carry."""
    cfg = _cfg()
    return {
        "stamp_duty": cfg["stampDuty"]["note"],
        "stt": cfg["sttOnRedemption"]["note"],
        "distributor_charge": cfg["distributorTransactionCharge"]["note"],
        "expense_ratio": cfg["expenseRatio"]["note"],
        "exit_load": cfg["exitLoad"]["note"],
    }
