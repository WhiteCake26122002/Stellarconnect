from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session

from backend.engine.models import Company, HistoricalFinancials
from backend.engine.forecast import ForecastResult
from backend.engine.historical import HistoricalSummary
from backend.engine.scenarios import ScenarioOutput
from backend.engine.sensitivity import DriverImpact, WaccGrowthTable
from backend.engine.valuation import DCFValuationResult
from backend.engine.validation import IntegrityReport
from backend.engine.wacc import WaccResult
from backend.export.excel_export import export_dcf_to_excel
from backend.export.pdf_report import generate_investment_report

from backend.engine.guidance_llm import GuidanceLLMError, extract_company_guidance
from backend.engine.historicals_extraction_llm import HistoricalsLLMError, extract_historicals_draft

from ..auth import require_user
from ..db import get_db
from ..orm import IdempotencyKey, User, ValuationModel
from ..schemas import (
    CreateModelRequest,
    DriversPatch,
    ExportRequest,
    GuidanceExtractionRequest,
    HistoricalsDraftRequest,
    ModelListItem,
)
from ..valuation_service import (
    Drivers,
    default_drivers,
    get_guidance_provider,
    get_historicals_provider,
    ingest_ticker,
    load_company,
    load_historicals,
    merge_drivers,
    run_model,
    sample_company,
)

router = APIRouter(prefix="/v1/models", tags=["models"])


def _owned(db: Session, user: User, model_id: str) -> ValuationModel:
    row = db.query(ValuationModel).filter(ValuationModel.id == model_id, ValuationModel.user_id == user.id).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Model not found.")
    return row


def _iso(dt) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _list_item(row: ValuationModel) -> dict:
    run = row.run_json or {}
    valuation = run.get("valuation") or {}
    bridge = (valuation or {}).get("equity_bridge") or {}
    integrity = run.get("integrity") or {}
    return ModelListItem(
        id=row.id,
        name=row.name,
        ticker=row.ticker,
        currency=row.currency,
        country=row.country,
        company_type=row.company_type,
        source=row.source,
        updated_at=_iso(row.updated_at),
        implied_share_price=bridge.get("equity_value_per_share"),
        current_share_price=bridge.get("current_share_price"),
        upside=bridge.get("upside_downside"),
        integrity_score=integrity.get("score"),
        integrity_band=integrity.get("band"),
        valuation_error=run.get("valuation_error"),
    ).model_dump()


def _workspace(row: ValuationModel) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "ticker": row.ticker,
        "currency": row.currency,
        "country": row.country,
        "company_type": row.company_type,
        "source": row.source,
        "ingest_notes": row.ingest_notes_json or [],
        "ingest_warnings": row.ingest_warnings_json or [],
        "updated_at": _iso(row.updated_at),
        **(row.run_json or {}),
    }


def _persist_run(row: ValuationModel, company: Company, hist: HistoricalFinancials, drivers: Drivers) -> None:
    row.company_json = company.model_dump()
    row.historicals_json = hist.model_dump()
    row.drivers_json = drivers.model_dump()
    row.run_json = run_model(company, hist, drivers)
    row.name = company.name
    row.ticker = company.ticker
    row.currency = company.currency
    row.country = company.country
    row.company_type = company.company_type.value
    row.updated_at = datetime.now(timezone.utc)


