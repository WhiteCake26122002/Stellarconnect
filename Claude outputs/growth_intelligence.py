"""
Method C growth intelligence: LLM proposes, program verifies, Method A is fallback.

The forecast engine still owns compounding. This module only replaces the
default revenue-growth Assumption series. User year-overrides still win.
"""
from __future__ import annotations

import threading
import time
from typing import Any

from pydantic import BaseModel

from .forecast import ForecastAssumptions
from .growth_features import (
    GrowthFeaturePack,
    capex_pct_from_growth,
    extract_growth_features,
    feature_pack_hash,
)
from .growth_llm import GrowthLLMError, GrowthLLMProvider, GrowthLLMTimeout
from .historical import HistoricalSummary
from .models import Assumption, AssumptionSource, Company, Confidence, HistoricalFinancials

_CACHE_LOCK = threading.Lock()
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_S = 30 * 60
_CACHE_MAX = 64

_CIRCUIT_LOCK = threading.Lock()
_FAILS = 0
_OPEN_UNTIL = 0.0
_FAIL_THRESHOLD = 3
_COOLDOWN_S = 60.0


class GrowthIntelligenceTrace(BaseModel):
    status: str  # evidence | llm | local | fallback | historical
    configured: bool
    model: str = ""
    fallback_reason: str | None = None
    clamped: bool = False
    abstained: bool = False
    thesis: str = ""
    latency_ms: int | None = None
    used_cache: bool = False
    method: str = "evidence"
    llm_suggested_year1: float | None = None


class GrowthIntelligenceResult(BaseModel):
    assumptions: ForecastAssumptions
    trace: GrowthIntelligenceTrace


def reset_growth_intelligence_state() -> None:
    global _FAILS, _OPEN_UNTIL
    with _CACHE_LOCK:
        _CACHE.clear()
    with _CIRCUIT_LOCK:
        _FAILS = 0
        _OPEN_UNTIL = 0.0


def _circuit_open() -> bool:
    with _CIRCUIT_LOCK:
        return time.monotonic() < _OPEN_UNTIL


def _circuit_success() -> None:
    global _FAILS
    with _CIRCUIT_LOCK:
        _FAILS = 0


def _circuit_failure() -> None:
    global _FAILS, _OPEN_UNTIL
    with _CIRCUIT_LOCK:
        _FAILS += 1
        if _FAILS >= _FAIL_THRESHOLD:
            _OPEN_UNTIL = time.monotonic() + _COOLDOWN_S


def _cache_get(key: str) -> dict[str, Any] | None:
    now = time.monotonic()
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if not hit:
            return None
        expires, payload = hit
        if expires < now:
            _CACHE.pop(key, None)
            return None
        return payload


def _cache_put(key: str, payload: dict[str, Any]) -> None:
    with _CACHE_LOCK:
        if len(_CACHE) >= _CACHE_MAX:
            oldest = next(iter(_CACHE))
            _CACHE.pop(oldest, None)
        _CACHE[key] = (time.monotonic() + _CACHE_TTL_S, payload)


def _pct(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.1%}"


