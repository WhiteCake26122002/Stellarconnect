"""
Shared OpenAI-compatible chat-completion client.

Both `growth_llm.py` (narrative explanation of an already-computed growth path)
and `guidance_llm.py` (grounded extraction of stated management guidance from
pasted source text) need the same HTTP mechanics: call an OpenAI-compatible
/chat/completions endpoint, ask for strict JSON, retry once without the
json_schema constraint if the provider rejects it (some OpenAI-compatible
providers, including free tiers, don't support strict json_schema mode),
and translate transport failures into typed errors so callers can fall back
cleanly instead of guessing.

This client is provider-agnostic on purpose: it works unmodified against
OpenAI, Groq, OpenRouter, or any other OpenAI-compatible /chat/completions
endpoint — including free tiers — by pointing `base_url` and `model` at it.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class LLMClientError(Exception):
    """Provider failed. Caller must fall back; never invent a result."""


class LLMClientTimeout(LLMClientError):
    pass


def parse_llm_json(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMClientError("LLM did not return JSON.") from exc
    if not isinstance(payload, dict):
        raise LLMClientError("LLM JSON was not an object.")
    return payload


def chat_completion_json(
    *,
    api_key: str,
    base_url: str,
    model: str,
    timeout_seconds: float,
    system_prompt: str,
    user_prompt: str,
    schema: dict[str, Any],
    schema_name: str,
    max_tokens: int = 700,
    log_label: str = "llm_complete",
) -> dict[str, Any]:
    """Call an OpenAI-compatible endpoint and return parsed, validated-as-JSON output.

    Does NOT validate the payload against `schema` beyond asking the provider to
    honor it — callers must still verify field-by-field, exactly like the
    existing `verify_growth_proposal()` does. A provider is never trusted just
    because it returned syntactically valid JSON.
    """
    if not api_key:
        raise LLMClientError("LLM is not configured (no API key).")
    url = f"{base_url.rstrip('/')}/chat/completions"
    body: dict[str, Any] = {
        "model": model,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": schema_name, "strict": True, "schema": schema},
        },
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    timeout = httpx.Timeout(timeout_seconds, connect=min(3.0, timeout_seconds))
    started = time.perf_counter()
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=body, headers=headers)
            if response.status_code == 400:
                # Not every OpenAI-compatible provider (including several free
                # tiers) supports strict json_schema mode — retry with the more
                # widely supported plain json_object mode before giving up.
                body["response_format"] = {"type": "json_object"}
                response = client.post(url, json=body, headers=headers)
    except httpx.TimeoutException as exc:
        raise LLMClientTimeout("LLM request timed out.") from exc
    except httpx.HTTPError as exc:
        raise LLMClientError("LLM request failed.") from exc
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    logger.info("%s status=%s model=%s latency_ms=%s", log_label, response.status_code, model, elapsed_ms)
    if response.status_code >= 400:
        raise LLMClientError(f"LLM HTTP {response.status_code}: {response.text[:300]}")
    try:
        payload = response.json()
        text = payload["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise LLMClientError("LLM response was malformed.") from exc
    return parse_llm_json(text or "")
