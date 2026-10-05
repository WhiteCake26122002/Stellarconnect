from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import uuid


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"code": _code_for_status(exc.status_code), "message": _message(exc.detail), "request_id": request_id},
            )
        response.headers["x-request-id"] = request_id
        return response


def _message(detail) -> str:
    if isinstance(detail, str):
        return detail
    return "Request failed."


def _code_for_status(status_code: int) -> str:
    return {
        400: "validation_error",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        422: "validation_error",
    }.get(status_code, "error")


def error_body(code: str, message: str, request_id: str | None = None) -> dict:
    return {"code": code, "message": message, "request_id": request_id or ""}
