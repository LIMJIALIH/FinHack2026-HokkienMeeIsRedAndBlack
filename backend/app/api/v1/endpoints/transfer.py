import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.dependencies import get_flow_graph, get_risk_engine, get_warning_store
from app.schemas.transfer import (
    LlmTransferDecisionRequest,
    RiskCheckResult,
    TransferEvaluateRequest,
    TransferEvaluateResponse,
    WarningConfirmRequest,
    WarningConfirmResponse,
)
from app.services.warnings import InMemoryWarningStore, WarningState
from app.services.risk_engine import RiskEngine

router = APIRouter()


def _persist_transfer_or_503(
    risk_engine: RiskEngine,
    payload: TransferEvaluateRequest,
    risk: RiskCheckResult,
) -> str:
    try:
        return risk_engine.persist_transfer(payload, risk)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"transfer_graph_write_failed: {exc}") from exc


def _update_transfer_or_503(
    risk_engine: RiskEngine,
    transaction_id: str,
    status: str,
) -> bool:
    try:
        return risk_engine.update_transfer_status(transaction_id, status)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"transfer_graph_update_failed: {exc}") from exc


def _create_warning_state(
    payload: TransferEvaluateRequest,
    risk: RiskCheckResult,
    transaction_id: str,
    delay_seconds: int,
) -> WarningState:
    return WarningState(
        warning_id=f"warn_{uuid.uuid4().hex[:12]}",
        transaction_id=transaction_id,
        user_id=payload.user_id,
        recipient_id=payload.recipient_id,
        created_at=time.time(),
        decision=risk.decision,
        risk_score=risk.risk_score,
        reason_codes=risk.reason_codes,
        evidence_refs=risk.evidence_refs,
        delay_seconds=delay_seconds,
    )


@router.post("/transfer/llm-decision", response_model=TransferEvaluateResponse)
def transfer_llm_decision(
    request: Request,
    payload: LlmTransferDecisionRequest,
    risk_engine: RiskEngine = Depends(get_risk_engine),
    warning_store: InMemoryWarningStore = Depends(get_warning_store),
) -> TransferEvaluateResponse:
    risk = RiskCheckResult(
        decision=payload.decision,
        risk_score=payload.risk_score,
        reason_codes=payload.reason_codes,
        evidence_refs=payload.evidence_refs,
        latency_ms=0,
    )
    transaction_payload = TransferEvaluateRequest.model_validate(payload.model_dump())
    transaction_id = _persist_transfer_or_503(
        risk_engine=risk_engine,
        payload=transaction_payload,
        risk=risk,
    )

    default_warning_delay_seconds = int(request.app.state.warning_delay_seconds)
    warning_delay_seconds = default_warning_delay_seconds if risk.decision == "WARNING" else 0
    warning_state = _create_warning_state(
        payload=transaction_payload,
        risk=risk,
        transaction_id=transaction_id,
        delay_seconds=warning_delay_seconds,
    )
    warning_store.put(warning_state)

    return TransferEvaluateResponse(
        decision=risk.decision,
        risk_score=risk.risk_score,
        reason_codes=risk.reason_codes,
        evidence_refs=risk.evidence_refs,
        latency_ms=risk.latency_ms,
        warning_id=warning_state.warning_id,
        warning_delay_seconds=warning_delay_seconds,
    )


@router.post("/transfer/evaluate", response_model=TransferEvaluateResponse)
def transfer_evaluate(
    request: Request,
    payload: TransferEvaluateRequest,
    graph: Any = Depends(get_flow_graph),
    risk_engine: RiskEngine = Depends(get_risk_engine),
    warning_store: InMemoryWarningStore = Depends(get_warning_store),
) -> TransferEvaluateResponse:
    output = graph.invoke({"request": payload})
    risk = output["risk"]
    if not isinstance(risk, RiskCheckResult):
        raise HTTPException(status_code=502, detail="invalid_risk_graph_result")

    transaction_id = _persist_transfer_or_503(
        risk_engine=risk_engine,
        payload=payload,
        risk=risk,
    )

    default_warning_delay_seconds = int(request.app.state.warning_delay_seconds)
    warning_delay_seconds = default_warning_delay_seconds if risk.decision == "WARNING" else 0
    warning_state = _create_warning_state(
        payload=payload,
        risk=risk,
        transaction_id=transaction_id,
        delay_seconds=warning_delay_seconds,
    )
    warning_store.put(warning_state)

    return TransferEvaluateResponse(
        decision=risk.decision,
        risk_score=risk.risk_score,
        reason_codes=risk.reason_codes,
        evidence_refs=risk.evidence_refs,
        latency_ms=risk.latency_ms,
        warning_id=warning_state.warning_id,
        warning_delay_seconds=warning_delay_seconds,
    )


@router.post("/transfer/warning/confirm", response_model=WarningConfirmResponse)
def warning_confirm(
    payload: WarningConfirmRequest,
    risk_engine: RiskEngine = Depends(get_risk_engine),
    warning_store: InMemoryWarningStore = Depends(get_warning_store),
) -> WarningConfirmResponse:
    warning = warning_store.get(payload.warning_id)
    if warning is None:
        raise HTTPException(status_code=404, detail="warning_id not found")

    if not payload.confirmed:
        _update_transfer_or_503(
            risk_engine=risk_engine,
            transaction_id=warning.transaction_id,
            status="reversed",
        )
        return WarningConfirmResponse(status="CANCELLED")

    approved, wait_left = warning_store.approve_if_delay_passed(payload.warning_id, time.time())
    if not approved:
        return WarningConfirmResponse(status="PENDING_DELAY", wait_seconds_remaining=wait_left)
    updated = _update_transfer_or_503(
        risk_engine=risk_engine,
        transaction_id=warning.transaction_id,
        status="approved",
    )
    if not updated:
        raise HTTPException(status_code=404, detail="transaction_id not found in graph")
    return WarningConfirmResponse(status="APPROVED_AFTER_WARNING")
