from typing import Any
import json
from threading import Lock

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from transaction_agent import resume_main_hitl, run_main_turn, run_main_turn_stream_events
from app.api.dependencies import get_main_agent
from app.core.auth import get_current_user_id
from app.schemas.voice import VoiceDecisionRequest, VoiceTurnRequest, VoiceTurnResponse

router = APIRouter()


def _require_main_agent(main_agent: Any) -> Any:
    if main_agent is None:
        raise HTTPException(status_code=503, detail="main_agent_unavailable")
    return main_agent


def _normalize_response(raw_payload: dict[str, Any]) -> VoiceTurnResponse:
    result = raw_payload.get("result", {})
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="invalid_main_agent_result")

    mode = result.get("mode")
    assistant_text = result.get("assistant_text")

    if mode not in {"hitl_required", "final"}:
        raise HTTPException(status_code=502, detail="invalid_main_agent_mode")
    if not isinstance(assistant_text, str):
        raise HTTPException(status_code=502, detail="invalid_main_agent_text")

    return VoiceTurnResponse(
        thread_id=raw_payload.get("thread_id", ""),
        mode=mode,
        assistant_text=assistant_text,
        card=result.get("card"),
        transfer=result.get("transfer"),
        backend_status=result.get("backend_status"),
        hitl=raw_payload.get("hitl"),
        steps=result.get("steps", []),
    )


def _sse_event(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _thread_owner_state(request: Request) -> tuple[dict[str, str], Lock]:
    owners = getattr(request.app.state, "voice_thread_owners", None)
    owners_lock = getattr(request.app.state, "voice_thread_owners_lock", None)
    if owners is None:
        owners = {}
        request.app.state.voice_thread_owners = owners
    if owners_lock is None:
        owners_lock = Lock()
        request.app.state.voice_thread_owners_lock = owners_lock
    return owners, owners_lock


def _assert_or_register_thread_owner(request: Request, thread_id: str, user_id: str) -> None:
    owners, owners_lock = _thread_owner_state(request)
    with owners_lock:
        owner = owners.get(thread_id)
        if owner is not None and owner != user_id:
            raise HTTPException(status_code=403, detail="thread_id does not belong to current user")
        if owner is None:
            owners[thread_id] = user_id


@router.post("/voice/turn", response_model=VoiceTurnResponse)
def voice_turn(
    request: Request,
    payload: VoiceTurnRequest,
    main_agent: Any = Depends(get_main_agent),
    authorization: str | None = Header(default=None),
    current_user_id: str = Depends(get_current_user_id),
) -> VoiceTurnResponse:
    agent = _require_main_agent(main_agent)
    if payload.thread_id:
        _assert_or_register_thread_owner(request, payload.thread_id, current_user_id)
    try:
        result = run_main_turn(
            agent=agent,
            text=payload.user_text,
            thread_id=payload.thread_id,
            user_id=current_user_id,
            auth_header=authorization,
            finbert_score=payload.finbert_score,
            finbert_assessment=payload.finbert_assessment,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"voice_turn_failed: {exc}") from exc
    normalized = _normalize_response(result)
    if normalized.thread_id:
        _assert_or_register_thread_owner(request, normalized.thread_id, current_user_id)
    return normalized


@router.post("/voice/turn/stream")
def voice_turn_stream(
    request: Request,
    payload: VoiceTurnRequest,
    main_agent: Any = Depends(get_main_agent),
    authorization: str | None = Header(default=None),
    current_user_id: str = Depends(get_current_user_id),
) -> StreamingResponse:
    agent = _require_main_agent(main_agent)
    if payload.thread_id:
        _assert_or_register_thread_owner(request, payload.thread_id, current_user_id)

    def events():
        try:
            for event in run_main_turn_stream_events(
                agent=agent,
                text=payload.user_text,
                thread_id=payload.thread_id,
                user_id=current_user_id,
                auth_header=authorization,
                finbert_score=payload.finbert_score,
                finbert_assessment=payload.finbert_assessment,
            ):
                if event.get("event") == "final":
                    raw_payload = event.get("payload", {})
                    normalized = _normalize_response(raw_payload)
                    if normalized.thread_id:
                        _assert_or_register_thread_owner(request, normalized.thread_id, current_user_id)
                    yield _sse_event({"event": "final", "payload": normalized.model_dump()})
                else:
                    yield _sse_event(event)
        except Exception as exc:  # noqa: BLE001
            yield _sse_event({"event": "error", "message": f"voice_turn_failed: {exc}"})

    return StreamingResponse(events(), media_type="text/event-stream")


@router.post("/voice/decision", response_model=VoiceTurnResponse)
def voice_decision(
    request: Request,
    payload: VoiceDecisionRequest,
    main_agent: Any = Depends(get_main_agent),
    authorization: str | None = Header(default=None),
    current_user_id: str = Depends(get_current_user_id),
) -> VoiceTurnResponse:
    agent = _require_main_agent(main_agent)
    _assert_or_register_thread_owner(request, payload.thread_id, current_user_id)
    try:
        result = resume_main_hitl(
            agent=agent,
            thread_id=payload.thread_id,
            decision=payload.decision,
            warning_id=payload.warning_id,
            purpose=payload.purpose,
            auth_header=authorization,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"voice_decision_failed: {exc}") from exc
    return _normalize_response(result)
