import time
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks
from fastapi import HTTPException

from app.api.v1.endpoints.transfer import transfer_llm_decision, warning_confirm
from app.schemas.transfer import LlmTransferDecisionRequest, WarningConfirmRequest
from app.services.wallet_ledger import InsufficientBalanceError, WalletSettlementResult
from app.services.warnings import InMemoryWarningStore, WarningState


class FakeRiskEngine:
    def __init__(
        self,
        *,
        persist_error: Exception | None = None,
        update_result: bool = True,
        events: list[str] | None = None,
    ) -> None:
        self.calls: list[str] = []
        self.persist_error = persist_error
        self.update_result = update_result
        self.events = events

    def persist_transfer(self, payload, result, *, requires_hitl=None, status_override=None):
        self.calls.append(f"persist:{status_override}:{requires_hitl}")
        if self.events is not None:
            self.events.append("persist")
        if self.persist_error:
            raise self.persist_error
        return "tx_test"

    def update_transfer_status(self, transaction_id: str, status: str) -> bool:
        self.calls.append(f"update:{transaction_id}:{status}")
        if self.events is not None:
            self.events.append(f"update:{status}")
        return self.update_result


class FakeWalletLedger:
    def __init__(self, *, settle_error: Exception | None = None, events: list[str] | None = None) -> None:
        self.calls: list[str] = []
        self.settle_error = settle_error
        self.events = events

    def settle_transfer(
        self,
        sender_user_id: str,
        recipient_user_id: str,
        amount: float,
        transaction_id: str | None = None,
    ):
        self.calls.append(f"settle:{sender_user_id}:{recipient_user_id}:{amount}:{transaction_id}")
        if self.events is not None:
            self.events.append("settle")
        if self.settle_error:
            raise self.settle_error
        return WalletSettlementResult(sender_balance=90.0, recipient_balance=10.0)


def _request(delay_seconds: int = 30):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(warning_delay_seconds=delay_seconds)))


def _llm_payload(hitl_already_confirmed: bool) -> LlmTransferDecisionRequest:
    return LlmTransferDecisionRequest(
        user_id="client_supplied_user",
        recipient_id="user:bob",
        amount=10.0,
        message="dinner",
        decision="APPROVED",
        risk_score=10,
        hitl_already_confirmed=hitl_already_confirmed,
    )


def _warning_store() -> InMemoryWarningStore:
    store = InMemoryWarningStore()
    store.put(
        WarningState(
            warning_id="warn_test",
            transaction_id="tx_test",
            user_id="user:alice",
            recipient_id="user:bob",
            created_at=time.time() - 60,
            amount=10.0,
            currency="MYR",
            delay_seconds=0,
        )
    )
    return store


def test_llm_confirmed_transfer_persists_before_wallet_settlement() -> None:
    events: list[str] = []
    risk_engine = FakeRiskEngine(events=events)
    wallet = FakeWalletLedger(events=events)

    response = transfer_llm_decision(
        request=_request(),
        payload=_llm_payload(hitl_already_confirmed=True),
        background_tasks=BackgroundTasks(),
        risk_engine=risk_engine,
        warning_store=InMemoryWarningStore(),
        wallet_ledger=wallet,
        current_user_id="user:alice",
    )

    assert response.transaction_id == "tx_test"
    assert response.sender_balance == 90.0
    assert events == ["persist", "settle", "update:approved"]
    assert risk_engine.calls == [
        "persist:settlement_pending:False",
        "update:tx_test:approved",
    ]
    assert wallet.calls == ["settle:user:alice:user:bob:10.0:tx_test"]


def test_llm_confirmed_transfer_does_not_settle_when_persist_fails() -> None:
    risk_engine = FakeRiskEngine(persist_error=RuntimeError("graph down"))
    wallet = FakeWalletLedger()

    with pytest.raises(HTTPException) as exc_info:
        transfer_llm_decision(
            request=_request(),
            payload=_llm_payload(hitl_already_confirmed=True),
            background_tasks=BackgroundTasks(),
            risk_engine=risk_engine,
            warning_store=InMemoryWarningStore(),
            wallet_ledger=wallet,
            current_user_id="user:alice",
        )

    assert exc_info.value.status_code == 503
    assert wallet.calls == []


def test_llm_confirmed_transfer_insufficient_balance_returns_409() -> None:
    risk_engine = FakeRiskEngine()
    wallet = FakeWalletLedger(
        settle_error=InsufficientBalanceError("user:alice", current_balance=1.0, required_amount=10.0)
    )

    with pytest.raises(HTTPException) as exc_info:
        transfer_llm_decision(
            request=_request(),
            payload=_llm_payload(hitl_already_confirmed=True),
            background_tasks=BackgroundTasks(),
            risk_engine=risk_engine,
            warning_store=InMemoryWarningStore(),
            wallet_ledger=wallet,
            current_user_id="user:alice",
        )

    assert exc_info.value.status_code == 409
    assert "insufficient_balance:user:alice" in str(exc_info.value.detail)
    assert risk_engine.calls == [
        "persist:settlement_pending:False",
        "update:tx_test:settlement_failed",
    ]


def test_warning_confirm_settlement_failure_does_not_mark_approved() -> None:
    store = _warning_store()
    wallet = FakeWalletLedger(
        settle_error=InsufficientBalanceError("user:alice", current_balance=1.0, required_amount=10.0)
    )

    with pytest.raises(HTTPException) as exc_info:
        warning_confirm(
            payload=WarningConfirmRequest(warning_id="warn_test", confirmed=True),
            background_tasks=BackgroundTasks(),
            risk_engine=FakeRiskEngine(),
            warning_store=store,
            wallet_ledger=wallet,
            current_user_id="user:alice",
        )

    assert exc_info.value.status_code == 409
    assert store.get("warn_test").state == "pending"


def test_warning_confirm_graph_update_failure_marks_failed_after_settlement() -> None:
    store = _warning_store()

    with pytest.raises(HTTPException) as exc_info:
        warning_confirm(
            payload=WarningConfirmRequest(warning_id="warn_test", confirmed=True),
            background_tasks=BackgroundTasks(),
            risk_engine=FakeRiskEngine(update_result=False),
            warning_store=store,
            wallet_ledger=FakeWalletLedger(),
            current_user_id="user:alice",
        )

    assert exc_info.value.status_code == 503
    assert store.get("warn_test").state == "failed"
