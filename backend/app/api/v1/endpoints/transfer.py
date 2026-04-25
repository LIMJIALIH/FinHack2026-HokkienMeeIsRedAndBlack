import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.dependencies import get_flow_graph, get_warning_store
from app.schemas.transfer import (
    RiskCheckResult,
    TransferEvaluateRequest,
    TransferEvaluateResponse,
    WarningConfirmRequest,
    WarningConfirmResponse,
)
from app.services.warnings import InMemoryWarningStore, WarningState

router = APIRouter()


@router.post("/transfer/evaluate", response_model=TransferEvaluateResponse)
def transfer_evaluate(
    request: Request,
    payload: TransferEvaluateRequest,
    graph: Any = Depends(get_flow_graph),
    warning_store: InMemoryWarningStore = Depends(get_warning_store),
) -> TransferEvaluateResponse:
    warning_delay_seconds = request.app.state.warning_delay_seconds
    output = graph.invoke({"request": payload})
    risk: RiskCheckResult = output["risk"]
    if risk.decision == "WARNING":
        warning_id = f"warn_{uuid.uuid4().hex[:12]}"
        warning_store.put(
            WarningState(
                warning_id=warning_id,
                created_at=time.time(),
                risk_score=risk.risk_score,
                reason_codes=risk.reason_codes,
                evidence_refs=risk.evidence_refs,
                delay_seconds=warning_delay_seconds,
            )
        )
        return TransferEvaluateResponse(
            decision="WARNING",
            risk_score=risk.risk_score,
            reason_codes=risk.reason_codes,
            evidence_refs=risk.evidence_refs,
            latency_ms=risk.latency_ms,
            warning_id=warning_id,
            warning_delay_seconds=warning_delay_seconds,
        )
    return TransferEvaluateResponse(
        decision=risk.decision,
        risk_score=risk.risk_score,
        reason_codes=risk.reason_codes,
        evidence_refs=risk.evidence_refs,
        latency_ms=risk.latency_ms,
    )


@router.post("/transfer/warning/confirm", response_model=WarningConfirmResponse)
def warning_confirm(
    payload: WarningConfirmRequest,
    warning_store: InMemoryWarningStore = Depends(get_warning_store),
) -> WarningConfirmResponse:
    warning = warning_store.get(payload.warning_id)
    if warning is None:
        raise HTTPException(status_code=404, detail="warning_id not found")

    if not payload.confirmed:
        return WarningConfirmResponse(status="CANCELLED")

    approved, wait_left = warning_store.approve_if_delay_passed(payload.warning_id, time.time())
    if not approved:
        return WarningConfirmResponse(status="PENDING_DELAY", wait_seconds_remaining=wait_left)
    return WarningConfirmResponse(status="APPROVED_AFTER_WARNING")
