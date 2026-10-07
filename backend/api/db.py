from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from .config import get_settings
from .orm import Base, make_engine, make_session_factory

_engine = None
_SessionLocal = None


def _ensure_user_profile_columns(engine) -> None:
    """Add profile columns on existing SQLite files. create_all will not ALTER."""
    insp = inspect(engine)
    if not insp.has_table("users"):
        return
    existing = {col["name"] for col in insp.get_columns("users")}
    needed = [
        ("first_name", "VARCHAR(80)"),
        ("last_name", "VARCHAR(80)"),
        ("designation", "VARCHAR(40)"),
    ]
    dialect = engine.dialect.name
    with engine.begin() as conn:
        for name, spec in needed:
            if name in existing:
                continue
            if dialect == "sqlite":
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {name} {spec}"))
            else:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {name} {spec}"))


def _ensure_mf_transaction_columns(engine) -> None:
    """Add the redemption-charge columns on existing databases. create_all will not ALTER."""
    insp = inspect(engine)
    if not insp.has_table("mf_transactions"):
        return
    existing = {col["name"] for col in insp.get_columns("mf_transactions")}
    dialect = engine.dialect.name
    with engine.begin() as conn:
        for name in ("exit_load", "stt"):
            if name in existing:
                continue
            if dialect == "sqlite":
                conn.execute(text(f"ALTER TABLE mf_transactions ADD COLUMN {name} FLOAT"))
            else:
                conn.execute(text(f"ALTER TABLE mf_transactions ADD COLUMN IF NOT EXISTS {name} DOUBLE PRECISION"))


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        settings = get_settings()
        _engine = make_engine(settings.database_url)
        Base.metadata.create_all(_engine)
        _ensure_user_profile_columns(_engine)
        _ensure_mf_transaction_columns(_engine)
        _SessionLocal = make_session_factory(_engine)
    return _engine


def reset_engine() -> None:
    """Test helper: drop the cached engine so the next call uses a new DATABASE_URL."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None


def get_db():
    get_engine()
    db: Session = _SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
