"""Analyst-grade model audit: materiality-weighted score, blockers, period-aware issues."""
from __future__ import annotations

from pydantic import BaseModel, Field

from .forecast import ForecastResult
from .growth_evidence import GrowthEvidence
from .historical import HistoricalSummary
from .models import HistoricalFinancials
from .valuation import DCFValuationResult
from .wacc import WaccResult


class ValidationIssue(BaseModel):
    severity: str  # "error" | "warning" | "info"
    message: str
    materiality: str = "supporting"  # critical | important | supporting
    scope: str = "current"  # current | historical


class CategoryScore(BaseModel):
    id: str
    name: str
    score: int
    weight: float
    status: str  # verified | warning | critical | blocked
    reasons: list[str] = Field(default_factory=list)


class IntegrityReport(BaseModel):
    score: int
    max_score: int = 100
    issues: list[ValidationIssue]
    status: str = "REVIEW_REQUIRED"
    categories: list[CategoryScore] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    intrinsic_value_reliable: bool = True
    historical_coverage: int = 100
    current_bridge_coverage: int = 100

    @property
    def band(self) -> str:
        labels = {
            "VERIFIED": "Verified",
            "ACCEPTABLE_WITH_LIMITATIONS": "Acceptable with limitations",
            "REVIEW_REQUIRED": "Review required",
            "BLOCKED": "Intrinsic value blocked",
        }
        return labels.get(self.status, f"Model {self.status.lower()}")

    @property
    def summary(self) -> str:
        return f"{self.score}/{self.max_score} - {self.band}"


WEIGHTS = {
    "data": 0.18,
    "historical": 0.08,
    "forecast": 0.08,
    "growth": 0.14,
    "margin": 0.09,
    "fcff": 0.09,
    "wacc": 0.11,
    "terminal": 0.05,
    "bridge": 0.13,
    "audit": 0.05,
}


def _cat(cid: str, name: str, score: int, reasons: list[str], blocked: bool = False) -> CategoryScore:
    score = max(0, min(100, int(round(score))))
    if blocked:
        status = "blocked"
    elif score < 40:
        status = "critical"
    elif score < 70:
        status = "warning"
    else:
        status = "verified"
    return CategoryScore(id=cid, name=name, score=score, weight=WEIGHTS[cid], status=status, reasons=reasons or ["No material issues."])


def _span(periods: list[str]) -> str:
    if not periods:
        return "none"
    if len(periods) == 1:
        return periods[0]
    return f"{periods[0]}–{periods[-1]} ({len(periods)} years)"