def verify_growth_proposal(
    raw: dict[str, Any],
    pack: GrowthFeaturePack,
) -> tuple[list[float], list[str], str, Confidence, bool, str | None]:
    """
    Fail closed. Returns (path, rationales, thesis, confidence, clamped, reject_reason).
    reject_reason set means the caller must use Method A.
    """
    if raw.get("abstain") is True:
        reason = str(raw.get("abstain_reason") or "model abstained").strip() or "model abstained"
        return [], [], "", Confidence.LOW, False, f"abstain: {reason[:240]}"

    path_in = raw.get("revenue_growth")
    if not isinstance(path_in, list) or len(path_in) != pack.forecast_years:
        return [], [], "", Confidence.LOW, False, "invalid growth path length"

    path: list[float] = []
    try:
        for item in path_in:
            path.append(float(item))
    except (TypeError, ValueError):
        return [], [], "", Confidence.LOW, False, "non-numeric growth path"

    if any(not (item == item) for item in path):  # NaN
        return [], [], "", Confidence.LOW, False, "non-numeric growth path"

    rationales_in = raw.get("year_rationales") or []
    if not isinstance(rationales_in, list):
        rationales_in = []
    rationales = [str(item).strip()[:400] for item in rationales_in]
    while len(rationales) < pack.forecast_years:
        rationales.append("")
    rationales = rationales[: pack.forecast_years]

    thesis = str(raw.get("thesis") or "").strip()[:600]
    conf_raw = str(raw.get("confidence") or "Medium")
    try:
        confidence = Confidence(conf_raw)
    except ValueError:
        confidence = Confidence.MEDIUM

    clamped = False
    out: list[float] = []
    for i, g in enumerate(path):
        lo = pack.min_year_growth
        hi = pack.max_year_growth
        bounded = min(max(g, lo), hi)
        if abs(bounded - g) > 1e-12:
            clamped = True
            rationales[i] = (
                f"{rationales[i]} Clamped from {g:.1%} to {bounded:.1%} by the model's growth rails."
            ).strip()
        out.append(bounded)

    last = out[-1]
    target = pack.long_term_growth_rate
    if abs(last - target) > 0.03:
        clamped = True
        out[-1] = target
        rationales[-1] = (
            f"{rationales[-1]} Final year forced to the terminal growth rate of {target:.1%} "
            f"(proposal was {last:.1%})."
        ).strip()

    if not thesis:
        thesis = "LLM proposed a growth path from the supplied historical features."
    if clamped:
        confidence = Confidence.LOW
    return out, rationales, thesis, confidence, clamped, None


def _apply_growth_assumptions(
    base: ForecastAssumptions,
    path: list[float],
    pack: GrowthFeaturePack,
    *,
    source: AssumptionSource,
    confidence: Confidence,
    thesis: str,
    year_notes: list[str],
    model_name: str,
    clamped: bool,
    prefix: str,
) -> ForecastAssumptions:
    updated = base.model_copy(deep=True)
    notes = list(year_notes)
    while len(notes) < len(path):
        notes.append("")
    hist_ref = pack.cagr_5y or pack.cagr_3y or pack.recent_2y_avg_growth
    clamp_note = " Verifier clamped at least one year." if clamped else ""
    revenue: list[Assumption] = []
    for period, g, year_note in zip(updated.forecast_years, path, notes):
        rationale = (
            f"{prefix}{period} revenue growth is {g:.1%}. Thesis: {thesis} "
            f"Grounding: 5y CAGR {_pct(pack.cagr_5y)}, 3y CAGR {_pct(pack.cagr_3y)}, "
            f"recent 2y {_pct(pack.recent_2y_avg_growth)}, implied g=ROIC×RR {_pct(pack.implied_fundamental_g)} "
            f"(vs {_pct(hist_ref)} historical reference). {year_note}{clamp_note}"
        ).strip()
        revenue.append(
            Assumption(
                name="Revenue Growth",
                value=g,
                unit="%",
                period=period,
                source=source,
                confidence=confidence,
                rationale=rationale,
            )
        )
    updated.revenue_growth = revenue

    capex_path = capex_pct_from_growth(pack, path)
    if capex_path is not None:
        capex: list[Assumption] = []
        for period, g, capex_pct in zip(updated.forecast_years, path, capex_path):
            rr = (g / pack.roic) if pack.roic else 0.0
            capex.append(
                Assumption(
                    name="Capex % of Revenue",
                    value=capex_pct,
                    unit="% of revenue",
                    period=period,
                    source=AssumptionSource.CALCULATED,
                    confidence=confidence,
                    rationale=(
                        f"{period} capex is {capex_pct:.1%} of revenue so reinvestment matches the "
                        f"{g:.1%} growth assumption at ROIC {_pct(pack.roic)} "
                        f"(RR = g/ROIC = {rr:.1%}; NWC intensity held at {pack.avg_nwc_pct_revenue:.1%}). "
                        f"Identity: g = ROIC × reinvestment rate."
                    ),
                )
            )
        updated.capex_pct_revenue = capex
    return updated


