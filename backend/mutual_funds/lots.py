"""
Dated purchase and redemption lots for the mutual-fund desk, and first-in-first-out matching.

Every SIP instalment and every top-up is its own lot: tax and exit load are decided per lot, so a
fund bought monthly for 18 months holds some units that are long-term and some that are not.
Redemptions consume the oldest units first, as an AMC's statement does.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass, field

from . import costs

EPS = 1e-9


@dataclass(frozen=True)
class Lot:
    """One dated purchase (units > 0) or redemption (units < 0)."""

    scheme_code: int
    date: dt.date
    units: float
    nav: float
    source: str = "entered"
    #: Purchases: stamp duty taken out of the money paid, so `units` are already net of it.
    stamp_duty: float = 0.0
    #: Redemptions: exit load and STT taken out of the proceeds.
    exit_load: float = 0.0
    stt: float = 0.0

    @property
    def amount(self) -> float:
        """Cash that moved: paid for a purchase (units x NAV plus the duty inside it), received for a redemption."""
        base = abs(self.units) * self.nav
        return base + self.stamp_duty if self.units > 0 else base - self.exit_load - self.stt

    @property
    def cash(self) -> float:
        """Signed cash flow: negative when money went in."""
        return -self.amount if self.units > 0 else self.amount


def _date(value) -> dt.date:
    return value if isinstance(value, dt.date) else dt.date.fromisoformat(value)


def build_lots(holdings, transactions=None) -> list[Lot]:
    """
    Dated lots for the whole account. A holding with recorded transactions is described by them;
    a holding without any (it predates the transactions table) becomes one aggregated lot at its
    stored date and blended NAV. Fully redeemed schemes keep their transactions, so realised
    cash flows still count.
    """
    by_scheme: dict[int, list] = defaultdict(list)
    for t in transactions or []:
        by_scheme[t.scheme_code].append(t)
    lots: list[Lot] = []
    for h in holdings:
        if not by_scheme.get(h.scheme_code):
            day = _date(h.purchase_date)
            duty = costs.gross_from_units(h.units, h.avg_nav, day)["stamp_duty"]
            lots.append(Lot(h.scheme_code, day, h.units, h.avg_nav, "aggregated", stamp_duty=duty))
    for code, txs in by_scheme.items():
        for t in txs:
            day = _date(t.trade_date)
            source = getattr(t, "source", "entered")
            if t.kind == "buy":
                duty = costs.gross_from_units(t.units, t.nav, day)["stamp_duty"]
                lots.append(Lot(code, day, t.units, t.nav, source, stamp_duty=duty))
            else:
                lots.append(Lot(
                    code, day, -t.units, t.nav, source,
                    exit_load=float(getattr(t, "exit_load", None) or 0.0),
                    stt=float(getattr(t, "stt", None) or 0.0),
                ))
    return sorted(lots, key=lambda l: (l.date, l.scheme_code, -l.units))


# --- FIFO ---------------------------------------------------------------------------------------

@dataclass
class OpenLot:
    """Units still held from one purchase."""

    scheme_code: int
    date: dt.date
    units: float
    nav: float
    #: Cost of these units: the share of the purchase amount (duty included) they represent.
    cost: float
    source: str = "entered"

    @property
    def cost_per_unit(self) -> float:
        return self.cost / self.units if self.units > EPS else 0.0


@dataclass
class Realization:
    """The part of one redemption that came out of one purchase lot."""

    scheme_code: int
    sell_date: dt.date
    sell_nav: float
    buy_date: dt.date
    units: float
    cost: float
    proceeds: float
    exit_load: float
    stt: float
    buy_source: str = "entered"


@dataclass
class Book:
    """The result of replaying a scheme's lots: what is still held, what was realised, what could not be matched."""

    open_lots: list[OpenLot] = field(default_factory=list)
    realizations: list[Realization] = field(default_factory=list)
    unmatched_units: float = 0.0


def replay(lots: list[Lot]) -> Book:
    """Replays one scheme's lots in date order, matching each redemption to the oldest purchases."""
    book = Book()
    ordered = sorted(lots, key=lambda l: (l.date, 0 if l.units > 0 else 1))
    queue: list[OpenLot] = []
    for lot in ordered:
        if lot.units > 0:
            queue.append(OpenLot(lot.scheme_code, lot.date, lot.units, lot.nav, lot.amount, lot.source))
            continue
        want = -lot.units
        total_want = want
        while want > EPS and queue:
            head = queue[0]
            take = min(head.units, want)
            share = take / head.units
            cost = head.cost * share
            frac = take / total_want
            book.realizations.append(Realization(
                scheme_code=lot.scheme_code,
                sell_date=lot.date,
                sell_nav=lot.nav,
                buy_date=head.date,
                units=take,
                cost=cost,
                proceeds=take * lot.nav,
                exit_load=lot.exit_load * frac,
                stt=lot.stt * frac,
                buy_source=head.source,
            ))
            head.cost -= cost
            head.units -= take
            want -= take
            if head.units <= EPS:
                queue.pop(0)
        if want > 1e-6:
            book.unmatched_units += want
    book.open_lots = queue
    return book


def replay_all(lots: list[Lot]) -> dict[int, Book]:
    by_scheme: dict[int, list[Lot]] = defaultdict(list)
    for l in lots:
        by_scheme[l.scheme_code].append(l)
    return {code: replay(group) for code, group in by_scheme.items()}
