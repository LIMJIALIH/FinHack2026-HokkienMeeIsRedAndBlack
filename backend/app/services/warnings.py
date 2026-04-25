import time
from dataclasses import dataclass, field
from threading import Lock

from app.schemas.transfer import Decision


@dataclass
class WarningState:
    warning_id: str
    transaction_id: str
    user_id: str
    recipient_id: str
    created_at: float
    approved_at: float | None = None
    decision: Decision = "WARNING"
    risk_score: int = 0
    reason_codes: list[str] = field(default_factory=list)
    evidence_refs: list[str] = field(default_factory=list)
    delay_seconds: int = 30


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

    def approve_if_delay_passed(self, warning_id: str, now: float | None = None) -> tuple[bool, int]:
        timestamp = time.time() if now is None else now
        with self._lock:
            state = self._data.get(warning_id)
            if state is None:
                return False, 0
            wait_left = max(0, int(state.delay_seconds - (timestamp - state.created_at)))
            if wait_left > 0:
                return False, wait_left
            state.approved_at = timestamp
            return True, 0
