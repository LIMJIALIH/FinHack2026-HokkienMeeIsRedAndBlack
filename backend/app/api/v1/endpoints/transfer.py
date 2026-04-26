import time
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

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
from app.services.transfer_summary import update_transfer_participant_summaries

router = APIRouter()


def _persist_transfer_or_503(
    risk_engine: RiskEngine,
    payload: TransferEvaluateRequest,
    risk: RiskCheckResult,
    *,
    requires_hitl: bool | None = None,
    status_override: str | None = None,
) -> str:
    try:
        return risk_engine.persist_transfer(
            payload,
            risk,
            requires_hitl=requires_hitl,
            status_override=status_override,
        )
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
    transaction_id: str | None = None,
) -> WalletSettlementResult:
    try:
        return wallet_ledger.settle_transfer(
            sender_user_id=sender_user_id,
            recipient_user_id=recipient_user_id,
            amount=amount,
            transaction_id=transaction_id,
        )
    except UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InsufficientBalanceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except WalletSettlementError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"wallet_settlement_failed: {exc}") from exc


def _update_transfer_best_effort(
    risk_engine: RiskEngine,
    transaction_id: str,
    status: str,
) -> None:
    try:
        risk_engine.update_transfer_status(transaction_id, status)
    except Exception:  # noqa: BLE001
        pass


def _settle_persisted_transfer_or_4xx(
    *,
    risk_engine: RiskEngine,
    wallet_ledger: WalletLedger,
    transaction_id: str,
    sender_user_id: str,
    recipient_user_id: str,
    amount: float,
) -> WalletSettlementResult:
    try:
        settlement = _settle_wallet_or_4xx(
            wallet_ledger=wallet_ledger,
            sender_user_id=sender_user_id,
            recipient_user_id=recipient_user_id,
            amount=amount,
            transaction_id=transaction_id,
        )
    except HTTPException:
        _update_transfer_best_effort(risk_engine, transaction_id, "settlement_failed")
        raise

    updated = _update_transfer_or_503(
        risk_engine=risk_engine,
        transaction_id=transaction_id,
        status="approved",
    )
    if not updated:
        raise HTTPException(status_code=503, detail="transfer_graph_update_missing_after_settlement")
    return settlement


def _schedule_summary_update(
    background_tasks: BackgroundTasks | None,
    transaction_id: str,
) -> None:
    if background_tasks is None:
        return
    background_tasks.add_task(update_transfer_participant_summaries, transaction_id)


@router.post("/transfer/llm-decision", response_model=TransferEvaluateResponse)
def transfer_llm_decision(
    request: Request,
    payload: LlmTransferDecisionRequest,
    background_tasks: BackgroundTasks,
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

    transaction_id = _persist_transfer_or_503(
        risk_engine=risk_engine,
        payload=transaction_payload,
        risk=risk,
        requires_hitl=requires_hitl,
        status_override="pending_hitl" if requires_hitl else "settlement_pending",
    )

    if not requires_hitl:
        settlement = _settle_persisted_transfer_or_4xx(
            risk_engine=risk_engine,
            wallet_ledger=wallet_ledger,
            transaction_id=transaction_id,
            sender_user_id=transaction_payload.user_id,
            recipient_user_id=transaction_payload.recipient_id,
            amount=transaction_payload.amount,
        )
        _schedule_summary_update(background_tasks, transaction_id)
        return TransferEvaluateResponse(
            transaction_id=transaction_id,
            decision=risk.decision,
            risk_score=risk.risk_score,
            reason_codes=risk.reason_codes,
            evidence_refs=risk.evidence_refs,
            latency_ms=risk.latency_ms,
            warning_id=None,
            warning_delay_seconds=0,
            sender_balance=settlement.sender_balance,
            recipient_balance=settlement.recipient_balance,
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
        transaction_id=transaction_id,
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
    background_tasks: BackgroundTasks,
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

    transaction_id = _persist_transfer_or_503(
        risk_engine=risk_engine,
        payload=payload,
        risk=risk,
        requires_hitl=requires_hitl,
        status_override="pending_hitl" if requires_hitl else "settlement_pending",
    )

    settlement: WalletSettlementResult | None = None
    if not requires_hitl:
        settlement = _settle_persisted_transfer_or_4xx(
            risk_engine=risk_engine,
            wallet_ledger=wallet_ledger,
            transaction_id=transaction_id,
            sender_user_id=payload.user_id,
            recipient_user_id=payload.recipient_id,
            amount=payload.amount,
        )
        _schedule_summary_update(background_tasks, transaction_id)

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
        transaction_id=transaction_id,
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
    background_tasks: BackgroundTasks,
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
    if warning.state == "settling":
        raise HTTPException(status_code=409, detail="warning_settlement_in_progress")
    if warning.state == "failed":
        raise HTTPException(status_code=409, detail="warning_settlement_failed")

    if not payload.confirmed:
        cancelled_now = warning_store.cancel(payload.warning_id)
        if cancelled_now:
            _update_transfer_or_503(
                risk_engine=risk_engine,
                transaction_id=warning.transaction_id,
                status="cancelled",
            )
        return WarningConfirmResponse(status="CANCELLED")

    approved, wait_left, already_approved = warning_store.approval_status(payload.warning_id, time.time())
    if already_approved:
        return WarningConfirmResponse(status="APPROVED_AFTER_WARNING")
    if not approved:
        return WarningConfirmResponse(status="PENDING_DELAY", wait_seconds_remaining=wait_left)

    if not warning_store.begin_settlement(payload.warning_id):
        raise HTTPException(status_code=409, detail="warning_state_changed")

    try:
        settlement = _settle_wallet_or_4xx(
            wallet_ledger=wallet_ledger,
            sender_user_id=warning.user_id,
            recipient_user_id=warning.recipient_id,
            amount=warning.amount,
            transaction_id=warning.transaction_id,
        )
    except HTTPException:
        warning_store.reset_to_pending(payload.warning_id)
        raise

    try:
        updated = _update_transfer_or_503(
            risk_engine=risk_engine,
            transaction_id=warning.transaction_id,
            status="approved",
        )
    except HTTPException:
        warning_store.mark_failed(payload.warning_id)
        raise
    if not updated:
        warning_store.mark_failed(payload.warning_id)
        raise HTTPException(status_code=503, detail="transfer_graph_update_missing_after_settlement")

    warning_store.mark_approved(payload.warning_id, purpose=payload.purpose)
    _schedule_summary_update(background_tasks, warning.transaction_id)
    return WarningConfirmResponse(
        status="APPROVED_AFTER_WARNING",
        sender_balance=settlement.sender_balance,
        recipient_balance=settlement.recipient_balance,
    )