def run_validation(
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    forecast: ForecastResult,
    wacc_result: WaccResult,
    valuation: DCFValuationResult | None,
    terminal_growth_ceiling: float = 0.06,
    *,
    evidence: GrowthEvidence | None = None,
    cash_status: str = "reported",
    minority_status: str = "reported",
    shares_ok: bool = True,
    force_status: str | None = None,
    extra_limitations: list[str] | None = None,
    cash_substituted: bool = False,
) -> IntegrityReport:
    issues: list[ValidationIssue] = []
    blockers: list[str] = []

    def add(severity: str, message: str, materiality: str = "supporting", scope: str = "current") -> None:
        issues.append(ValidationIssue(severity=severity, message=message, materiality=materiality, scope=scope))

    latest_bs = hist.balance_sheets[-1] if hist.balance_sheets else None
    latest_inc = hist.income_statements[-1] if hist.income_statements else None
    missing_cash_years = [bs.period for bs in hist.balance_sheets if not bs.cash_reported]
    current_cash_ok = bool(latest_bs and latest_bs.cash_reported)
    current_debt_ok = bool(latest_bs and latest_bs.debt_status != "unavailable")
    wc_complete_latest = bool(latest_bs and latest_bs.operating_wc_complete)

    # --- Data / historical (period-aware, not one warning per year) ---
    data_score = 100
    hist_score = 100
    data_reasons: list[str] = []
    hist_reasons: list[str] = []

    if len(hist.income_statements) < 3:
        add("warning", "Fewer than 3 historical years available; CAGR and trend analysis may be unreliable.", "important", "historical")
        hist_score -= 25
        hist_reasons.append("Fewer than 3 historical years.")
    if latest_inc and latest_inc.revenue < 0:
        add("error", f"Negative revenue in {latest_inc.period}.", "critical", "current")
        data_score -= 40
        blockers.append("Negative latest-year revenue.")
    if latest_inc and latest_inc.revenue == 0:
        add("error", f"Zero revenue in {latest_inc.period}.", "critical", "current")
        data_score -= 40
        blockers.append("Zero latest-year revenue.")
    for inc in hist.income_statements[:-1]:
        if inc.revenue < 0:
            add("error", f"Negative revenue in {inc.period}.", "important", "historical")
            hist_score -= 10
        if inc.revenue == 0:
            add("error", f"Zero revenue in {inc.period}.", "important", "historical")
            hist_score -= 10

    if missing_cash_years:
        if current_cash_ok:
            add(
                "info",
                f"Cash history incomplete: unavailable {_span(missing_cash_years)}. "
                f"Current-period cash ({latest_bs.period}) is verified and used in the equity bridge. "
                "Older years do not affect the current valuation.",
                "supporting",
                "historical",
            )
            hist_score -= min(15, 2 * len(missing_cash_years) // 3)
            hist_reasons.append(f"Historical cash missing {_span(missing_cash_years)}; current cash verified.")
            data_reasons.append("Current cash verified. Historical cash incomplete (not used in the bridge).")
        else:
            add(
                "error",
                f"Current-period cash is unavailable ({latest_bs.period if latest_bs else 'latest'}). "
                f"Unavailable history: {_span(missing_cash_years)}. Missing cash is not treated as zero.",
                "critical",
                "current",
            )
            data_score -= 35
            data_reasons.append("Current cash unavailable — equity bridge cannot be completed.")
            blockers.append("Current cash could not be verified.")

    if latest_bs and latest_bs.cash_reported and latest_bs.cash == 0 and latest_bs.marketable_securities == 0:
        add("warning", f"Reported cash and short-term investments are zero in {latest_bs.period}; verify this is not a mapping gap.", "important", "current")
        data_score -= 8
        data_reasons.append("Reported cash is zero.")

    if not current_debt_ok:
        add("error", "Current-period debt is unavailable. Missing debt is not treated as zero.", "critical", "current")
        data_score -= 30
        blockers.append("Current debt could not be verified.")
        data_reasons.append("Current debt unavailable.")
    else:
        data_reasons.append("Current debt available.")

    if not shares_ok:
        add("error", "Diluted shares outstanding are unavailable. Per-share value is blocked.", "critical", "current")
        data_score -= 30
        blockers.append("Diluted share count could not be verified.")

    if not wc_complete_latest:
        add(
            "warning",
            "Latest-year operating working-capital lines are incomplete. Forecast ΔNWC uses a labelled cash-flow-derived substitute.",
            "important",
            "current",
        )
        data_score -= 8
        data_reasons.append("NWC derived (balance-sheet components incomplete).")
    else:
        data_reasons.append("Latest-year operating NWC available.")

    periods = [i.period for i in hist.income_statements]
    if len(periods) != len(set(periods)):
        add("error", "Duplicate financial periods detected in uploaded historicals.", "critical", "historical")
        hist_score -= 30
        blockers.append("Duplicate financial periods.")

    # --- Forecast / growth / margin / FCFF ---
    forecast_score = 100
    growth_score = 100
    margin_score = 100
    fcff_score = 100
    fc_reasons: list[str] = []
    g_reasons: list[str] = []
    m_reasons: list[str] = []
    f_reasons: list[str] = []

    if forecast.years:
        for y in forecast.years:
            if y.ebitda_margin < 0:
                add("warning", f"Negative EBITDA margin forecast in {y.period}.", "important", "current")
                margin_score -= 15
                forecast_score -= 10
            if y.ebitda_margin > 0.70:
                add("warning", f"EBITDA margin forecast of {y.ebitda_margin:.1%} in {y.period} is unusually high.", "important", "current")
                margin_score -= 8
            if y.fcff < 0:
                add("info", f"Negative unlevered FCF forecast in {y.period} (allowed; not capped).", "supporting", "current")
                fcff_score -= 6
        for i in range(1, len(forecast.years)):
            prev, curr = forecast.years[i - 1], forecast.years[i]
            if prev.revenue and abs(curr.revenue / prev.revenue - 1) > 0.5:
                add("warning", f"Large unexplained revenue jump into {curr.period} (>50% YoY).", "important", "current")
                forecast_score -= 8
                growth_score -= 8
        if evidence:
            g_reasons.append(evidence.year1_rationale)
            if not evidence.high_growth_evidence_ok:
                add("warning", evidence.high_growth_evidence_note, "important", "current")
                growth_score -= 25
                g_reasons.append("High-growth Year 1 lacks sufficient supporting evidence.")
            else:
                growth_score -= 0
                g_reasons.append(f"Regime {evidence.regime.value.replace('_', ' ')}; method {evidence.year1_method}.")
        peak = max(y.ebitda_margin for y in summary.years)
        last_m = forecast.years[-1].ebitda_margin
        if last_m > peak + 0.005:
            add("warning", "Forecast margin is above the historical peak.", "important", "current")
            margin_score -= 20
            m_reasons.append("Margin above historical maximum.")
        else:
            m_reasons.append(f"Terminal-year EBITDA margin {last_m:.1%} vs last-3y median {summary.median_ebitda_margin_3y:.1%}.")
        f_reasons.append("FCFF = NOPAT + D&A − capex − ΔNWC. No hidden NWC cap.")
        fc_reasons.append("Explicit forecast produced; last year equals terminal g by construction.")
    else:
        forecast_score = 0
        blockers.append("No explicit forecast years.")

    # --- WACC / TV / Bridge ---
    wacc_score = 100
    tv_score = 100
    bridge_score = 100
    w_reasons: list[str] = []
    t_reasons: list[str] = []
    b_reasons: list[str] = []
    wacc_blocked = False
    tv_blocked = False

    if wacc_result.wacc <= 0:
        add("error", "WACC is not positive.", "critical", "current")
        wacc_score = 0
        wacc_blocked = True
        blockers.append("WACC is not positive.")
    if wacc_result.wacc < 0.05:
        add("warning", f"WACC {wacc_result.wacc:.2%} is below 5%. Investigate Rf, beta, and ERP.", "important", "current")
        wacc_score -= 15
    if wacc_result.wacc > 0.20:
        add("warning", f"WACC {wacc_result.wacc:.2%} is above 20%. Investigate credit and country risk.", "important", "current")
        wacc_score -= 10
    w_reasons.append(f"WACC {wacc_result.wacc:.2%}; Ke {wacc_result.cost_of_equity:.2%}.")

    terminal = valuation.terminal_growth if valuation else (forecast.assumptions.fade_target if forecast.assumptions else 0.0)
    if wacc_result.wacc <= terminal:
        add("error", f"WACC ({wacc_result.wacc:.2%}) must exceed terminal growth ({terminal:.2%}). Gordon TV is invalid.", "critical", "current")
        tv_score = 0
        wacc_score -= 20
        tv_blocked = True
        blockers.append("WACC does not exceed terminal growth.")
    if valuation and valuation.terminal_growth > terminal_growth_ceiling:
        add("warning", f"Terminal growth {valuation.terminal_growth:.2%} exceeds the {terminal_growth_ceiling:.1%} market ceiling.", "important", "current")
        tv_score -= 12
    if valuation:
        tv = valuation.terminal_value_pct_of_ev
        if tv > 0.90:
            add("warning", f"Terminal value is {tv:.0%} of EV — severe dependency.", "important", "current")
            tv_score -= 20
            t_reasons.append(f"TV/EV {tv:.0%} (severe).")
        elif tv > 0.80:
            add("warning", f"Terminal value is {tv:.0%} of EV — significant dependency.", "important", "current")
            tv_score -= 12
            t_reasons.append(f"TV/EV {tv:.0%}.")
        elif tv > 0.70:
            add("warning", f"Terminal value is {tv:.0%} of EV — review long-term assumptions.", "supporting", "current")
            tv_score -= 6
            t_reasons.append(f"TV/EV {tv:.0%}.")
        else:
            t_reasons.append(f"TV/EV {tv:.0%}.")
        if valuation.equity_bridge.equity_value < 0:
            add("error", "Equity Value is negative. Check debt, leases, NCI, and cash.", "critical", "current")
            bridge_score -= 25
            b_reasons.append("Negative equity value.")
        non_controlling = valuation.equity_bridge.less_minority_interest + valuation.equity_bridge.less_preferred_stock
        if valuation.enterprise_value > 0 and non_controlling / valuation.enterprise_value > 0.15:
            add("warning", "Minority interest and preferred stock are a large share of EV.", "important", "current")
            bridge_score -= 8
    else:
        t_reasons.append("Gordon TV not calculated.")
        if tv_blocked:
            pass

    cash_verified = current_cash_ok or (cash_status or "").lower() in ("available", "reported")
    if not cash_verified and cash_substituted:
        bridge_score = min(bridge_score, 45)
        b_reasons.append("Cash unavailable — per-share IV excludes cash (labeled substitute of 0, not a verified zero).")
    elif not cash_verified:
        bridge_score = min(bridge_score, 20)
        b_reasons.append("Cash unavailable — per-share intrinsic value blocked.")
    else:
        b_reasons.append("Current cash used in the bridge.")
    if (minority_status or "").lower() not in {"reported", "available", "derived", "estimated"}:
        add("warning", "Minority interest is not a verified line; it is not assumed to be zero in the narrative, but the bridge uses 0 with status unavailable.", "important", "current")
        bridge_score -= 10
        b_reasons.append("NCI status: unavailable.")
    if not shares_ok:
        bridge_score = min(bridge_score, 15)
        b_reasons.append("Share count unavailable — per-share value blocked.")
    else:
        b_reasons.append("Diluted shares available.")

    if extra_limitations:
        for msg in extra_limitations:
            add("warning", msg, "important", "current")
            bridge_score -= 8
            b_reasons.append(msg)

    nwc_latest = latest_bs.net_working_capital if latest_bs and latest_inc and latest_inc.revenue else 0.0
    if latest_inc and latest_inc.revenue and latest_bs and latest_bs.operating_wc_complete:
        if nwc_latest / latest_inc.revenue > 1.0:
            add("warning", "Net working capital is unusually large vs revenue (possible real-estate / developer / NAV situation).", "important", "current")
            fcff_score -= 10

    audit_score = 100
    a_reasons = ["Assumptions carry source, method, and rationale in the ledger."]
    if evidence and evidence.year1_method == "user":
        a_reasons.append("Year 1 is a user override.")
    sourced = sum(1 for a in (forecast.assumptions.revenue_growth if forecast.assumptions else []) if a.rationale)
    if not sourced:
        audit_score -= 20

    categories = [
        _cat("data", "Data coverage", data_score, data_reasons, blocked=any("cash" in b.lower() or "debt" in b.lower() or "share" in b.lower() for b in blockers)),
        _cat("historical", "Historical integrity", hist_score, hist_reasons),
        _cat("forecast", "Forecast stability", forecast_score, fc_reasons),
        _cat("growth", "Growth evidence", growth_score, g_reasons),
        _cat("margin", "Margin quality", margin_score, m_reasons),
        _cat("fcff", "FCFF quality", fcff_score, f_reasons),
        _cat("wacc", "WACC quality", wacc_score, w_reasons, blocked=wacc_blocked),
        _cat("terminal", "Terminal value", tv_score, t_reasons, blocked=tv_blocked),
        _cat("bridge", "Equity bridge", bridge_score, b_reasons, blocked=any("cash" in b.lower() or "share" in b.lower() or "debt" in b.lower() for b in blockers)),
        _cat("audit", "Source / auditability", audit_score, a_reasons),
    ]
    weighted = sum(c.score * c.weight for c in categories)
    score = max(0, min(100, int(round(weighted))))

    cash_blocks_iv = (not current_cash_ok) and (not cash_substituted)
    iv_ok = not blockers and (current_cash_ok or cash_substituted) and current_debt_ok and shares_ok and not tv_blocked and not wacc_blocked
    if blockers or tv_blocked or wacc_blocked or cash_blocks_iv or not shares_ok:
        status = "BLOCKED"
    elif score >= 85 and growth_score >= 70 and bridge_score >= 80:
        status = "VERIFIED"
    elif score >= 70:
        status = "ACCEPTABLE_WITH_LIMITATIONS"
    else:
        status = "REVIEW_REQUIRED"

    if valuation and valuation.equity_bridge.equity_value < 0 and status != "BLOCKED":
        status = "REVIEW_REQUIRED"
    if (wacc_result.wacc > 0.20 or wacc_result.wacc < 0.05) and status != "BLOCKED":
        status = "REVIEW_REQUIRED"
    if force_status and status != "BLOCKED":
        rank = {"BLOCKED": 3, "REVIEW_REQUIRED": 2, "ACCEPTABLE_WITH_LIMITATIONS": 1, "VERIFIED": 0}
        if rank.get(force_status, 0) > rank.get(status, 0):
            status = force_status

    hist_cov = max(0, min(100, hist_score))
    bridge_cov = 100 if iv_ok else max(0, bridge_score)

    return IntegrityReport(
        score=score,
        issues=issues,
        status=status,
        categories=categories,
        blockers=blockers,
        intrinsic_value_reliable=iv_ok,
        historical_coverage=hist_cov,
        current_bridge_coverage=bridge_cov,
    )