def _local_growth_result(
    base: ForecastAssumptions,
    pack: GrowthFeaturePack,
    *,
    configured: bool,
    model_name: str,
    fallback_reason: str | None,
    abstained: bool = False,
    latency_ms: int | None = None,
    used_cache: bool = False,
    extra_thesis: str = "",
) -> GrowthIntelligenceResult:
    path = pack.baseline_revenue_growth or []
    thesis = (
        extra_thesis
        or "Revenue growth is set by the evidence engine (Year-1 hierarchy, then fade to terminal "
        "growth). The LLM is not the source of the numeric path."
    )
    prefix = ""
    if fallback_reason:
        prefix = f"LLM growth intelligence unavailable ({fallback_reason}); using identity fade. "
    assumptions = _apply_growth_assumptions(
        base,
        path,
        pack,
        source=AssumptionSource.CALCULATED,
        confidence=Confidence.MEDIUM,
        thesis=thesis,
        year_notes=[""] * len(path),
        model_name=model_name,
        clamped=False,
        prefix=prefix,
    )
    return GrowthIntelligenceResult(
        assumptions=assumptions,
        trace=GrowthIntelligenceTrace(
            status="evidence",
            configured=configured,
            model=model_name,
            fallback_reason=fallback_reason,
            abstained=abstained,
            thesis=thesis,
            method="evidence",
            latency_ms=latency_ms,
            used_cache=used_cache,
        ),
    )


def _evidence_result(
    base: ForecastAssumptions,
    *,
    configured: bool,
    model_name: str = "",
    fallback_reason: str | None = None,
    thesis: str = "",
    latency_ms: int | None = None,
    used_cache: bool = False,
    llm_suggested_year1: float | None = None,
    abstained: bool = False,
    status: str = "evidence",
    method: str = "evidence",
) -> GrowthIntelligenceResult:
    default_thesis = thesis or (
        base.revenue_growth[0].rationale
        if base.revenue_growth
        else "Evidence engine set the growth path. The LLM is not the source of numeric assumptions."
    )
    return GrowthIntelligenceResult(
        assumptions=base,
        trace=GrowthIntelligenceTrace(
            status=status,
            configured=configured,
            model=model_name,
            fallback_reason=fallback_reason,
            thesis=default_thesis,
            method=method,
            latency_ms=latency_ms,
            used_cache=used_cache,
            llm_suggested_year1=llm_suggested_year1,
            abstained=abstained,
        ),
    )


