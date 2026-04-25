from typing import Any
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from transaction_agent import resume_main_hitl, run_main_turn, run_main_turn_stream_events
from app.api.dependencies import get_main_agent
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
        backend_status=result.get("backend_status"),
        hitl=raw_payload.get("hitl"),
        steps=result.get("steps", []),
    )


def _sse_event(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/voice/turn", response_model=VoiceTurnResponse)
def voice_turn(payload: VoiceTurnRequest, main_agent: Any = Depends(get_main_agent)) -> VoiceTurnResponse:
    agent = _require_main_agent(main_agent)
    try:
        result = run_main_turn(
            agent=agent,
            text=payload.user_text,
            thread_id=payload.thread_id,
            user_id=payload.user_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"voice_turn_failed: {exc}") from exc
    return _normalize_response(result)


@router.post("/voice/turn/stream")
def voice_turn_stream(payload: VoiceTurnRequest, main_agent: Any = Depends(get_main_agent)) -> StreamingResponse:
    agent = _require_main_agent(main_agent)

    def events():
        try:
            for event in run_main_turn_stream_events(
                agent=agent,
                text=payload.user_text,
                thread_id=payload.thread_id,
                user_id=payload.user_id,
            ):
                if event.get("event") == "final":
                    raw_payload = event.get("payload", {})
                    normalized = _normalize_response(raw_payload)
                    yield _sse_event({"event": "final", "payload": normalized.model_dump()})
                else:
                    yield _sse_event(event)
        except Exception as exc:  # noqa: BLE001
            yield _sse_event({"event": "error", "message": f"voice_turn_failed: {exc}"})

    return StreamingResponse(events(), media_type="text/event-stream")


@router.post("/voice/decision", response_model=VoiceTurnResponse)
def voice_decision(
    payload: VoiceDecisionRequest,
    main_agent: Any = Depends(get_main_agent),
) -> VoiceTurnResponse:
    agent = _require_main_agent(main_agent)
    try:
        result = resume_main_hitl(
            agent=agent,
            thread_id=payload.thread_id,
            decision=payload.decision,
            purpose=payload.purpose,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"voice_decision_failed: {exc}") from exc
    return _normalize_response(result)
