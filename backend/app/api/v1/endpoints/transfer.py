import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.dependencies import get_flow_graph, get_risk_engine, get_wallet_ledger, get_warning_store
from app.core.auth import get_current_user_id
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
from app.services.wallet_ledger import (
    InsufficientBalanceError,
    UserNotFoundError,
    WalletLedger,
    WalletSettlementError,
    WalletSettlementResult,
)

router = APIRouter()


def _persist_transfer_or_503(
    risk_engine: RiskEngine,
    payload: TransferEvaluateRequest,
    risk: RiskCheckResult,
    *,
    requires_hitl: bool | None = None,
) -> str:
    try:
        return risk_engine.persist_transfer(payload, risk, requires_hitl=requires_hitl)
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
        amount=payload.amount,
        currency=payload.currency,
        created_at=time.time(),
        decision=risk.decision,
        risk_score=risk.risk_score,
        reason_codes=risk.reason_codes,
        evidence_refs=risk.evidence_refs,
        delay_seconds=delay_seconds,
    )


def _bind_request_user(payload: TransferEvaluateRequest, user_id: str) -> TransferEvaluateRequest:
    return payload.model_copy(update={"user_id": user_id})


def _settle_wallet_or_4xx(
    wallet_ledger: WalletLedger,
    sender_user_id: str,
    recipient_user_id: str,
    amount: float,
) -> WalletSettlementResult:
    try:
        return wallet_ledger.settle_transfer(
            sender_user_id=sender_user_id,
            recipient_user_id=recipient_user_id,
            amount=amount,
        )
    except UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InsufficientBalanceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except WalletSettlementError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"wallet_settlement_failed: {exc}") from exc


@router.post("/transfer/llm-decision", response_model=TransferEvaluateResponse)
def transfer_llm_decision(
    request: Request,
    payload: LlmTransferDecisionRequest,
    risk_engine: RiskEngine = Depends(get_risk_engine),
    warning_store: InMemoryWarningStore = Depends(get_warning_store),
    wallet_ledger: WalletLedger = Depends(get_wallet_ledger),
    current_user_id: str = Depends(get_current_user_id),
) -> TransferEvaluateResponse:
    payload = _bind_request_user(payload, current_user_id)
    risk = RiskCheckResult(
        decision=payload.decision,
        risk_score=payload.risk_score,
        reason_codes=payload.reason_codes,
        evidence_refs=payload.evidence_refs,
        latency_ms=0,
    )
    transaction_payload = TransferEvaluateRequest.model_validate(payload.model_dump())
    requires_hitl = not payload.hitl_already_confirmed
    settlement: WalletSettlementResult | None = None

    if not requires_hitl:
        settlement = _settle_wallet_or_4xx(
            wallet_ledger=wallet_ledger,
            sender_user_id=transaction_payload.user_id,
            recipient_user_id=transaction_payload.recipient_id,
            amount=transaction_payload.amount,
        )

    transaction_id = _persist_transfer_or_503(
        risk_engine=risk_engine,
        payload=transaction_payload,
        risk=risk,
        requires_hitl=requires_hitl,
    )

    if not requires_hitl:
        return TransferEvaluateResponse(
            decision=risk.decision,
            risk_score=risk.risk_score,
            reason_codes=risk.reason_codes,
            evidence_refs=risk.evidence_refs,
            latency_ms=risk.latency_ms,
            warning_id=None,
            warning_delay_seconds=0,
            sender_balance=settlement.sender_balance if settlement else None,
            recipient_balance=settlement.recipient_balance if settlement else None,
        )

    default_warning_delay_seconds = int(request.app.state.warning_delay_seconds)
    if risk.decision == "WARNING":
        warning_delay_seconds = default_warning_delay_seconds
    elif risk.decision == "INTERVENTION_REQUIRED":
        warning_delay_seconds = 0
    else:
        # APPROVED — no delay needed but still create a tracking record.
        warning_delay_seconds = 0

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
        sender_balance=None,
        recipient_balance=None,
    )


@router.post("/transfer/evaluate", response_model=TransferEvaluateResponse)
def transfer_evaluate(
    request: Request,
    payload: TransferEvaluateRequest,
    graph: Any = Depends(get_flow_graph),
    risk_engine: RiskEngine = Depends(get_risk_engine),
    warning_store: InMemoryWarningStore = Depends(get_warning_store),
    wallet_ledger: WalletLedger = Depends(get_wallet_ledger),
    current_user_id: str = Depends(get_current_user_id),
) -> TransferEvaluateResponse:
    payload = _bind_request_user(payload, current_user_id)
    output = graph.invoke({"request": payload})
    risk = output["risk"]
    if not isinstance(risk, RiskCheckResult):
        raise HTTPException(status_code=502, detail="invalid_risk_graph_result")

    requires_hitl = risk.decision != "APPROVED"
    settlement: WalletSettlementResult | None = None
    if not requires_hitl:
        settlement = _settle_wallet_or_4xx(
            wallet_ledger=wallet_ledger,
            sender_user_id=payload.user_id,
            recipient_user_id=payload.recipient_id,
            amount=payload.amount,
        )

    transaction_id = _persist_transfer_or_503(
        risk_engine=risk_engine,
        payload=payload,
        risk=risk,
        requires_hitl=requires_hitl,
    )

    warning_state: WarningState | None = None
    warning_delay_seconds: int | None = None
    if risk.decision != "APPROVED":
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
        warning_id=warning_state.warning_id if warning_state else None,
        warning_delay_seconds=warning_delay_seconds,
        sender_balance=settlement.sender_balance if settlement else None,
        recipient_balance=settlement.recipient_balance if settlement else None,
    )


@router.post("/transfer/warning/confirm", response_model=WarningConfirmResponse)
def warning_confirm(
    payload: WarningConfirmRequest,
    risk_engine: RiskEngine = Depends(get_risk_engine),
    warning_store: InMemoryWarningStore = Depends(get_warning_store),
    wallet_ledger: WalletLedger = Depends(get_wallet_ledger),
    current_user_id: str = Depends(get_current_user_id),
) -> WarningConfirmResponse:
    warning = warning_store.get(payload.warning_id)
    if warning is None:
        raise HTTPException(status_code=404, detail="warning_id not found")
    if warning.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="warning_id does not belong to current user")

    if warning.state == "approved":
        return WarningConfirmResponse(status="APPROVED_AFTER_WARNING")
    if warning.state == "cancelled":
        return WarningConfirmResponse(status="CANCELLED")

    if not payload.confirmed:
        cancelled_now = warning_store.cancel(payload.warning_id)
        if cancelled_now:
            _update_transfer_or_503(
                risk_engine=risk_engine,
                transaction_id=warning.transaction_id,
                status="reversed",
            )
        return WarningConfirmResponse(status="CANCELLED")

    approved, wait_left, already_approved = warning_store.approve_if_delay_passed(payload.warning_id, time.time())
    if already_approved:
        return WarningConfirmResponse(status="APPROVED_AFTER_WARNING")
    if not approved:
        return WarningConfirmResponse(status="PENDING_DELAY", wait_seconds_remaining=wait_left)

    _settle_wallet_or_4xx(
        wallet_ledger=wallet_ledger,
        sender_user_id=warning.user_id,
        recipient_user_id=warning.recipient_id,
        amount=warning.amount,
    )

    updated = _update_transfer_or_503(
        risk_engine=risk_engine,
        transaction_id=warning.transaction_id,
        status="approved",
    )
    if not updated:
        raise HTTPException(status_code=404, detail="transaction_id not found in graph")
    return WarningConfirmResponse(status="APPROVED_AFTER_WARNING")