def apply_growth_intelligence(
    base: ForecastAssumptions,
    company: Company,
    hist: HistoricalFinancials,
    summary: HistoricalSummary,
    *,
    growth_method: str,
    long_term_growth_rate: float,
    terminal_growth_ceiling: float,
    provider: GrowthLLMProvider | None,
) -> GrowthIntelligenceResult:
    """
    Numeric growth comes from `base` (the evidence engine). The LLM may only
    explain. Suggested LLM paths are recorded, never applied.
    """
    method = (growth_method or "evidence").strip().lower()
    if method not in {"llm", "historical", "evidence"}:
        method = "evidence"

    configured = bool(provider and provider.configured)
    model_name = provider.model_name if provider else ""

    if method == "historical":
        return _evidence_result(
            base,
            configured=configured,
            model_name=model_name,
            thesis="Legacy 2-year run-rate glide, faded to terminal growth.",
            status="historical",
            method="historical",
        )

    if method != "llm" or not configured:
        # Reconcile terminal-year capex with the growth path via g = ROIC x reinvestment
        # rate. Without this, `_capex_end` picks terminal capex from a template lookup
        # and `terminal_growth_for_company` picks g from an independent currency/regime
        # lookup, so the implied terminal ROIC is whatever falls out of two unrelated
        # tables (it has ranged from -55% to +108% across companies we've checked) and
        # nothing in the pipeline actually decided that return. `capex_pct_from_growth`
        # already encodes the correct identity and clamps reinvestment rate to >= 0 (so a
        # low/negative historical reinvestment rate can no longer manufacture a terminal
        # year that releases capital while revenue keeps growing); it was computed but
        # never applied outside the LLM/local-fallback path. It intentionally returns
        # None (leaving the template-based capex untouched) when trailing ROIC is
        # unusable or NOPAT margin is non-positive, which is the right behavior for a
        # loss-making grower, so it's safe to apply unconditionally here.
        pack = extract_growth_features(
            company,
            hist,
            summary,
            forecast_years=len(base.forecast_years),
            long_term_growth_rate=long_term_growth_rate,
            terminal_growth_ceiling=terminal_growth_ceiling,
        )
        path = [a.effective_value for a in base.revenue_growth] or pack.baseline_revenue_growth
        reconciled = _apply_growth_assumptions(
            base,
            path,
            pack,
            source=AssumptionSource.CALCULATED,
            confidence=Confidence.MEDIUM,
            thesis=(
                "Revenue growth is set by the evidence engine (Year-1 hierarchy, then fade "
                "to terminal growth). The LLM is not the source of the numeric path. "
                "Terminal capex is reconciled to that growth path via g = ROIC x "
                "reinvestment rate so the implied terminal return is explicit rather than "
                "an accident of an unrelated capex-template lookup."
            ),
            year_notes=[""] * len(path),
            model_name=model_name,
            clamped=False,
            prefix="",
        )
        return _evidence_result(
            reconciled,
            configured=configured,
            model_name=model_name,
            fallback_reason=None if method != "llm" else "not_configured",
            status="evidence",
            method="evidence",
        )

    if _circuit_open():
        return _evidence_result(
            base,
            configured=True,
            model_name=model_name,
            fallback_reason="circuit_open",
        )

    pack = extract_growth_features(
        company,
        hist,
        summary,
        forecast_years=len(base.forecast_years),
        long_term_growth_rate=long_term_growth_rate,
        terminal_growth_ceiling=terminal_growth_ceiling,
    )
    cache_key = feature_pack_hash(pack, model_name)
    cached = _cache_get(cache_key)
    used_cache = cached is not None
    started = time.perf_counter()
    if cached is not None:
        raw = cached
        latency_ms = 0
    else:
        try:
            raw = provider.complete(pack)
        except GrowthLLMTimeout:
            _circuit_failure()
            return _evidence_result(
                base,
                configured=True,
                model_name=model_name,
                fallback_reason="timeout",
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
        except GrowthLLMError:
            _circuit_failure()
            return _evidence_result(
                base,
                configured=True,
                model_name=model_name,
                fallback_reason="provider_error",
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
        latency_ms = int((time.perf_counter() - started) * 1000)
        _cache_put(cache_key, raw)

    _path, _rationales, thesis, _confidence, _clamped, reject = verify_growth_proposal(raw, pack)
    suggested = None
    if isinstance(raw.get("revenue_growth"), list) and raw["revenue_growth"]:
        try:
            suggested = float(raw["revenue_growth"][0])
        except (TypeError, ValueError):
            suggested = None
    if reject:
        _circuit_success()
        return _evidence_result(
            base,
            configured=True,
            model_name=model_name,
            fallback_reason=reject,
            abstained=reject.startswith("abstain"),
            latency_ms=latency_ms,
            used_cache=used_cache,
            llm_suggested_year1=suggested,
        )

    _circuit_success()
    engine_year1 = base.revenue_growth[0].effective_value if base.revenue_growth else None
    safe_thesis = (
        "LLM narrative only — numeric growth is from the evidence engine, not this text. "
        "Citations of guidance, TAM, industry growth, or management commentary that are not "
        "in the data pack must be read as data unavailable. "
    )
    if suggested is not None and engine_year1 is not None:
        safe_thesis += (
            f"LLM suggested Year-1 {suggested:.1%}; the engine used {engine_year1:.1%}. "
        )
    if thesis:
        safe_thesis += thesis
    annotated = base.model_copy(deep=True)
    for item in annotated.revenue_growth:
        item.rationale = f"{item.rationale} {safe_thesis}".strip()
    return _evidence_result(
        annotated,
        configured=True,
        model_name=model_name,
        thesis=safe_thesis,
        latency_ms=latency_ms,
        used_cache=used_cache,
        llm_suggested_year1=suggested,
        status="llm",
        method="llm",
    )
