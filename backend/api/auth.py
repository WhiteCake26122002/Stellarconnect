from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from .config import get_settings
from .orm import Session as SessionRow
from .orm import User


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return salt, digest.hex()


def verify_password(password: str, salt: str, expected_hex: str) -> bool:
    _, actual = hash_password(password, salt)
    return hmac.compare_digest(actual, expected_hex)


def hash_token(raw: str) -> str:
    secret = get_settings().session_secret.encode("utf-8")
    return hmac.new(secret, raw.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session(db: Session, user: User) -> str:
    settings = get_settings()
    raw = secrets.token_urlsafe(32)
    row = SessionRow(
        user_id=user.id,
        token_hash=hash_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.session_days),
    )
    db.add(row)
    db.flush()
    return raw


def set_session_cookie(response: Response, raw_token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie,
        value=raw_token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=settings.session_days * 86400,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(settings.session_cookie, path="/")


def user_from_request(request: Request, db: Session) -> User | None:
    settings = get_settings()
    raw = request.cookies.get(settings.session_cookie)
    if not raw:
        return None
    row = db.query(SessionRow).filter(SessionRow.token_hash == hash_token(raw)).one_or_none()
    if row is None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        db.delete(row)
        return None
    return db.query(User).filter(User.id == row.user_id).one_or_none()


def require_user(request: Request, db: Session) -> User:
    user = user_from_request(request, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in required.")
    return user