@router.get("")
def list_models(
    request: Request,
    db: Session = Depends(get_db),
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
):
    user = require_user(request, db)
    q = db.query(ValuationModel).filter(ValuationModel.user_id == user.id)
    if cursor:
        q = q.filter(ValuationModel.id < cursor)
    rows = q.order_by(ValuationModel.updated_at.desc(), ValuationModel.id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = rows[-1].id if has_more and rows else None
    return {"items": [_list_item(r) for r in rows], "next_cursor": next_cursor}


@router.post("", status_code=201)
def create_model(
    body: CreateModelRequest,
    request: Request,
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    user = require_user(request, db)
    if idempotency_key:
        existing = (
            db.query(IdempotencyKey)
            .filter(IdempotencyKey.user_id == user.id, IdempotencyKey.key == idempotency_key)
            .one_or_none()
        )
        if existing:
            row = _owned(db, user, existing.model_id)
            return _workspace(row)

    notes: list[str] = []
    warnings: list[str] = []
    try:
        if body.source == "sample":
            company, hist, notes, warnings = sample_company()
        elif body.source == "ticker":
            if not body.ticker:
                raise HTTPException(status_code=400, detail="ticker is required.")
            company, hist, notes, warnings = ingest_ticker(body.ticker)
        else:
            if body.company is None or body.historicals is None:
                raise HTTPException(status_code=400, detail="company and historicals are required for a manual model.")
            company = Company.model_validate(body.company.model_dump())
            hist = HistoricalFinancials.model_validate(body.historicals.model_dump())
            if not hist.income_statements or hist.income_statements[-1].revenue == 0:
                raise HTTPException(status_code=400, detail="Enter a company name and at least one year of non-zero revenue.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    drivers = default_drivers(company, hist)
    if body.drivers:
        drivers = merge_drivers(drivers, body.drivers.model_dump(exclude_unset=True))
    if body.name:
        company.name = body.name

    row = ValuationModel(
        user_id=user.id,
        name=company.name,
        ticker=company.ticker,
        currency=company.currency,
        country=company.country,
        company_type=company.company_type.value,
        source=body.source,
        company_json=company.model_dump(),
        historicals_json=hist.model_dump(),
        drivers_json=drivers.model_dump(),
        ingest_notes_json=notes,
        ingest_warnings_json=warnings,
    )
    _persist_run(row, company, hist, drivers)
    db.add(row)
    db.flush()
    if idempotency_key:
        db.add(IdempotencyKey(user_id=user.id, key=idempotency_key, model_id=row.id))
    return _workspace(row)


@router.post("/historicals-draft")
def draft_historicals(body: HistoricalsDraftRequest, request: Request, db: Session = Depends(get_db)):
    """Extract a draft of income statement / balance sheet / cash flow line items from
    pasted source text (an annual report excerpt, a Screener.in export, a 10-K table),
    each figure backed by a quote verified against that same text (see
    engine/historicals_extraction_llm.py).

    Fallback path for when ticker ingestion fails or a company isn't covered by
    Yahoo/Screener.in. Writes nothing to the database and never touches any existing
    model — it only returns a draft shaped like ManualHistoricalsIn plus the citations,
    for the frontend to pre-fill the manual-entry form. The user must review it (each
    number is shown with its quote) and submit through the normal
    POST /v1/models {source: "manual", ...} flow for it to become a model; nothing here
    is applied automatically.
    """
    user = require_user(request, db)  # login required; no model ownership check needed
    try:
        draft = extract_historicals_draft(
            body.source_text,
            body.company_name or "the company",
            get_historicals_provider(),
        )
    except HistoricalsLLMError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "units": draft.units,
        "notes": draft.notes,
        "has_usable_data": draft.has_usable_data,
        "manual_historicals": draft.to_manual_historicals_draft(),
        "citations": {
            "income_statements": [p.citations for p in draft.income_statements],
            "balance_sheets": [p.citations for p in draft.balance_sheets],
            "cash_flows": [p.citations for p in draft.cash_flows],
        },
        "rejected_fields": {
            "income_statements": [p.rejected_fields for p in draft.income_statements],
            "balance_sheets": [p.rejected_fields for p in draft.balance_sheets],
            "cash_flows": [p.rejected_fields for p in draft.cash_flows],
        },
    }


@router.get("/{model_id}")
def get_model(model_id: str, request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    return _workspace(_owned(db, user, model_id))


@router.post("/{model_id}/ingest")
def refresh_ingest(model_id: str, request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    row = _owned(db, user, model_id)
    if not row.ticker:
        raise HTTPException(status_code=400, detail="This model has no ticker to refresh.")
    try:
        company, hist, notes, warnings = ingest_ticker(row.ticker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    drivers = Drivers.model_validate(row.drivers_json)
    row.ingest_notes_json = notes
    row.ingest_warnings_json = warnings
    row.source = "ticker"
    _persist_run(row, company, hist, drivers)
    return _workspace(row)


@router.patch("/{model_id}/assumptions")
def patch_assumptions(model_id: str, body: DriversPatch, request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    row = _owned(db, user, model_id)
    company = load_company(row.company_json)
    hist = load_historicals(row.historicals_json)
    drivers = merge_drivers(Drivers.model_validate(row.drivers_json), body.model_dump(exclude_unset=True))
    _persist_run(row, company, hist, drivers)
    return _workspace(row)


@router.post("/{model_id}/guidance")
def extract_guidance(model_id: str, body: GuidanceExtractionRequest, request: Request, db: Session = Depends(get_db)):
    """Extract stated management guidance from pasted source text and, only if
    the supporting quote verifies verbatim against that same text, apply the
    revenue-growth figure as Year-1 growth evidence (see engine/guidance_llm.py
    for why this is held to a stricter standard than the narrative LLM path).

    Always returns the extraction result (including quotes and any rejection
    reasons) so the frontend can show the user exactly what was found and why
    a figure was or wasn't applied — nothing here is applied silently.
    """
    user = require_user(request, db)
    row = _owned(db, user, model_id)
    company = load_company(row.company_json)
    hist = load_historicals(row.historicals_json)
    drivers = Drivers.model_validate(row.drivers_json)

    try:
        result = extract_company_guidance(
            body.source_text,
            company.name or body.source_label or "the company",
            get_guidance_provider(),
        )
    except GuidanceLLMError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if result.revenue_growth_verified and result.revenue_growth_pct is not None:
        drivers = merge_drivers(
            drivers,
            {
                "company_guidance_revenue_growth": result.revenue_growth_pct,
                "company_guidance_quote": result.revenue_growth_quote or "",
                "company_guidance_period": result.revenue_growth_period or "",
            },
        )
        _persist_run(row, company, hist, drivers)

    return {
        "extraction": result.model_dump(),
        "applied": bool(result.revenue_growth_verified and result.revenue_growth_pct is not None),
        "workspace": _workspace(row),
    }


@router.delete("/{model_id}/guidance")
def clear_guidance(model_id: str, request: Request, db: Session = Depends(get_db)):
    """Remove applied company guidance and fall back to the statistical/ROIC evidence."""
    user = require_user(request, db)
    row = _owned(db, user, model_id)
    company = load_company(row.company_json)
    hist = load_historicals(row.historicals_json)
    drivers = Drivers.model_validate(row.drivers_json).model_copy(
        update={
            "company_guidance_revenue_growth": None,
            "company_guidance_quote": "",
            "company_guidance_period": "",
        }
    )
    _persist_run(row, company, hist, drivers)
    return _workspace(row)


@router.post("/{model_id}/exports")
def export_model(model_id: str, body: ExportRequest, request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    row = _owned(db, user, model_id)
    run = row.run_json or {}
    if run.get("valuation") is None:
        raise HTTPException(status_code=400, detail=run.get("valuation_error") or "Valuation is not available to export.")

    company = Company.model_validate(run["company"])
    hist = HistoricalFinancials.model_validate(run["historicals"])
    summary = HistoricalSummary.model_validate(run["summary"])
    forecast = ForecastResult.model_validate(run["forecast"])
    wacc_result = WaccResult.model_validate(run["wacc"])
    valuation = DCFValuationResult.model_validate(run["valuation"])
    scenarios = {k: ScenarioOutput.model_validate(v) for k, v in (run.get("scenarios") or {}).items()}
    table = WaccGrowthTable.model_validate(run["sensitivity"])
    ranking = [DriverImpact.model_validate(d) for d in run.get("driver_ranking") or []]
    integrity = IntegrityReport.model_validate({k: v for k, v in (run.get("integrity") or {}).items() if k != "band"})

    suffix = ".xlsx" if body.format == "xlsx" else ".pdf"
    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    stub = (row.ticker or row.name).replace(" ", "_").replace(".", "_")
    if body.format == "xlsx":
        export_dcf_to_excel(
            path,
            company,
            hist,
            summary,
            forecast,
            wacc_result,
            valuation,
            scenarios,
            table,
            ranking,
            integrity,
            ingestion_notes=row.ingest_notes_json,
            ingestion_warnings=row.ingest_warnings_json,
        )
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"{stub}_DCF_Model.xlsx"
    else:
        generate_investment_report(
            path, company, hist, summary, forecast, wacc_result, valuation, scenarios, table, ranking, integrity
        )
        media = "application/pdf"
        filename = f"{stub}_Investment_Report.pdf"

    def _cleanup(p: str) -> None:
        try:
            os.remove(p)
        except OSError:
            pass

    return FileResponse(
        path,
        media_type=media,
        filename=filename,
        background=BackgroundTask(_cleanup, path),
    )
