from __future__ import annotations

from pathlib import Path

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, create_engine, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .ids import new_id


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("usr"))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_salt: Mapped[str] = mapped_column(String(64))
    password_hash: Mapped[str] = mapped_column(String(128))
    display_name: Mapped[str] = mapped_column(String(120))
    first_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    designation: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())

    models: Mapped[list["ValuationModel"]] = relationship(back_populates="user")
    sessions: Mapped[list["Session"]] = relationship(back_populates="user")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("ses"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[object] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="sessions")


class ValuationModel(Base):
    __tablename__ = "models"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("mod"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    ticker: Mapped[str | None] = mapped_column(String(32), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    country: Mapped[str] = mapped_column(String(80), default="")
    company_type: Mapped[str] = mapped_column(String(16), default="public")
    source: Mapped[str] = mapped_column(String(16), default="ticker")
    company_json: Mapped[dict] = mapped_column(JSON)
    historicals_json: Mapped[dict] = mapped_column(JSON)
    drivers_json: Mapped[dict] = mapped_column(JSON)
    run_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ingest_notes_json: Mapped[list] = mapped_column(JSON, default=list)
    ingest_warnings_json: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user: Mapped[User] = relationship(back_populates="models")


class MfHolding(Base):
    """One mutual-fund line on a Connect account. Top-ups blend into the same scheme."""

    __tablename__ = "mf_holdings"
    __table_args__ = (UniqueConstraint("user_id", "scheme_code", name="uq_mf_user_scheme"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("mfh"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    scheme_code: Mapped[int] = mapped_column(Integer)
    scheme_name: Mapped[str] = mapped_column(String(300))
    units: Mapped[float] = mapped_column(Float)
    avg_nav: Mapped[float] = mapped_column(Float)
    purchase_date: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_idempotency_user_key"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("idm"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    key: Mapped[str] = mapped_column(String(128))
    model_id: Mapped[str] = mapped_column(ForeignKey("models.id"))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())


def make_engine(url: str, *, echo: bool = False):
    connect_args = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        if ":///" in url and ":memory:" not in url:
            raw = url.split("sqlite:///")[-1]
            path = Path(raw)
            if path.parent and str(path.parent) not in {".", ""}:
                path.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(url, echo=echo, future=True, connect_args=connect_args)


def make_session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
