from typing import Literal

from pydantic import BaseModel, Field


Decision = Literal["APPROVED", "WARNING", "INTERVENTION_REQUIRED"]


class TransferEvaluateRequest(BaseModel):
    user_id: str = Field(min_length=1)
    recipient_id: str = Field(min_length=1)
    amount: float = Field(gt=0)
    currency: str = Field(default="MYR", min_length=3, max_length=3)
    channel: str = Field(default="wallet_app", min_length=1, max_length=50)
    message: str = Field(default="", max_length=1000)
    tx_note: str | None = Field(default=None, max_length=1000)
    tx_time: str | None = None
    transaction_id: str | None = Field(default=None, min_length=1, max_length=128)
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


class LlmTransferDecisionRequest(TransferEvaluateRequest):
    decision: Decision
    risk_score: int = Field(ge=0, le=100)
    reason_codes: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)


class WarningConfirmRequest(BaseModel):
    warning_id: str = Field(min_length=1)
    confirmed: bool


class WarningConfirmResponse(BaseModel):
    status: Literal["CANCELLED", "PENDING_DELAY", "APPROVED_AFTER_WARNING"]
    wait_seconds_remaining: int | None = None


GraphNodeKind = Literal["user", "neutral", "flagged", "mule"]
GraphNodeIcon = Literal["user", "wallet", "ip", "mule"]


class RiskGraphStats(BaseModel):
    tx_count: int
    max_risk_score: int
    flagged_tx_count: int
    source: str


class RiskGraphNode(BaseModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1, max_length=80)
    sublabel: str | None = Field(default=None, max_length=120)
    x: int
    y: int
    kind: GraphNodeKind
    icon: GraphNodeIcon


class RiskGraphEdge(BaseModel):
    source_id: str = Field(min_length=1)
    target_id: str = Field(min_length=1)
    label: str | None = Field(default=None, max_length=120)
    flagged: bool = False


class RiskGraphResponse(BaseModel):
    decision: Decision
    risk_score: int
    reason_codes: list[str]
    latency_ms: int
    stats: RiskGraphStats
    nodes: list[RiskGraphNode]
    edges: list[RiskGraphEdge]
