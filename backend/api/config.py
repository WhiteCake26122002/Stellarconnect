from __future__ import annotations

import os
from functools import lru_cache

from pydantic import BaseModel, Field


class Settings(BaseModel):
    database_url: str = Field(
        default="sqlite:///./backend/data/app.db",
        description="SQLAlchemy URL. Postgres in production; SQLite allowed for local/dev tests.",
    )
    session_secret: str = "dev-only-change-me"
    session_cookie: str = "dcf_session"
    session_days: int = 14
    cors_origins: str = "http://localhost:3000"
    cookie_secure: bool = False
    growth_llm_api_key: str = ""
    growth_llm_base_url: str = "https://api.openai.com/v1"
    growth_llm_model: str = "gpt-4o-mini"
    growth_llm_timeout_seconds: float = 8.0
    growth_llm_enabled: bool = True
    # Guidance extraction reuses the growth_llm_* api_key/base_url/model/enabled
    # settings (same provider account) but gets its own timeout, since it reads
    # a whole pasted document rather than a small structured feature pack.
    guidance_llm_timeout_seconds: float = 15.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


def normalize_database_url(url: str) -> str:
    """Hosted Postgres (Neon, Render, Heroku) hands out postgres:// or postgresql:// URLs; this app ships the psycopg 3
    driver, so name it explicitly. SQLite and URLs that already name a driver pass through unchanged."""
    url = url.strip()
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@lru_cache
def get_settings() -> Settings:
    return Settings(
        database_url=normalize_database_url(os.environ.get("DATABASE_URL", Settings().database_url)),
        session_secret=os.environ.get("SESSION_SECRET", Settings().session_secret),
        session_cookie=os.environ.get("SESSION_COOKIE", Settings().session_cookie),
        session_days=int(os.environ.get("SESSION_DAYS", "14")),
        cors_origins=os.environ.get("CORS_ORIGINS", Settings().cors_origins),
        cookie_secure=os.environ.get("COOKIE_SECURE", "").lower() in {"1", "true", "yes"},
        growth_llm_api_key=os.environ.get("GROWTH_LLM_API_KEY", ""),
        growth_llm_base_url=os.environ.get("GROWTH_LLM_BASE_URL", Settings().growth_llm_base_url),
        growth_llm_model=os.environ.get("GROWTH_LLM_MODEL", Settings().growth_llm_model),
        growth_llm_timeout_seconds=float(os.environ.get("GROWTH_LLM_TIMEOUT_SECONDS", "8")),
        growth_llm_enabled=os.environ.get("GROWTH_LLM_ENABLED", "true").lower() in {"1", "true", "yes"},
        guidance_llm_timeout_seconds=float(os.environ.get("GUIDANCE_LLM_TIMEOUT_SECONDS", "15")),
    )
