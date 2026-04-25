"""Backend API client tools for transfer operations.

These are thin HTTP wrappers that call the FastAPI backend.  They are
**not** LangGraph graph tools — the agent's graph tools live in
``graph_tools.py`` and ``agent.py`` (``execute_transfer``).
"""

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _backend_base_url() -> str:
    base = os.getenv("VOICE_AGENT_BACKEND_URL", "http://127.0.0.1:8000")
    return base.rstrip("/")


def _post_json(path: str, payload: dict[str, Any], timeout_seconds: float = 5.0) -> dict[str, Any]:
    url = f"{_backend_base_url()}{path}"
    body = json.dumps(payload).encode("utf-8")
    req = Request(url=url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urlopen(req, timeout=timeout_seconds) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {exc.reason}: {err_body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Connection error to {url}: {exc}") from exc


def submit_llm_transfer_decision_tool(
    user_id: str,
    recipient_id: str,
    amount: float,
    message: str,
    decision: str,
    risk_score: int,
    reason_codes: list[str],
    evidence_refs: list[str],
    currency: str = "MYR",
    channel: str = "voice_agent",
    tx_note: str | None = None,
    recipient_is_new: bool = False,
    tx_time: str | None = None,
    transaction_id: str | None = None,
) -> dict[str, Any]:
    """Persist an LLM fraud decision and create the HITL warning state."""
    payload = {
        "user_id": user_id,
        "recipient_id": recipient_id,
        "amount": amount,
        "currency": currency,
        "channel": channel,
        "message": message,
        "tx_note": tx_note,
        "recipient_is_new": recipient_is_new,
        "tx_time": tx_time,
        "transaction_id": transaction_id,
        "decision": decision,
        "risk_score": risk_score,
        "reason_codes": reason_codes,
        "evidence_refs": evidence_refs,
    }
    return _post_json("/transfer/llm-decision", payload=payload, timeout_seconds=8.0)


def confirm_warning_tool(warning_id: str, confirmed: bool) -> dict[str, Any]:
    """Approve or reject a WARNING/INTERVENTION transfer after user HITL decision."""
    payload = {"warning_id": warning_id, "confirmed": confirmed}
    return _post_json("/transfer/warning/confirm", payload=payload, timeout_seconds=8.0)
