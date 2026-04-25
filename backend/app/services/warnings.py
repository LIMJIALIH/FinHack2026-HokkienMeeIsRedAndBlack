import time
from dataclasses import dataclass, field
from threading import Lock
from typing import Literal

from app.schemas.transfer import Decision


@dataclass
class WarningState:
    warning_id: str
    transaction_id: str
    user_id: str
    recipient_id: str
    created_at: float
    amount: float
    currency: str
    approved_at: float | None = None
    decision: Decision = "WARNING"
    risk_score: int = 0
    reason_codes: list[str] = field(default_factory=list)
    evidence_refs: list[str] = field(default_factory=list)
    delay_seconds: int = 30
    purpose: str | None = None
    state: Literal["pending", "settling", "approved", "cancelled", "failed"] = "pending"


class InMemoryWarningStore:
    def __init__(self) -> None:
        self._data: dict[str, WarningState] = {}
        self._lock = Lock()

    def put(self, item: WarningState) -> None:
        with self._lock:
            self._data[item.warning_id] = item

    def get(self, warning_id: str) -> WarningState | None:
        with self._lock:
            return self._data.get(warning_id)

    def cancel(self, warning_id: str) -> bool:
        with self._lock:
            state = self._data.get(warning_id)
            if state is None:
                return False
            if state.state in {"approved", "settling"}:
                return False
            state.state = "cancelled"
            return True

    def approval_status(self, warning_id: str, now: float | None = None) -> tuple[bool, int, bool]:
        timestamp = time.time() if now is None else now
        with self._lock:
            state = self._data.get(warning_id)
            if state is None:
                return False, 0, False
            if state.state == "approved":
                return True, 0, True
            if state.state == "cancelled":
                return False, 0, False
            if state.state in {"settling", "failed"}:
                return False, 0, False
            wait_left = max(0, int(state.delay_seconds - (timestamp - state.created_at)))
            if wait_left > 0:
                return False, wait_left, False
            return True, 0, False

    def begin_settlement(self, warning_id: str) -> bool:
        with self._lock:
            state = self._data.get(warning_id)
            if state is None or state.state != "pending":
                return False
            state.state = "settling"
            return True

    def reset_to_pending(self, warning_id: str) -> bool:
        with self._lock:
            state = self._data.get(warning_id)
            if state is None or state.state != "settling":
                return False
            state.state = "pending"
            return True

    def mark_failed(self, warning_id: str) -> bool:
        with self._lock:
            state = self._data.get(warning_id)
            if state is None or state.state == "approved":
                return False
            state.state = "failed"
            return True

    def mark_approved(self, warning_id: str, now: float | None = None, purpose: str | None = None) -> bool:
        timestamp = time.time() if now is None else now
        with self._lock:
            state = self._data.get(warning_id)
            if state is None or state.state in {"cancelled", "failed"}:
                return False
            if purpose is not None:
                state.purpose = purpose
            state.approved_at = timestamp
            state.state = "approved"
            return True

    def approve_if_delay_passed(self, warning_id: str, now: float | None = None) -> tuple[bool, int, bool]:
        approved, wait_left, already_approved = self.approval_status(warning_id, now)
        if approved and not already_approved:
            self.mark_approved(warning_id, now)
        return approved, wait_left, already_approved
