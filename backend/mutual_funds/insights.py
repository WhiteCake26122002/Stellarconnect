"""
Portfolio-level observations for the Mutual Fund desk, prioritised and written to describe, not
instruct.

What this module will not do: tell anyone to buy, sell or exit; call a fund "bad"; call a portfolio
"safe"; or invent analysis the data cannot support (stock overlap, sector exposure, expense ratios and
category averages are not connected, and the output says so). Every insight carries the numbers it
rests on and what the investor might review, never what to do.

The suitability comparison uses an *educational reference range* for equity share, chosen from the
stated risk tolerance and horizon. It is a talking point, not a recommendation.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import analysis, portfolio

__all__ = ["InvestorProfile", "reference_range", "build_insights", "insights_view", "BANNED_PHRASES"]

AGE = {"u25": "Under 25", "25-34": "25–34", "35-44": "35–44", "45-54": "45–54", "55+": "55+"}
HORIZON = {"lt3": "under 3 years", "3-5": "3–5 years", "5-10": "5–10 years", "10+": "10+ years"}
RISK = {"conservative": "Conservative", "moderate": "Moderate", "aggressive": "Aggressive"}
OBJECTIVE = {
    "wealth": "Wealth creation", "retirement": "Retirement", "preservation": "Capital preservation",
    "goal": "A short or medium-term goal", "tax": "Tax efficiency", "education": "Education", "other": "Other",
}

SEVERITY_RANK = {"high": 0, "medium": 1, "info": 2}
MAX_SHOWN = 5

# Words the engine must never emit. A test scans every generated sentence for these.
BANNED_PHRASES = ("you should sell", "you should buy", "sell this", "buy this", "exit immediately", "bad fund", "is safe", "will outperform", "guaranteed")

FUND_HIGH, FUND_MEDIUM = 40.0, 25.0
AMC_HIGH, AMC_MEDIUM = 50.0, 35.0
CATEGORY_WEIGHT_MEDIUM = 60.0
MANY_FUNDS = 10
SMALL_POSITION_PCT = 3.0
REGULAR_WEIGHT_MEDIUM = 60.0


@dataclass(frozen=True)
class InvestorProfile:
    age: str | None = None
    horizon: str | None = None
    risk: str | None = None
    objective: str | None = None

    @classmethod
    def from_params(cls, *, age=None, horizon=None, risk=None, objective=None) -> "InvestorProfile":
        return cls(
            age=age if age in AGE else None,
            horizon=horizon if horizon in HORIZON else None,
            risk=risk if risk in RISK else None,
            objective=objective if objective in OBJECTIVE else None,
        )

    @property
    def usable(self) -> bool:
        """Enough to compare an allocation against: a risk tolerance."""
        return self.risk is not None

    def label(self) -> str:
        parts = []
        if self.risk:
            parts.append(RISK[self.risk])
        if self.horizon:
            parts.append(f"{HORIZON[self.horizon]} horizon")
        if self.objective:
            parts.append(OBJECTIVE[self.objective].lower())
        return " · ".join(parts) if parts else "Not set"


_BASE_EQUITY = {"conservative": (20.0, 40.0), "moderate": (40.0, 65.0), "aggressive": (65.0, 90.0)}


def reference_range(profile: InvestorProfile) -> tuple[float, float] | None:
    """An educational equity-share range (percent of the portfolio) for the stated profile."""
    if not profile.risk:
        return None
    lo, hi = _BASE_EQUITY[profile.risk]
    if profile.horizon == "lt3":
        hi = min(hi, 30.0)
    elif profile.horizon == "3-5":
        hi = min(hi, 55.0)
    elif profile.horizon == "10+":
        hi = min(95.0, hi + 5.0)
    if profile.objective == "preservation":
        hi = min(hi, 40.0)
    if profile.age == "55+":
        hi = min(hi, 70.0)
    lo = min(lo, max(0.0, hi - 15.0))
    return lo, hi


def _insight(id_: str, category: str, severity: str, title: str, why: str, review: str, evidence: list[str], score: float = 0.0) -> dict:
    return {"id": id_, "category": category, "severity": severity, "title": title, "why": why, "review": review,
            "evidence": evidence, "score": score}


def _is_equity(row: dict) -> bool:
    cls = analysis.classify_asset_class(row["scheme_category"])
    if cls == "Equity":
        return True
    name = row["scheme_name"].lower()
    return cls == "Index/ETF" and any(k in name for k in ("nifty", "sensex", "midcap", "smallcap", "equity"))


def _pct(x: float) -> str:
    return f"{x:.0f}%"


def _rupees(x: float) -> str:
    return f"₹{x:,.0f}"


def _tax_insights(tax: dict) -> list[dict]:
    """
    Observations from the tax view. They describe where a threshold or a date stands; none of them says
    to redeem, hold or switch, because tax alone is not a reason to change an investment.
    """
    import datetime as dt

    out: list[dict] = []
    realized, unrealized = tax["realized"], tax["unrealized"]
    est = realized["estimate"]
    as_of = dt.date.fromisoformat(tax["as_of"])
    lots = [(f, lot) for f in tax["funds"] for lot in f["lots"]]

    # Unused Section 112A exemption, only when there is eligible long-term equity gain to compare it with.
    eligible = sum(lot["gain"] for f, lot in lots if lot["bucket"] == "ltcg112A" and lot["gain"] > 0)
    if est["supported"] and tax["fy"] == tax["current_fy"] and est["exemption_room"] > 0 and eligible > 0:
        out.append(_insight(
            "tax-threshold", "Tax", "info",
            f"{_rupees(est['exemption_room'])} of the annual long-term equity exemption is unused so far this financial year",
            f"The {_rupees(est['exemption_limit'])} Section 112A exemption applies to the year's total long-term equity gains. "
            f"Based on the realized gains available, {_rupees(est['exemption_applied'])} of it has been used, and your holdings carry about "
            f"{_rupees(eligible)} of long-term equity gain that is not yet realized.",
            "Consider discussing whether tax-loss harvesting or realizing gains fits your overall investment plan with a tax professional. "
            "Tax alone is not a reason to change a holding.",
            [f"Realized long-term equity gain this year: {_rupees(max(0.0, est['buckets']['ltcg112A']['net_after_set_off']))}",
             f"Not yet realized, long-term equity: {_rupees(eligible)}"], 30,
        ))

    # Lots about to cross the long-term line.
    soon = []
    for f, lot in lots:
        lt_from = lot.get("long_term_from")
        if lt_from and lot["term"] == "short" and not lot["deemed_short_term"]:
            days = (dt.date.fromisoformat(lt_from) - as_of).days
            if 0 < days <= 60:
                soon.append((f, lot, days))
    if soon:
        funds = sorted({f["scheme_name"] for f, _, _ in soon})
        gain = sum(lot["gain"] for _, lot, _ in soon)
        out.append(_insight(
            "tax-holding-period", "Tax", "info",
            f"{len(soon)} lot{'s' if len(soon) != 1 else ''} become long-term within 60 days",
            "Each purchase, including every SIP instalment, has its own holding period, and the long-term rate applies only to units held past the threshold. "
            f"These lots carry about {_rupees(gain)} of gain.",
            "The holding-period date is one factor among many; it is not a reason on its own to hold or to redeem.",
            [f"Next date: {min(lot['long_term_from'] for _, lot, _ in soon)}", *funds[:3]], 28,
        ))

    # What transactions cost this year.
    c = realized["costs"]
    total = c["stamp_duty"] + c["stt"] + c["exit_load"]
    if total > 0:
        parts = [f"stamp duty {_rupees(c['stamp_duty'])}"] if c["stamp_duty"] else []
        parts += [f"STT {_rupees(c['stt'])}"] if c["stt"] else []
        parts += [f"load {_rupees(c['exit_load'])}"] if c["exit_load"] else []
        out.append(_insight(
            "tax-costs", "Tax", "info",
            f"Transaction costs this financial year: {_rupees(total)}",
            "Stamp duty is taken out of each purchase and STT and any load out of each redemption. The expense ratio is already inside the NAV and is not counted here.",
            "These are small next to returns; they are shown so that net figures can be reconciled.", parts, 12,
        ))

    # The estimate is only as good as its inputs.
    for scope, label in ((realized, "realized gains"), (unrealized, "redemption estimate")):
        conf = scope["confidence"]
        if conf["level"] == "incomplete":
            out.append(_insight(
                f"tax-incomplete-{label.split()[0]}", "Tax", "medium", f"The tax estimate for your {label} is incomplete",
                "Part of the history has no usable date or tax class, so the figure leaves it out.",
                "Choose a tax class for the funds listed, or add the missing transactions.",
                [conf["basis"], *conf["reasons"][:2]], 55,
            ))
    return out


def build_insights(rows: list[dict], profile: InvestorProfile, report: dict | None = None, tax: dict | None = None) -> dict:
    """`rows` are enriched holdings (portfolio.enrich); `report` is an optional analysis_view result;
    `tax` is an optional tax.calculate_mutual_fund_tax result."""
    available = [r for r in rows if r["data_available"]]
    missing = [r for r in rows if not r["data_available"]]
    total = sum(r["value"] for r in available)
    out: list[dict] = []

    if missing:
        names = ", ".join(r["scheme_name"] for r in missing[:3])
        out.append(_insight(
            "no-nav", "Data", "medium", f"{len(missing)} scheme{'s' if len(missing) != 1 else ''} could not be valued",
            "A live NAV could not be fetched, so these schemes are left out of every figure below.",
            "Check again later, or confirm the scheme still exists.", [names], 60,
        ))
    if not available or total <= 0:
        return {"insights": out[:MAX_SHOWN], "also_noted": [], "suitability": None, "stats": {"funds": 0}}

    weights = [(r, r["value"] / total * 100) for r in available]
    n = len(available)

    # --- concentration --------------------------------------------------------------------------
    if n == 1:
        r = available[0]
        out.append(_insight(
            "single-fund", "Concentration", "high", "Your portfolio is a single fund",
            "Everything depends on one fund's management, style and category.",
            "Consider whether holding only one fund is intentional.", [f"{r['scheme_name']}: 100% of value"], 100,
        ))
    else:
        for r, w in sorted(weights, key=lambda x: -x[1]):
            if w >= FUND_MEDIUM:
                sev = "high" if w >= FUND_HIGH else "medium"
                out.append(_insight(
                    f"fund-{r['scheme_code']}", "Concentration", sev, f"{_pct(w)} of your portfolio is in one fund",
                    "A holding this large means the portfolio's results track that one fund closely.",
                    "Consider whether this weight is intentional.", [f"{r['scheme_name']}: {w:.1f}% of value"], 80 + w,
                ))
                break

        by_amc: dict[str, float] = {}
        for r, w in weights:
            by_amc[r["fund_house"]] = by_amc.get(r["fund_house"], 0.0) + w
        amc, amc_w = max(by_amc.items(), key=lambda kv: kv[1])
        if amc_w >= AMC_MEDIUM:
            out.append(_insight(
                "amc", "Concentration", "high" if amc_w >= AMC_HIGH else "medium", f"{_pct(amc_w)} of your portfolio is with one fund house",
                "A large share with one fund house concentrates operational and investment-process exposure, even across different funds.",
                "Consider whether this concentration is intentional.", [f"{amc}: {amc_w:.1f}% of value"], 70 + amc_w,
            ))

        by_cat: dict[str, list[tuple[dict, float]]] = {}
        for r, w in weights:
            by_cat.setdefault(r["scheme_category"], []).append((r, w))
        for cat, group in by_cat.items():
            cw = sum(w for _, w in group)
            if len(group) >= 3 or (len(group) >= 2 and cw >= CATEGORY_WEIGHT_MEDIUM):
                out.append(_insight(
                    f"category-{cat}", "Diversification", "medium", f"{len(group)} funds sit in the same category",
                    "Funds in one category tend to hold similar kinds of companies, so they add less variety than their number suggests.",
                    "Consider whether each adds something the others do not.",
                    [f"{cat.split(' - ')[-1]}: {len(group)} funds, {cw:.0f}% of value"], 55 + cw / 10,
                ))
                break

    # --- risk against the stated profile ---------------------------------------------------------
    equity_pct = sum(w for r, w in weights if _is_equity(r))
    high_risk_pct = sum(w for r, w in weights if analysis.classify_market_cap(r["scheme_category"]) in ("Small Cap",) or "sectoral" in r["scheme_category"].lower() or "thematic" in r["scheme_category"].lower())
    hybrid_pct = sum(w for r, w in weights if analysis.classify_asset_class(r["scheme_category"]) == "Hybrid")
    suit = None
    rng = reference_range(profile)
    if rng:
        lo, hi = rng
        status = "above" if equity_pct > hi else "below" if equity_pct < lo else "within"
        suit = {
            "profile": profile.label(), "equity_pct": equity_pct, "reference_low": lo, "reference_high": hi, "status": status,
            "high_risk_equity_pct": high_risk_pct, "hybrid_pct": hybrid_pct,
            "text": (
                f"{equity_pct:.0f}% of the portfolio is in equity-labelled funds"
                + (f", and {hybrid_pct:.0f}% is in hybrid funds whose equity share is not known" if hybrid_pct else "")
                + f". An educational reference range for this profile is {lo:.0f}–{hi:.0f}% equity."
            ),
        }
        if status == "above":
            gap = equity_pct - hi
            out.append(_insight(
                "equity-above", "Risk", "high" if gap >= 15 else "medium", "Equity share is above the reference range for your profile",
                f"For a {RISK[profile.risk].lower()} investor"
                + (f" with a {HORIZON[profile.horizon]} horizon" if profile.horizon else "")
                + ", this may be a relatively aggressive allocation.",
                "Consider reviewing whether this allocation matches your stated risk tolerance.",
                [f"Equity {equity_pct:.0f}% vs reference {lo:.0f}–{hi:.0f}%"], 90 + gap,
            ))
        elif status == "below" and (lo - equity_pct) >= 10 and profile.horizon in ("5-10", "10+"):
            out.append(_insight(
                "equity-below", "Risk", "info", "Equity share is below the reference range for your horizon",
                "A long horizon with a low equity share means growth may be lower than your stated horizon would allow, in exchange for lower swings.",
                "Consider whether this lower-risk stance is intentional.", [f"Equity {equity_pct:.0f}% vs reference {lo:.0f}–{hi:.0f}%"], 40,
            ))
        cap = {"conservative": 15.0, "moderate": 30.0, "aggressive": 50.0}[profile.risk]
        if high_risk_pct > cap:
            out.append(_insight(
                "high-risk-categories", "Risk", "medium" if profile.risk != "aggressive" else "info",
                f"{_pct(high_risk_pct)} is in higher-volatility categories",
                "Small-cap and sector or thematic funds have historically swung more than broad funds.",
                f"Consider whether this fits a {RISK[profile.risk].lower()} tolerance.",
                [f"Small-cap + sector/thematic: {high_risk_pct:.0f}% (a {RISK[profile.risk].lower()} reference is up to {cap:.0f}%)"], 65 + high_risk_pct / 5,
            ))
    else:
        out.append(_insight(
            "profile-missing", "Profile", "info", "Add your profile for suitability context",
            "Risk tolerance, horizon and objective let the risk checks compare your allocation with something meaningful.",
            "Answer a few optional questions; nothing leaves your account.", [], 30,
        ))

    # --- performance, only where the window is long enough -------------------------------------
    funds = (report or {}).get("funds") or []
    if funds:
        days = (report.get("period") or {}).get("days", 0)
        judged = [f for f in funds if f["verdict"] in ("outperformed", "underperformed", "in_line")]
        if not judged and days >= 30:
            pass  # only trackers, or no comparable benchmark: nothing fair to say about performance
        elif not judged:
            out.append(_insight(
                "perf-early", "Performance", "info", "Too early to judge performance",
                f"Your first purchase was {days} days ago. Short windows are dominated by noise, so benchmark verdicts are held back until at least 30 days of holding.",
                "Revisit once there is more history.", [f"{days} days since the first purchase"], 20,
            ))
        else:
            under = [f for f in judged if f["verdict"] == "underperformed"]
            if under:
                worst = min(under, key=lambda f: f["relative_pp"])
                out.append(_insight(
                    "perf-under", "Performance", "medium", f"{len(under)} of {len(judged)} funds trailed their benchmark",
                    "Trailing a benchmark over a short period is common and is not on its own a reason to change anything.",
                    "Consider reviewing the largest gaps against the fund's own history and category.",
                    [f"{f['scheme_name']}: {f['relative_pp']:+.1f} pts vs {f['benchmark']['label']} ({f['period']['label']})" for f in under[:3]], 50 - worst["relative_pp"],
                ))
            elif any(f["verdict"] == "outperformed" for f in judged):
                out.append(_insight(
                    "perf-ok", "Performance", "info", "Funds with a comparable benchmark kept pace or led it",
                    "Measured over the same dates as each fund's own purchases.", "No action implied; past results do not predict future ones.",
                    [f"{f['scheme_name']}: {f['relative_pp']:+.1f} pts" for f in judged[:3]], 15,
                ))

    # --- cost ---------------------------------------------------------------------------------------
    regular = sum(w for r, w in weights if r["plan"] == "Regular")
    n_regular = sum(1 for r, _ in weights if r["plan"] == "Regular")
    if n_regular:
        long = profile.horizon in ("5-10", "10+")
        out.append(_insight(
            "regular-plans", "Cost", "medium" if (regular >= REGULAR_WEIGHT_MEDIUM and long) else "info",
            f"{n_regular} of {n} funds are regular plans",
            "Regular plans carry a distributor commission inside their expense ratio, so a direct plan of the same fund usually costs less. Expense-ratio data is not connected here, so the size of the gap is not shown.",
            "Consider comparing the regular and direct plan's expense ratio before deciding anything.",
            [f"Regular plans: {regular:.0f}% of value"], 45 + regular / 10,
        ))

    # --- efficiency -----------------------------------------------------------------------------------
    if n >= MANY_FUNDS:
        out.append(_insight(
            "many-funds", "Efficiency", "medium", f"{n} funds is a long list to follow",
            "Beyond a handful of funds, each additional one tends to overlap with the others.",
            "Consider whether every fund has a distinct role.", [f"{n} funds"], 50,
        ))
    small = [r for r, w in weights if w < SMALL_POSITION_PCT]
    if len(small) >= 3:
        out.append(_insight(
            "small-positions", "Efficiency", "info", f"{len(small)} positions are under {SMALL_POSITION_PCT:.0f}% of the portfolio",
            "Positions this small barely move the total result.", "Consider whether they are worth the attention.",
            [r["scheme_name"] for r in small[:3]], 25,
        ))

    # --- what cannot be said -----------------------------------------------------------------------
    if n >= 2:
        out.append(_insight(
            "overlap-unavailable", "Diversification", "info", "Holdings overlap unavailable",
            "Stock-level overlap needs each fund's latest monthly portfolio disclosure, which is not connected. The category check above is the closest available signal.",
            "No inference is drawn about shared stocks.", [], 10,
        ))

    if tax:
        out.extend(_tax_insights(tax))

    out.sort(key=lambda i: (SEVERITY_RANK[i["severity"]], -i["score"]))
    stats = {
        "funds": n, "categories": len({r["scheme_category"] for r in available}), "amcs": len({r["fund_house"] for r in available}),
        "equity_pct": equity_pct, "high_risk_equity_pct": high_risk_pct, "hybrid_pct": hybrid_pct, "regular_pct": regular,
    }
    return {"insights": out[:MAX_SHOWN], "also_noted": out[MAX_SHOWN:], "suitability": suit, "stats": stats}


def insights_view(holdings, transactions, profile: InvestorProfile, report: dict | None = None, tax: dict | None = None) -> dict:
    rows = portfolio.enrich(holdings, transactions)
    if report is None and any(r["data_available"] for r in rows):
        report = portfolio.analysis_view(holdings, transactions)
    result = build_insights(rows, profile, report if report and report.get("ready") else None, tax)
    result["profile"] = {"age": profile.age, "horizon": profile.horizon, "risk": profile.risk, "objective": profile.objective, "label": profile.label(), "complete": profile.usable}
    result["disclaimer"] = portfolio.DISCLAIMER
    return result
