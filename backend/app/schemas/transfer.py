from typing import Literal

from pydantic import BaseModel, Field


Decision = Literal["APPROVED", "WARNING", "INTERVENTION_REQUIRED"]


class TransferEvaluateRequest(BaseModel):
    user_id: str = Field(min_length=1)
    recipient_id: str = Field(min_length=1)
    amount: float = Field(gt=0)
    message: str = Field(default="", max_length=1000)
    recipient_is_new: bool = False
    device_id: str | None = None
    ip_hash: str | None = None
    transaction_context_hash: str | None = None


class RiskCheckResult(BaseModel):
    decision: Decision
    risk_score: int
    reason_codes: list[str]
    evidence_refs: list[str]
    latency_ms: int


class TransferEvaluateResponse(BaseModel):
    decision: Decision
    risk_score: int
    reason_codes: list[str]
    evidence_refs: list[str]
    latency_ms: int
    warning_id: str | None = None
    warning_delay_seconds: int | None = None


class WarningConfirmRequest(BaseModel):
    warning_id: str = Field(min_length=1)
    confirmed: bool


class WarningConfirmResponse(BaseModel):
    status: Literal["CANCELLED", "PENDING_DELAY", "APPROVED_AFTER_WARNING"]
    wait_seconds_remaining: int | None = None

