import time

from app.services.warnings import InMemoryWarningStore, WarningState


def _sample_warning(delay_seconds: int = 0) -> WarningState:
    return WarningState(
        warning_id="warn_test",
        transaction_id="tx_test",
        user_id="user:alice",
        recipient_id="user:bob",
        created_at=time.time() - 60,
        amount=10.0,
        currency="MYR",
        delay_seconds=delay_seconds,
    )


def test_approve_is_idempotent() -> None:
    store = InMemoryWarningStore()
    item = _sample_warning(delay_seconds=0)
    store.put(item)

    approved, wait_left, already_approved = store.approval_status(item.warning_id)
    assert approved is True
    assert wait_left == 0
    assert already_approved is False
    assert store.get(item.warning_id).state == "pending"

    assert store.begin_settlement(item.warning_id) is True
    assert store.mark_approved(item.warning_id) is True

    approved_again, wait_left_again, already_approved_again = store.approval_status(item.warning_id)
    assert approved_again is True
    assert wait_left_again == 0
    assert already_approved_again is True


def test_cancel_prevents_future_approval() -> None:
    store = InMemoryWarningStore()
    item = _sample_warning(delay_seconds=0)
    store.put(item)

    assert store.cancel(item.warning_id) is True

    approved, wait_left, already_approved = store.approval_status(item.warning_id)
    assert approved is False
    assert wait_left == 0
    assert already_approved is False


def test_settling_warning_cannot_be_cancelled() -> None:
    store = InMemoryWarningStore()
    item = _sample_warning(delay_seconds=0)
    store.put(item)

    assert store.begin_settlement(item.warning_id) is True
    assert store.cancel(item.warning_id) is False
    assert store.get(item.warning_id).state == "settling"
