from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from ..auth import clear_session_cookie, create_session, hash_password, require_user, set_session_cookie, verify_password
from ..db import get_db
from ..orm import User
from ..schemas import LoginRequest, RegisterRequest, UserOut

router = APIRouter(prefix="/v1/auth", tags=["auth"])


def _normalize_email(email: str) -> str:
    email = email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    return email


def _user_out(user: User) -> dict:
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        first_name=user.first_name,
        last_name=user.last_name,
        designation=user.designation,
    ).model_dump()


@router.post("/register", status_code=201)
def register(body: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    email = _normalize_email(body.email)
    name = body.resolved_name()
    if not name:
        raise HTTPException(status_code=400, detail="Enter your first and last name.")
    if db.query(User).filter(User.email == email).one_or_none():
        raise HTTPException(status_code=409, detail="An account with that email already exists.")
    salt, digest = hash_password(body.password)
    user = User(
        email=email,
        password_salt=salt,
        password_hash=digest,
        display_name=name,
        first_name=body.first_name,
        last_name=body.last_name,
        designation=body.designation,
    )
    db.add(user)
    db.flush()
    raw = create_session(db, user)
    set_session_cookie(response, raw)
    return {"user": _user_out(user)}


@router.post("/login")
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    email = _normalize_email(body.email)
    user = db.query(User).filter(User.email == email).one_or_none()
    if user is None or not verify_password(body.password, user.password_salt, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    raw = create_session(db, user)
    set_session_cookie(response, raw)
    return {"user": _user_out(user)}


@router.post("/logout")
def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)):
    user = require_user(request, db)
    return _user_out(user)
