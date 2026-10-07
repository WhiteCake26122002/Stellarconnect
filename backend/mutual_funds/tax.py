"""
Capital-gains tax for mutual-fund units, estimated lot by lot.

What this module is: arithmetic over the user's own dated purchases and redemptions, under rules
read from backend/regulatory/tax_rules.json for the financial year in question. What it is not: tax
advice, or a statement of what anyone owes. Every figure carries a confidence level and the list of
things it assumed or left out, and a figure that cannot be estimated is withheld, never filled in.

The mutual-fund rules differ by class, so the class is decided first (equity-oriented, specified,
other) from the AMFI category and name, then any override the user set. Classes whose mix depends
on the scheme are flagged and lower the confidence.

  equity-oriented  12-month threshold; STCG 20%; LTCG 12.5% above Rs 1.25 lakh a year (111A / 112A)
  specified fund   bought on or after 1 Apr 2023: every gain short-term at the slab rate (50AA)
  other fund       24-month threshold; STCG at the slab rate; LTCG 12.5%, no exemption (112)

The estimator itself (set-off, exemption, surcharge, cess) mirrors frontend/lib/costs/tax.ts, and
both run the cases in backend/regulatory/tax_vectors.json.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Iterable, Sequence

from backend import regulatory

from . import costs, lots as lotlib, nav
from .costs import r2

BUCKETS = ("stcg111A", "ltcg112A", "stcgSlab", "ltcg112")
BUCKET_LABEL = {
    "stcg111A": "Short-term (equity)",
    "ltcg112A": "Long-term (equity)",
    "stcgSlab": "Short-term (slab rate)",
    "ltcg112": "Long-term (other funds)",
}

DISCLOSURE = (
    "Charges, taxes and returns shown here are estimates for educational purposes. Actual charges and tax liability "
    "depend on your fund house, investor status, applicable tax rules and your complete tax position. "
    "Tax calculations are not tax advice. Consult a qualified tax professional for your individual tax position."
)
HISTORY_NOTE = (
    "Based on available transaction history and current applicable tax rules. Actual tax liability depends on your "
    "complete tax position and applicable regulations."
)
UNREALIZED_NOTE = "An unrealized gain is not taxed until units are redeemed or switched out; the figures below are what a redemption would estimate to."


# --- profile ------------------------------------------------------------------------------------

@dataclass(frozen=True)
class TaxProfile:
    slab_rate_pct: float | None = None
    income_band: str | None = None
    regime: str = "new"

    @classmethod
    def from_params(cls, slab: str | None = None, band: str | None = None, regime: str | None = None) -> "TaxProfile":
        bands = regulatory.tax_rules()["surcharge"]["bands"]
        slab_rate = None
        if slab not in (None, ""):
            try:
                value = float(slab)
            except ValueError:
                value = None
            if value is not None and 0 <= value <= 45:
                slab_rate = value
        return cls(
            slab_rate_pct=slab_rate,
            income_band=band if band in bands else None,
            regime="old" if regime == "old" else "new",
        )


EMPTY_PROFILE = TaxProfile()


# --- dates ---------------------------------------------------------------------------------------

def add_months(day: dt.date, months: int) -> dt.date:
    """The same calendar day `months` later, clamped to the month's last day."""
    total = day.year * 12 + (day.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    if month == 12:
        last = 31
    else:
        last = (dt.date(year, month + 1, 1) - dt.timedelta(days=1)).day
    return dt.date(year, month, min(day.day, last))


def _whole_months(start: dt.date, end: dt.date) -> int:
    m = 0
    while add_months(start, m + 1) <= end:
        m += 1
    return m


def held_text(days: int, months: int) -> str:
    if months >= 12:
        y, rest = divmod(months, 12)
        return f"{y} year{'' if y == 1 else 's'}" + (f" {rest} month{'' if rest == 1 else 's'}" if rest else "")
    if months >= 1:
        return f"{months} month{'' if months == 1 else 's'}"
    return f"{days} day{'' if days == 1 else 's'}"


def classify_holding_period(acquired: dt.date, sold: dt.date, threshold_months: int) -> dict:
    """
    Long-term only when held MORE than the threshold: bought 10 Jan 2025 with a 12-month threshold,
    a sale on 10 Jan 2026 is still short-term and one on 11 Jan 2026 is long-term.
    """
    short_until = add_months(acquired, threshold_months)
    days = max(0, (sold - acquired).days)
    months = _whole_months(acquired, sold)
    return {
        "term": "long" if sold > short_until else "short",
        "days": days,
        "months": months,
        "threshold_months": threshold_months,
        "short_term_until": short_until,
        "long_term_from": short_until + dt.timedelta(days=1),
        "text": held_text(days, months),
    }


# --- classification ------------------------------------------------------------------------------

def tax_class_info(tax_class: str) -> dict:
    return regulatory.tax_rules()["mutualFunds"]["classes"][tax_class]


def _matches(rule: dict, category: str, name: str) -> bool:
    spec = rule["match"]
    checks = []
    if "categoryAny" in spec:
        checks.append(any(w in category for w in spec["categoryAny"]))
    if "nameAny" in spec:
        checks.append(any(w in name for w in spec["nameAny"]))
    if not checks:
        return False
    return any(checks) if rule.get("mode") == "any" else all(checks)


def classify_scheme(category: str | None, name: str | None = "", override: str | None = None) -> dict:
    """
    The tax class of a scheme: equity | specified | other | unknown, with how sure the label lets us
    be. An override the user set wins and is marked as such.
    """
    classes = regulatory.tax_rules()["mutualFunds"]["classes"]
    if override in ("equity", "specified", "other"):
        return {
            "tax_class": override, "label": classes[override]["label"], "detail": classes[override]["detail"],
            "certainty": "override", "reason": "Set by you.", "source": "override", "rule": "override",
        }
    cat = (category or "").lower()
    nm = (name or "").lower()
    if not cat or cat == "unknown":
        c = classes["unknown"]
        return {"tax_class": "unknown", "label": c["label"], "detail": c["detail"], "certainty": "depends",
                "reason": "No AMFI category is available for this scheme.", "source": "category", "rule": "no-category"}
    for rule in regulatory.tax_rules()["mutualFunds"]["classification"]["rules"]:
        if _matches(rule, cat, nm):
            c = classes[rule["class"]]
            return {"tax_class": rule["class"], "label": c["label"], "detail": c["detail"],
                    "certainty": rule["certainty"], "reason": rule["reason"], "source": "category", "rule": rule["id"]}
    c = classes["unknown"]
    return {"tax_class": "unknown", "label": c["label"], "detail": c["detail"], "certainty": "depends",
            "reason": "The AMFI category does not settle the tax class.", "source": "category", "rule": "no-match"}


# --- the estimator (mirrors frontend/lib/costs/tax.ts) --------------------------------------------

def set_off_within_class(short_net: float, long_net: float) -> dict:
    """A short-term loss absorbs short- and then long-term gains; a long-term loss absorbs long-term gains only."""
    if short_net < 0 < long_net:
        absorbed = min(-short_net, long_net)
        return {"short_after": short_net + absorbed, "long_after": long_net - absorbed, "absorbed_by_long": absorbed}
    return {"short_after": short_net, "long_after": long_net, "absorbed_by_long": 0.0}


def calculate_stcg(short_equity_net: float, short_slab_net: float, rules: dict, profile: TaxProfile) -> dict:
    eq = max(0.0, short_equity_net)
    slab = max(0.0, short_slab_net)
    rate = rules["equity"]["stcgRatePct"]
    return {
        "equity": {"taxable": eq, "rate_pct": rate, "tax": r2(eq * rate / 100)},
        "slab": {
            "taxable": slab,
            "rate_pct": profile.slab_rate_pct,
            "tax": 0.0 if slab == 0 else (r2(slab * profile.slab_rate_pct / 100) if profile.slab_rate_pct is not None else None),
        },
    }


def calculate_ltcg(long_equity_net: float, long_other_net: float, rules: dict) -> dict:
    eq = max(0.0, long_equity_net)
    exemption = min(rules["equity"]["ltcgExemption"], eq)
    eq_taxable = eq - exemption
    other = max(0.0, long_other_net)
    other_taxable = other - min(rules["other"]["ltcgExemption"], other)
    return {
        "equity": {"net": eq, "exemption": exemption, "taxable": eq_taxable,
                   "rate_pct": rules["equity"]["ltcgRatePct"], "tax": r2(eq_taxable * rules["equity"]["ltcgRatePct"] / 100)},
        "other": {"net": other, "taxable": other_taxable,
                  "rate_pct": rules["other"]["ltcgRatePct"], "tax": r2(other_taxable * rules["other"]["ltcgRatePct"] / 100)},
    }


def _empty_bucket(bucket: str) -> dict:
    return {"bucket": bucket, "label": BUCKET_LABEL[bucket], "rate_pct": None, "gains": 0.0, "losses": 0.0, "net": 0.0,
            "set_off_absorbed": 0.0, "net_after_set_off": 0.0, "exemption": 0.0, "taxable": 0.0, "tax": 0.0}


def empty_estimate(fy: str, reason: str) -> dict:
    return {
        "supported": False, "reason": reason, "fy": fy, "fy_label": regulatory.fy_label(fy), "rules": None,
        "buckets": {b: _empty_bucket(b) for b in BUCKETS},
        "stcg": 0.0, "ltcg": 0.0, "realized_net": 0.0,
        "exemption_limit": 0.0, "exemption_applied": 0.0, "exemption_room": 0.0,
        "tax_before_surcharge_cess": 0.0, "surcharge": 0.0, "cess": 0.0, "total": 0.0,
        "includes_surcharge_cess": False, "surcharge_pct": None, "cess_pct": 0.0,
        "slab_gain_not_estimated": 0.0, "unabsorbed_loss": {"short": 0.0, "long": 0.0},
        "per_item": {}, "headline": "Not estimated", "notes": [reason],
    }


def _surcharge_pcts(band: dict, regime: str) -> tuple[float, float]:
    normal = band.get("normalPct")
    if normal is None:
        normal = band.get("normalPctNewRegime" if regime == "new" else "normalPctOldRegime", 0)
    return float(normal), float(band["cappedGainsPct"])


def calculate_estimated_tax(fy: str, items: Sequence[dict], profile: TaxProfile | None = None) -> dict:
    """The estimate for one financial year's realised gains. `items` need id, bucket and gain."""
    profile = profile or EMPTY_PROFILE
    rules = regulatory.rules_for(fy)
    if rules is None:
        return empty_estimate(fy, regulatory.unsupported_reason(fy) or f"No tax rules are configured for {regulatory.fy_label(fy)}.")

    b = {k: _empty_bucket(k) for k in BUCKETS}
    for it in items:
        row = b[it["bucket"]]
        if it["gain"] >= 0:
            row["gains"] += it["gain"]
        else:
            row["losses"] += it["gain"]
    for k in BUCKETS:
        b[k]["gains"], b[k]["losses"] = r2(b[k]["gains"]), r2(b[k]["losses"])
        b[k]["net"] = r2(b[k]["gains"] + b[k]["losses"])

    eq = set_off_within_class(b["stcg111A"]["net"], b["ltcg112A"]["net"])
    ot = set_off_within_class(b["stcgSlab"]["net"], b["ltcg112"]["net"])
    b["stcg111A"]["net_after_set_off"] = r2(eq["short_after"])
    b["ltcg112A"]["net_after_set_off"] = r2(eq["long_after"])
    b["ltcg112A"]["set_off_absorbed"] = r2(eq["absorbed_by_long"])
    b["stcgSlab"]["net_after_set_off"] = r2(ot["short_after"])
    b["ltcg112"]["net_after_set_off"] = r2(ot["long_after"])
    b["ltcg112"]["set_off_absorbed"] = r2(ot["absorbed_by_long"])

    st = calculate_stcg(b["stcg111A"]["net_after_set_off"], b["stcgSlab"]["net_after_set_off"], rules, profile)
    lt = calculate_ltcg(b["ltcg112A"]["net_after_set_off"], b["ltcg112"]["net_after_set_off"], rules)
    b["stcg111A"].update(rate_pct=st["equity"]["rate_pct"], taxable=st["equity"]["taxable"], tax=st["equity"]["tax"])
    b["stcgSlab"].update(rate_pct=st["slab"]["rate_pct"], taxable=st["slab"]["taxable"], tax=st["slab"]["tax"])
    b["ltcg112A"].update(rate_pct=lt["equity"]["rate_pct"], exemption=lt["equity"]["exemption"],
                         taxable=lt["equity"]["taxable"], tax=lt["equity"]["tax"])
    b["ltcg112"].update(rate_pct=lt["other"]["rate_pct"], taxable=lt["other"]["taxable"], tax=lt["other"]["tax"])

    def tax_of(k: str) -> float:
        return b[k]["tax"] or 0.0

    before = r2(sum(tax_of(k) for k in BUCKETS))
    slab_unpriced = b["stcgSlab"]["taxable"] if b["stcgSlab"]["tax"] is None else 0.0

    band = regulatory.tax_rules()["surcharge"]["bands"].get(profile.income_band) if profile.income_band else None
    surcharge = cess = 0.0
    surcharge_pct = None
    normal_pct = capped_pct = 0.0
    if band:
        normal_pct, capped_pct = _surcharge_pcts(band, profile.regime)
        surcharge = r2((tax_of("stcg111A") + tax_of("ltcg112A") + tax_of("ltcg112")) * capped_pct / 100 + tax_of("stcgSlab") * normal_pct / 100)
        cess = r2((before + surcharge) * rules["cessPct"] / 100)
        surcharge_pct = capped_pct
    total = r2(before + surcharge + cess)

    per_item: dict[str, float] = {}
    for k in BUCKETS:
        members = [i for i in items if i["bucket"] == k]
        positive = [i for i in members if i["gain"] > 0]
        pos_sum = sum(i["gain"] for i in positive)
        bucket_tax = tax_of(k)
        bucket_total = bucket_tax
        if band:
            pct = normal_pct if k == "stcgSlab" else capped_pct
            bucket_total = (bucket_tax + bucket_tax * pct / 100) * (1 + rules["cessPct"] / 100)
        for i in members:
            per_item[i["id"]] = 0.0
        if pos_sum > 0:
            for i in positive:
                per_item[i["id"]] = r2(bucket_total * i["gain"] / pos_sum)

    unabsorbed = {
        "short": r2(min(0.0, b["stcg111A"]["net_after_set_off"]) + min(0.0, b["stcgSlab"]["net_after_set_off"])),
        "long": r2(min(0.0, b["ltcg112A"]["net_after_set_off"]) + min(0.0, b["ltcg112"]["net_after_set_off"])),
    }

    notes: list[str] = []
    if rules.assumed and rules.note:
        notes.append(rules.note)
    if band:
        notes.append(
            f"Surcharge ({surcharge_pct:g}% on equity and other flat-rate gains, the most the law allows on them) "
            f"and {rules['cessPct']:g}% cess are included."
        )
    else:
        notes.append("Surcharge and cess are not included: they depend on your total income, which has not been set.")
    if slab_unpriced > 0:
        notes.append("Some gains are taxed at your slab rate; set a slab rate to price them.")
    if any(i["gain"] < 0 for i in items) or unabsorbed["short"] < 0 or unabsorbed["long"] < 0:
        notes.append("Advanced tax-loss adjustment requires additional tax information.")
    notes.append("Other income, the basic-exemption adjustment, carried-forward losses and set-off across asset classes are not applied.")

    return {
        "supported": True, "reason": None, "fy": fy, "fy_label": regulatory.fy_label(fy),
        "rules": {"source_fy": rules.source_fy, "assumed": rules.assumed, "note": rules.note, "legal_basis": rules["legalBasis"]},
        "buckets": b,
        "stcg": r2(max(0.0, b["stcg111A"]["net_after_set_off"]) + max(0.0, b["stcgSlab"]["net_after_set_off"])),
        "ltcg": r2(max(0.0, b["ltcg112A"]["net_after_set_off"]) + max(0.0, b["ltcg112"]["net_after_set_off"])),
        "realized_net": r2(sum(b[k]["net"] for k in BUCKETS)),
        "exemption_limit": rules["equity"]["ltcgExemption"],
        "exemption_applied": lt["equity"]["exemption"],
        "exemption_room": r2(max(0.0, rules["equity"]["ltcgExemption"] - lt["equity"]["exemption"])),
        "tax_before_surcharge_cess": before, "surcharge": surcharge, "cess": cess, "total": total,
        "includes_surcharge_cess": band is not None, "surcharge_pct": surcharge_pct, "cess_pct": rules["cessPct"],
        "slab_gain_not_estimated": slab_unpriced, "unabsorbed_loss": unabsorbed, "per_item": per_item,
        "headline": (f"Estimated tax including surcharge and {rules['cessPct']:g}% cess" if band else "Estimated tax before surcharge and cess"),
        "notes": notes,
    }


def assess_confidence(coverage_pct: float, missing: Sequence[str], assumptions: Sequence[str]) -> dict:
    """
    high: every lot has a real date and a settled class, rules are configured and the profile is complete.
    estimated: it needed an assumption. incomplete: part of the history has no usable date or class.
    """
    coverage = max(0.0, min(100.0, coverage_pct))
    incomplete = bool(missing) or coverage < 100
    level = "incomplete" if incomplete else ("estimated" if assumptions else "high")
    return {
        "level": level,
        "label": {"high": "High confidence", "estimated": "Estimated", "incomplete": "Incomplete"}[level],
        "coverage_pct": round(coverage),
        "reasons": [*missing, *assumptions],
        "basis": f"Based on {round(coverage)}% of the available transaction history and the tax rules currently configured.",
    }


def profile_assumptions(profile: TaxProfile, fy: str, has_slab_items: bool) -> list[str]:
    rules = regulatory.rules_for(fy)
    out = []
    if not profile.income_band:
        out.append("Total income is not set, so surcharge and cess are left out.")
    if has_slab_items and profile.slab_rate_pct is None:
        out.append("A slab rate is not set, so slab-rate gains are not priced.")
    if rules is not None and rules.assumed and rules.note:
        out.append(rules.note)
    return out


# --- gain on a redeemed slice ---------------------------------------------------------------------

def calculate_realized_gain(cost: float, proceeds: float, exit_load: float = 0.0, stt: float = 0.0) -> dict:
    """
    gross: price move (proceeds - cost). charges: exit load and STT. net: what the investor actually
    gained. taxable: gross less the exit load (a transfer expense) but not the STT (never deductible).
    """
    gross = r2(proceeds - cost)
    charges = r2(exit_load + stt)
    return {"gross": gross, "charges": charges, "net": r2(gross - charges), "taxable": r2(gross - exit_load), "stt_not_deductible": r2(stt)}


def calculate_net_pnl(gross: float, charges: float) -> dict:
    return {"gross": r2(gross), "charges": r2(charges), "net": r2(gross - charges)}


def calculate_after_tax_return(invested: float, gross: float, charges: float, tax: float | None, realized: bool) -> dict:
    """Gross, net and after-tax return. For an unrealised position no tax has been incurred, so none is applied."""
    def pct(x: float):
        return x / invested * 100 if invested > 0 else None

    net = r2(gross - charges)
    after = r2(net - tax) if realized and tax is not None else None
    return {
        "gross_return_pct": pct(gross), "net_return_pct": pct(net),
        "after_tax_return_pct": pct(after) if after is not None else None,
        "gross_pnl": r2(gross), "charges": r2(charges), "net_pnl": net, "tax": tax if realized else None, "after_tax_pnl": after,
        "label": "After-tax return" if realized else "Estimated after-tax value on redemption",
    }


# --- turning lots into tax items -------------------------------------------------------------------

GRANDFATHER_DAY = dt.date(2018, 1, 31)


def _threshold(fund_class: str, acquired: dt.date, rules: dict) -> int:
    mf = regulatory.tax_rules()["mutualFunds"]["holdingMonths"]
    if fund_class == "equity":
        return rules["equity"]["holdingMonths"]
    if fund_class == "specified":
        return mf["specifiedBeforeCutoff"]
    return mf["other"]


def bucket_for(fund_class: str, acquired: dt.date, sold: dt.date, rules: dict) -> dict | None:
    """
    The tax bucket for units bought on `acquired` and sold on `sold`, with the holding period and
    whether the term is deemed (a specified fund bought on or after 1 Apr 2023 is short-term whatever
    the holding period). None when the class is unknown.
    """
    if fund_class == "unknown":
        return None
    period = classify_holding_period(acquired, sold, _threshold(fund_class, acquired, rules))
    deemed = False
    if fund_class == "specified":
        cutoff = dt.date.fromisoformat(rules["specifiedFund"]["deemedShortTermFrom"])
        if acquired >= cutoff:
            deemed = True
            period = {**period, "term": "short"}
    term = period["term"]
    if fund_class == "equity":
        bucket = "stcg111A" if term == "short" else "ltcg112A"
    else:
        bucket = "stcgSlab" if term == "short" else "ltcg112"
    return {"bucket": bucket, "period": period, "deemed": deemed}


def _fy_rules(fy: str) -> dict:
    return regulatory.rules_for(fy) or regulatory.rules_for(regulatory.configured_years()[-1])


def realization_item(rz: lotlib.Realization, fund_class: str, name: str, fmv_nav: float | None) -> tuple[dict | None, dict]:
    """
    A redeemed slice as a tax item (None if the class is unknown) plus a small report of what had to
    be assumed: {'grandfathering_missing': bool, 'grandfathered': bool}.
    """
    fy = regulatory.financial_year_of(rz.sell_date)
    rules = _fy_rules(fy)
    placed = bucket_for(fund_class, rz.buy_date, rz.sell_date, rules)
    flags = {"grandfathering_missing": False, "grandfathered": False}
    if placed is None:
        return None, flags
    cost = rz.cost
    proceeds_for_tax = rz.proceeds - rz.exit_load
    period = placed["period"]
    if fund_class == "equity" and placed["bucket"] == "ltcg112A" and rz.buy_date <= GRANDFATHER_DAY:
        if fmv_nav is None:
            flags["grandfathering_missing"] = True
        else:
            fmv = fmv_nav * rz.units
            adjusted = max(cost, min(fmv, proceeds_for_tax))
            if adjusted != cost:
                flags["grandfathered"] = True
            cost = adjusted
    gain = calculate_realized_gain(cost, rz.proceeds, rz.exit_load, rz.stt)
    taxable = r2(proceeds_for_tax - cost)
    return {
        "id": f"{rz.scheme_code}:{rz.sell_date.isoformat()}:{rz.buy_date.isoformat()}:{round(rz.units, 6)}",
        "scheme_code": rz.scheme_code, "label": name, "bucket": placed["bucket"], "gain": taxable,
        "term": period["term"], "held_days": period["days"], "held_text": period["text"],
        "opened_on": rz.buy_date.isoformat(), "closed_on": rz.sell_date.isoformat(),
        "units": rz.units, "cost": r2(cost), "proceeds": r2(rz.proceeds), "exit_load": r2(rz.exit_load), "stt": r2(rz.stt),
        "gross": gain["gross"], "net": gain["net"], "deemed_short_term": placed["deemed"],
        "buy_source": rz.buy_source,
    }, flags


def _hypothetical(lot: lotlib.OpenLot, units: float, nav_value: float, sale_date: dt.date, fund_class: str, tiers) -> lotlib.Realization:
    """A redemption that has not happened: `units` of `lot` sold at `nav_value` on `sale_date`."""
    proceeds = units * nav_value
    held = (sale_date - lot.date).days
    return lotlib.Realization(
        scheme_code=lot.scheme_code, sell_date=sale_date, sell_nav=nav_value, buy_date=lot.date, units=units,
        cost=lot.cost * (units / lot.units), proceeds=proceeds,
        exit_load=costs.calculate_exit_load(proceeds, held, tiers),
        stt=costs.stt_on_redemption(proceeds, fund_class, sale_date), buy_source=lot.source,
    )


# --- the whole picture ----------------------------------------------------------------------------

@dataclass
class FundContext:
    scheme_code: int
    name: str
    category: str
    classification: dict
    exit_tiers: list[dict] | None
    latest_nav: float | None
    nav_date: dt.date | None
    nav_history: list[tuple[dt.date, float]]
    in_portfolio: bool

    @property
    def fund_class(self) -> str:
        return self.classification["tax_class"]

    def nav_on(self, day: dt.date) -> float | None:
        best = None
        for d, v in self.nav_history:
            if d <= day and (best is None or d > best[0]):
                best = (d, v)
        return best[1] if best else None


def _contexts(holdings, books: dict[int, lotlib.Book], settings: dict[int, dict]) -> dict[int, FundContext]:
    names = {h.scheme_code: h.scheme_name for h in holdings}
    held = {h.scheme_code for h in holdings}
    out: dict[int, FundContext] = {}
    for code in set(books) | held:
        detail = nav.get_scheme_detail(code)
        cfg = settings.get(code, {})
        category = detail["scheme_category"] if detail else "Unknown"
        name = names.get(code) or (detail["scheme_name"] if detail else f"Scheme {code}")
        latest = nav_date = None
        history: list = []
        if detail:
            nav_date, latest = nav.latest_nav(detail)
            history = detail["nav_history"]
        out[code] = FundContext(
            scheme_code=code, name=name, category=category,
            classification=classify_scheme(category, name, cfg.get("tax_class")),
            exit_tiers=costs.normalize_exit_load(cfg.get("exit_load")) if cfg.get("exit_load") else None,
            latest_nav=latest, nav_date=nav_date, nav_history=history, in_portfolio=code in held,
        )
    return out


def _coverage(entries: Iterable[tuple[float, bool]]) -> float:
    total = covered = 0.0
    for cost, ok in entries:
        total += cost
        if ok:
            covered += cost
    return 100.0 if total <= 0 else covered / total * 100


def calculate_mutual_fund_tax(
    holdings,
    transactions,
    settings: dict[int, dict] | None = None,
    profile: TaxProfile | None = None,
    fy: str | None = None,
    today: dt.date | None = None,
) -> dict:
    """
    The tax view of the whole fund account: realised gains for a financial year with an estimate,
    what a redemption of everything today would estimate to, and the same per fund, lot by lot.
    """
    profile = profile or EMPTY_PROFILE
    settings = settings or {}
    today = today or dt.date.today()
    current_fy = regulatory.financial_year_of(today)
    fy = fy or current_fy

    lots = lotlib.build_lots(holdings, transactions)
    books = lotlib.replay_all(lots)
    ctx = _contexts(holdings, books, settings)

    # --- realised, all years ---
    items_by_fy: dict[str, list[dict]] = defaultdict(list)
    realized_cov: dict[str, list[tuple[float, bool]]] = defaultdict(list)
    realized_flags: dict[str, dict] = defaultdict(lambda: {"unknown": set(), "depends": set(), "aggregated": False, "grandfathering": False, "unmatched": 0.0, "no_exit_load": set()})
    sell_lots = [l for l in lots if l.units < 0]
    for code, book in books.items():
        c = ctx[code]
        for rz in book.realizations:
            sfy = regulatory.financial_year_of(rz.sell_date)
            flags = realized_flags[sfy]
            fmv = c.nav_on(GRANDFATHER_DAY) if rz.buy_date <= GRANDFATHER_DAY else None
            item, f = realization_item(rz, c.fund_class, c.name, fmv)
            realized_cov[sfy].append((rz.cost, item is not None))
            if item is None:
                flags["unknown"].add(c.name)
                continue
            items_by_fy[sfy].append(item)
            if c.classification["certainty"] == "depends":
                flags["depends"].add(c.name)
            if rz.buy_source == "aggregated":
                flags["aggregated"] = True
            if f["grandfathering_missing"]:
                flags["grandfathering"] = True
        if book.unmatched_units > 1e-6:
            realized_flags[fy]["unmatched"] += book.unmatched_units
    exit_load_unknown = {
        ctx[l.scheme_code].name
        for l in sell_lots
        if regulatory.financial_year_of(l.date) == fy and ctx[l.scheme_code].exit_tiers is None and l.exit_load == 0
    }

    years = sorted({current_fy, fy, *items_by_fy.keys()}, key=regulatory.fy_start_year, reverse=True)
    items = items_by_fy.get(fy, [])
    estimate = calculate_estimated_tax(fy, items, profile)
    for it in items:
        it["tax"] = estimate["per_item"].get(it["id"], 0.0)

    flags = realized_flags[fy]
    missing: list[str] = []
    if flags["unknown"]:
        missing.append(f"The tax class of {', '.join(sorted(flags['unknown']))} is unknown, so its redemptions are not estimated.")
    if flags["unmatched"]:
        missing.append(f"{flags['unmatched']:g} redeemed units could not be matched to a recorded purchase.")
    if not estimate["supported"]:
        missing.append(estimate["reason"])
    assumptions = profile_assumptions(profile, fy, any(i["bucket"] == "stcgSlab" for i in items)) if estimate["supported"] else []
    if flags["depends"]:
        assumptions.append(f"The tax class of {', '.join(sorted(flags['depends']))} depends on the scheme's actual mix.")
    if flags["aggregated"]:
        assumptions.append("Some holdings predate dated transactions and use a single purchase date and blended NAV.")
    if flags["grandfathering"]:
        assumptions.append("The 31 Jan 2018 NAV was not available for units bought before 1 Feb 2018, so their cost is not grandfathered.")
    if items and exit_load_unknown:
        assumptions.append(f"No exit load is entered for {', '.join(sorted(exit_load_unknown))}; any that applied is not deducted.")
    realized_conf = assess_confidence(_coverage(realized_cov[fy]), missing, assumptions)

    by_fund_realized: dict[int, dict] = {}
    for it in items:
        row = by_fund_realized.setdefault(it["scheme_code"], {"scheme_code": it["scheme_code"], "scheme_name": it["label"], "gain": 0.0, "stcg": 0.0, "ltcg": 0.0, "tax": 0.0, "exit_load": 0.0, "stt": 0.0})
        row["gain"] += it["gain"]
        row["stcg" if it["term"] == "short" else "ltcg"] += it["gain"]
        row["tax"] += it["tax"]
        row["exit_load"] += it["exit_load"]
        row["stt"] += it["stt"]
    realized_funds = [{k: (r2(v) if isinstance(v, float) else v) for k, v in row.items()} for row in by_fund_realized.values()]

    gross = r2(sum(i["gross"] for i in items))
    charges = r2(sum(i["exit_load"] + i["stt"] for i in items))
    realized = {
        "fy": fy, "fy_label": regulatory.fy_label(fy),
        "gain": estimate["realized_net"], "stcg": estimate["stcg"], "ltcg": estimate["ltcg"],
        "gross": gross, "charges": charges, "exit_load": r2(sum(i["exit_load"] for i in items)), "stt": r2(sum(i["stt"] for i in items)),
        "net_before_tax": r2(gross - charges),
        # What transactions in the year cost, each counted once where it was taken: stamp duty out of
        # purchases, exit load and STT out of redemptions. The expense ratio is inside the NAV and is not here.
        "costs": {
            "stamp_duty": r2(sum(l.stamp_duty for l in lots if l.units > 0 and regulatory.financial_year_of(l.date) == fy)),
            "exit_load": r2(sum(l.exit_load for l in lots if l.units < 0 and regulatory.financial_year_of(l.date) == fy)),
            "stt": r2(sum(l.stt for l in lots if l.units < 0 and regulatory.financial_year_of(l.date) == fy)),
        },
        "estimate": estimate, "items": items, "by_fund": realized_funds, "confidence": realized_conf,
        "after_tax": calculate_after_tax_return(
            sum(i["cost"] for i in items), gross, charges, estimate["total"] if estimate["supported"] else None, True
        ) if items else None,
    }

    # --- open lots: what a redemption today would estimate to ---
    baseline_fy = current_fy
    baseline_items = items_by_fy.get(baseline_fy, [])
    baseline = calculate_estimated_tax(baseline_fy, baseline_items, profile)
    open_items: list[dict] = []
    fund_views: list[dict] = []
    open_cov: list[tuple[float, bool]] = []
    exp_unknown: set[str] = set()
    exp_depends: set[str] = set()
    exp_aggregated = False
    exp_grand = False
    exp_noload: set[str] = set()
    for code, book in books.items():
        c = ctx[code]
        if not book.open_lots or not c.in_portfolio or c.latest_nav is None:
            continue
        sale_day = c.nav_date or today
        item_rows = []
        for ol in book.open_lots:
            rz = _hypothetical(ol, ol.units, c.latest_nav, sale_day, c.fund_class, c.exit_tiers)
            fmv = c.nav_on(GRANDFATHER_DAY) if ol.date <= GRANDFATHER_DAY else None
            item, f = realization_item(rz, c.fund_class, c.name, fmv)
            open_cov.append((ol.cost, item is not None))
            if item is None:
                exp_unknown.add(c.name)
            else:
                item_rows.append((ol, item))
                open_items.append(item)
                if c.exit_tiers is None:
                    exp_noload.add(c.name)
                if c.classification["certainty"] == "depends":
                    exp_depends.add(c.name)
                if ol.source == "aggregated":
                    exp_aggregated = True
                if f["grandfathering_missing"]:
                    exp_grand = True
        fund_views.append(_fund_view(c, book, item_rows, baseline_items, profile, baseline, sale_day))

    exposure_estimate = calculate_estimated_tax(baseline_fy, [*baseline_items, *open_items], profile)
    exposure_tax = r2(exposure_estimate["total"] - baseline["total"]) if exposure_estimate["supported"] else None
    exp_missing = []
    if exp_unknown:
        exp_missing.append(f"The tax class of {', '.join(sorted(exp_unknown))} is unknown, so it is left out.")
    exp_assume = profile_assumptions(profile, baseline_fy, any(i["bucket"] == "stcgSlab" for i in open_items)) if exposure_estimate["supported"] else []
    if exp_depends:
        exp_assume.append(f"The tax class of {', '.join(sorted(exp_depends))} depends on the scheme's actual mix.")
    if exp_aggregated:
        exp_assume.append("Some holdings predate dated transactions and use a single purchase date and blended NAV.")
    if exp_grand:
        exp_assume.append("The 31 Jan 2018 NAV was not available for units bought before 1 Feb 2018, so their cost is not grandfathered.")
    if exp_noload:
        exp_assume.append(f"No exit load is entered for {', '.join(sorted(exp_noload))}; any that applies is not deducted.")
    exposure_conf = assess_confidence(_coverage(open_cov), exp_missing, exp_assume)

    unreal_gain = r2(sum(i["gain"] for i in open_items))
    st_gain = r2(sum(i["gain"] for i in open_items if i["term"] == "short"))
    lt_gain = r2(sum(i["gain"] for i in open_items if i["term"] == "long"))
    unrealized = {
        "gain": unreal_gain, "short_term_gain": st_gain, "long_term_gain": lt_gain,
        "exit_load": r2(sum(i["exit_load"] for i in open_items)), "stt": r2(sum(i["stt"] for i in open_items)),
        "potential_tax": exposure_tax, "potential_tax_basis": exposure_estimate["headline"],
        "confidence": exposure_conf, "note": UNREALIZED_NOTE,
        "estimate": exposure_estimate,
    }

    return {
        "fy": fy, "fy_label": regulatory.fy_label(fy), "current_fy": current_fy, "as_of": today.isoformat(),
        "years": [{"fy": y, "label": regulatory.fy_label(y)} for y in years],
        "profile": {"slab_rate_pct": profile.slab_rate_pct, "income_band": profile.income_band, "regime": profile.regime},
        "realized": realized, "unrealized": unrealized, "funds": fund_views,
        "rules": estimate["rules"], "headline": estimate["headline"],
        "history_note": HISTORY_NOTE, "disclosure": DISCLOSURE, "cost_notes": costs.disclosure(),
        "classes": regulatory.tax_rules()["mutualFunds"]["classes"],
    }


def _fund_view(c: FundContext, book: lotlib.Book, rows: list[tuple[lotlib.OpenLot, dict]], baseline_items: list[dict],
               profile: TaxProfile, baseline: dict, sale_day: dt.date) -> dict:
    """One fund's tax picture: its lots, their terms, and what redeeming it alone today would estimate to."""
    items = [item for _, item in rows]
    cost = r2(sum(o.cost for o in book.open_lots))
    units = sum(o.units for o in book.open_lots)
    value = r2(units * (c.latest_nav or 0.0))
    marginal = calculate_estimated_tax(baseline["fy"], [*baseline_items, *items], profile)
    tax_if = r2(marginal["total"] - baseline["total"]) if marginal["supported"] and items else None
    exit_load = r2(sum(i["exit_load"] for i in items))
    first = min((o.date for o in book.open_lots), default=None)
    lot_rows = []
    for ol, it in rows:
        rules = _fy_rules(baseline["fy"])
        placed = bucket_for(c.fund_class, ol.date, sale_day, rules)
        long_from = None
        if placed and not placed["deemed"] and placed["period"]["term"] == "short":
            long_from = placed["period"]["long_term_from"].isoformat()
        lot_rows.append({
            "buy_date": ol.date.isoformat(), "units": ol.units, "cost": r2(ol.cost), "value": it["proceeds"],
            "gain": it["gain"], "term": it["term"], "deemed_short_term": it["deemed_short_term"],
            "held_text": it["held_text"], "held_days": it["held_days"], "bucket": it["bucket"],
            "bucket_label": BUCKET_LABEL[it["bucket"]], "long_term_from": long_from,
            "exit_load": it["exit_load"], "source": ol.source,
        })
    st = sum(i["gain"] for i in items if i["term"] == "short")
    lt = sum(i["gain"] for i in items if i["term"] == "long")
    return {
        "scheme_code": c.scheme_code, "scheme_name": c.name, "category": c.category,
        "classification": c.classification,
        "invested": cost, "value": value, "unrealized_gain": r2(value - cost),
        "first_purchase": first.isoformat() if first else None,
        "lots": lot_rows, "lot_count": len(lot_rows),
        "short_term_units": r2(sum(r["units"] for r in lot_rows if r["term"] == "short")),
        "long_term_units": r2(sum(r["units"] for r in lot_rows if r["term"] == "long")),
        "short_term_gain": r2(st), "long_term_gain": r2(lt),
        "taxable_gain": r2(st + lt),
        "tax_if_redeemed": tax_if,
        "tax_basis": marginal["headline"],
        "exit_load": {
            "status": "applied" if c.exit_tiers and exit_load > 0 else ("none" if c.exit_tiers else "unavailable"),
            "amount_if_redeemed": exit_load if c.exit_tiers else None,
            "terms": c.exit_tiers, "text": costs.exit_load_text(c.exit_tiers),
            "source": "Entered by you" if c.exit_tiers else None,
        },
        "stt_if_redeemed": r2(sum(i["stt"] for i in items)),
        "note": UNREALIZED_NOTE,
    }


# --- redemption preview --------------------------------------------------------------------------------

def redemption_preview(
    holdings,
    transactions,
    scheme_code: int,
    *,
    units: float | None,
    sale_date: dt.date | None = None,
    sale_nav: float | None = None,
    settings: dict[int, dict] | None = None,
    profile: TaxProfile | None = None,
    today: dt.date | None = None,
) -> dict:
    """
    What redeeming `units` (None = every unit) would do: the lots it consumes oldest first, exit load,
    STT, the short- and long-term gains, the estimated tax on top of this year's realised gains, and
    the proceeds at each step. Nothing is recorded.
    """
    profile = profile or EMPTY_PROFILE
    settings = settings or {}
    today = today or dt.date.today()
    lots = lotlib.build_lots(holdings, transactions)
    books = lotlib.replay_all(lots)
    book = books.get(scheme_code)
    if book is None or not book.open_lots:
        raise ValueError("That fund has no units to redeem.")
    all_ctx = _contexts(holdings, books, settings)
    ctx = all_ctx[scheme_code]
    held_units = sum(o.units for o in book.open_lots)
    want = held_units if units is None else units
    if want <= 0:
        raise ValueError("Units to redeem must be above zero.")
    if want > held_units + 1e-9:
        raise ValueError(f"You hold {held_units:g} units; cannot redeem {want:g}.")
    day = sale_date or ctx.nav_date or today
    price = sale_nav
    if price is None:
        price = ctx.nav_on(day) if sale_date else ctx.latest_nav
    if price is None:
        raise ValueError("No NAV is available for that date.")

    realizations = []
    left = want
    for ol in sorted(book.open_lots, key=lambda o: o.date):
        if left <= 1e-9:
            break
        take = min(ol.units, left)
        realizations.append(_hypothetical(ol, take, price, day, ctx.fund_class, ctx.exit_tiers))
        left -= take

    fy = regulatory.financial_year_of(day)
    prior = []
    # Realised gains already booked in that financial year come from every fund, so the exemption is shared.
    for code, b in books.items():
        c = all_ctx[code]
        for rz in b.realizations:
            if regulatory.financial_year_of(rz.sell_date) == fy:
                fmv = c.nav_on(GRANDFATHER_DAY) if rz.buy_date <= GRANDFATHER_DAY else None
                item, _ = realization_item(rz, c.fund_class, c.name, fmv)
                if item:
                    prior.append(item)
    base = calculate_estimated_tax(fy, prior, profile)

    new_items, grand_missing = [], False
    for rz in realizations:
        fmv = ctx.nav_on(GRANDFATHER_DAY) if rz.buy_date <= GRANDFATHER_DAY else None
        item, f = realization_item(rz, ctx.fund_class, ctx.name, fmv)
        grand_missing = grand_missing or f["grandfathering_missing"]
        if item:
            new_items.append(item)
    with_it = calculate_estimated_tax(fy, [*prior, *new_items], profile)
    supported = with_it["supported"] and ctx.fund_class != "unknown"
    marginal = r2(with_it["total"] - base["total"]) if supported else None
    if supported:
        pos = sum(i["gain"] for i in new_items if i["gain"] > 0)
        for i in new_items:
            i["tax"] = r2(marginal * i["gain"] / pos) if pos > 0 and i["gain"] > 0 else 0.0

    gross = r2(want * price)
    exit_load = r2(sum(r.exit_load for r in realizations))
    stt = r2(sum(r.stt for r in realizations))
    cost = r2(sum(r.cost for r in realizations))
    after_charges = r2(gross - exit_load - stt)
    est_after_tax = r2(after_charges - marginal) if marginal is not None else None

    if ctx.exit_tiers:
        exit_info = {"status": "applied" if exit_load > 0 else "none", "amount": exit_load, "terms": ctx.exit_tiers,
                     "text": costs.exit_load_text(ctx.exit_tiers), "source": "Entered by you"}
    else:
        exit_info = {"status": "unavailable", "amount": None, "terms": None, "text": "Exit load information unavailable.", "source": None}

    notes = []
    if exit_info["status"] == "unavailable":
        notes.append("Exit load information unavailable, so none is deducted. Check the scheme information document before an early redemption.")
    if ctx.fund_class == "unknown":
        notes.append("The tax class is unknown, so no tax is estimated. Choose a class for this fund to see one.")
    if ctx.classification["certainty"] == "depends":
        notes.append("This fund's tax class depends on its actual mix; check the scheme documents.")
    if any(i["deemed_short_term"] for i in new_items):
        notes.append("Units bought on or after 1 Apr 2023 in a specified fund are short-term whatever the holding period, taxed at your slab rate.")
    if grand_missing:
        notes.append("Units bought before 1 Feb 2018 would normally use the 31 Jan 2018 NAV as cost; that NAV was not available.")
    notes.extend(with_it["notes"][:-1] if supported else [])
    notes.append("Stamp duty was taken out when the units were bought and is not charged again. The expense ratio is already in the NAV.")

    has_slab = any(i["bucket"] == "stcgSlab" for i in new_items)
    assumptions = profile_assumptions(profile, fy, has_slab) if supported else []
    if ctx.classification["certainty"] == "depends":
        assumptions.append("The tax class depends on the scheme's actual mix.")
    if any(r.buy_source == "aggregated" for r in realizations):
        assumptions.append("Part of this holding predates dated transactions and uses one purchase date and a blended NAV.")
    if exit_info["status"] == "unavailable":
        assumptions.append("Exit load is not known and is not deducted.")
    missing = [] if ctx.fund_class != "unknown" else ["The tax class of this fund is unknown."]
    conf = assess_confidence(0.0 if ctx.fund_class == "unknown" else 100.0, missing, assumptions)

    return {
        "scheme_code": scheme_code, "scheme_name": ctx.name, "classification": ctx.classification,
        "units": want, "all_units": abs(want - held_units) < 1e-9, "nav": price, "date": day.isoformat(),
        "fy": fy, "fy_label": regulatory.fy_label(fy),
        "gross": gross, "cost": cost, "exit_load": exit_info, "stt": {"amount": stt, "rate_pct": costs.stt_rate_pct(ctx.fund_class, day),
                                                                  "note": regulatory.charges()["mutualFunds"]["sttOnRedemption"]["note"] if stt else None},
        "proceeds_after_charges": after_charges,
        "lots": [{
            "buy_date": i["opened_on"], "units": i["units"], "cost": i["cost"], "proceeds": i["proceeds"], "exit_load": i["exit_load"],
            "stt": i["stt"], "taxable_gain": i["gain"], "term": i["term"], "held_text": i["held_text"], "bucket": i["bucket"],
            "bucket_label": BUCKET_LABEL[i["bucket"]], "deemed_short_term": i["deemed_short_term"], "tax": i.get("tax", 0.0),
        } for i in new_items],
        "short_term_gain": r2(sum(i["gain"] for i in new_items if i["term"] == "short")),
        "long_term_gain": r2(sum(i["gain"] for i in new_items if i["term"] == "long")),
        "taxable_gain": r2(sum(i["gain"] for i in new_items)),
        "estimated_tax": marginal, "tax_basis": with_it["headline"] if supported else "Not estimated",
        "estimated_net_proceeds": est_after_tax,
        "exemption_room_after": with_it["exemption_room"] if supported else None,
        "confidence": conf, "notes": notes, "history_note": HISTORY_NOTE, "disclosure": DISCLOSURE,
        "after_tax": {
            "label": "Estimated after-tax value on redemption", "value": est_after_tax,
            "return_pct": ((est_after_tax / cost - 1) * 100) if est_after_tax is not None and cost > 0 else None,
        },
    }


# --- how a class is taxed, in words (all numbers come from the rules) --------------------------------

def _lakh(x: float) -> str:
    return f"₹{x / 100000:g} lakh" if x >= 100000 else f"₹{x:,.0f}"


def rule_summary(fund_class: str, fy: str | None = None) -> dict:
    """The tax rules for a class in plain words, read from the financial year's configured rules."""
    fy = fy or regulatory.financial_year_of(dt.date.today())
    rules = _fy_rules(fy)
    mf = regulatory.tax_rules()["mutualFunds"]["holdingMonths"]
    eq, oth = rules["equity"], rules["other"]
    cutoff = dt.date.fromisoformat(rules["specifiedFund"]["deemedShortTermFrom"])
    if fund_class == "equity":
        return {
            "short_term": f"{eq['stcgRatePct']:g}% if sold within {eq['holdingMonths']} months",
            "long_term": f"{eq['ltcgRatePct']:g}% on gains above {_lakh(eq['ltcgExemption'])} a financial year, after {eq['holdingMonths']} months",
            "threshold_months": eq["holdingMonths"], "fy": fy,
        }
    if fund_class == "specified":
        return {
            "short_term": f"Taxed at your income-tax slab rate, whatever the holding period, for units bought on or after {cutoff:%d %b %Y}",
            "long_term": f"No long-term rate for those units. Units bought earlier get {oth['ltcgRatePct']:g}% after {mf['specifiedBeforeCutoff']} months",
            "threshold_months": None, "fy": fy,
        }
    if fund_class == "other":
        return {
            "short_term": f"Taxed at your income-tax slab rate if sold within {mf['other']} months",
            "long_term": f"{oth['ltcgRatePct']:g}% after {mf['other']} months, with no indexation and no {_lakh(eq['ltcgExemption'])} exemption",
            "threshold_months": mf["other"], "fy": fy,
        }
    return {"short_term": "Depends on the scheme's mix", "long_term": "Check the scheme information document", "threshold_months": None, "fy": fy}
