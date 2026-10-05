from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .config import get_settings
from .db import get_engine
from .errors import error_body
from .routers import auth, companies, funds, market, models


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Connect", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def _startup():
        get_engine()

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.exception_handler(HTTPException)
    async def http_exc(request: Request, exc: HTTPException):
        request_id = getattr(request.state, "request_id", "")
        code = {
            400: "validation_error",
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            409: "conflict",
        }.get(exc.status_code, "error")
        detail = str(exc.detail)
        if exc.status_code == 400 and "WACC" in detail:
            code = "wacc_not_above_growth"
        if exc.status_code == 400 and (
            "Yahoo" in detail or "financial institution" in detail or "was not found" in detail
        ):
            code = "ingest_failed"
        return JSONResponse(status_code=exc.status_code, content=error_body(code, detail, request_id))

    @app.exception_handler(ValidationError)
    async def pydantic_exc(request: Request, exc: ValidationError):
        return JSONResponse(
            status_code=400,
            content=error_body(
                "validation_error",
                exc.errors()[0].get("msg", "Invalid payload"),
                getattr(request.state, "request_id", ""),
            ),
        )

    app.include_router(auth.router)
    app.include_router(companies.router)
    app.include_router(funds.router)
    app.include_router(market.router)
    app.include_router(models.router)
    return app


app = create_app()
