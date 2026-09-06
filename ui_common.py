"""
Shared account/identity plumbing used by every feature mode (Paper Trading,
Mutual Funds, ...). There is exactly one login gate and one Account ID for
the whole app - not one per feature - so entering once unlocks every mode.
"""
from __future__ import annotations

import uuid

import streamlit as st

from backend.trading import store

ACCOUNT_SESSION_KEY = "account_entered"


def resolve_identity() -> tuple[str | None, str | None]:
    """
    Resolves who's using the app right now, in priority order:
    1. Streamlit Cloud's authenticated viewer email. A real login, so it persists across visits
       automatically with no extra code.
    2. A `uid` already sitting in the page's URL (?uid=...), pointing at an existing account.
       This is what survives closing the browser: the URL itself is the "remember me" token, no
       cookie or extra package needed. Set once on account creation/resume (see render_entry_gate).
    3. Nothing yet. The caller shows the entry gate's create/resume flow.

    Ensures the shared `users` table exists first - a session might enter through Mutual Funds (or
    any other future mode) without ever touching Paper Trading, which otherwise owns that table.
    """
    store.init_db()
    user = st.user
    if getattr(user, "is_logged_in", False) and getattr(user, "email", None):
        name = getattr(user, "name", None) or user.email.split("@")[0]
        return user.email, name

    uid = st.query_params.get("uid")
    if uid:
        account = store.get_user(f"guest:{uid}")
        if account:
            return account.user_key, account.display_name
    return None, None


def initials(name: str) -> str:
    parts = [p for p in name.strip().split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def render_entry_gate() -> None:
    """
    New Account / Resume With Account ID UI, shared by every feature mode. On success, sets
    ACCOUNT_SESSION_KEY and reruns - the caller's own gate check picks that up next run.
    """
    user_key, display_name = resolve_identity()
    if user_key is not None:
        st.caption(f"Welcome back, {display_name}.")
        if st.button("Enter", use_container_width=True, type="primary"):
            st.session_state[ACCOUNT_SESSION_KEY] = True
            st.rerun()
        return

    new_tab, resume_tab = st.tabs(["New account", "Resume with Account ID"])
    with new_tab:
        st.text_input("Choose a display name", key="acct_guest_name_input", placeholder="e.g. Rahul")
        st.caption("You will get a unique Account ID to bookmark or save, so closing the browser does not lose your data.")
        if st.button("Create Account & Enter", use_container_width=True, type="primary"):
            name = st.session_state.get("acct_guest_name_input", "").strip()
            if not name:
                st.error("Enter a display name first.")
            else:
                uid = uuid.uuid4().hex[:8]
                store.get_or_create_user(f"guest:{uid}", name)
                st.query_params["uid"] = uid
                st.session_state[ACCOUNT_SESSION_KEY] = True
                st.rerun()
    with resume_tab:
        st.text_input("Your Account ID", key="acct_resume_uid_input", placeholder="e.g. a1b2c3d4")
        if st.button("Resume My Portfolio", use_container_width=True):
            uid = st.session_state.get("acct_resume_uid_input", "").strip().lower()
            account = store.get_user(f"guest:{uid}") if uid else None
            if account is None:
                st.error("No account found with that ID. Double-check it, or create a new account instead.")
            else:
                st.query_params["uid"] = uid
                st.session_state[ACCOUNT_SESSION_KEY] = True
                st.rerun()
