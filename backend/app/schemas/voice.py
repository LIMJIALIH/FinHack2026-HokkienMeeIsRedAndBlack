from typing import Any, Literal

from pydantic import BaseModel, Field


class CardAction(BaseModel):
    action: Literal["approve", "reject"]
    warning_id: str | None = None
    label: str


class TransferReviewCard(BaseModel):
    card_type: Literal["transfer_review"] = "transfer_review"
    title: str
    subtitle: str
    amount: float | None = None
    currency: str | None = None
    recipient_name: str | None = None
    decision_preview: Literal["APPROVED", "WARNING", "INTERVENTION_REQUIRED"]
    risk_score: int = Field(ge=0, le=100)
    reason_codes: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    warning_id: str | None = None
    warning_delay_seconds: int | None = None
    purpose_question: str = "What is this transaction for?"
    actions: list[CardAction] = Field(default_factory=list)


class VoiceTurnRequest(BaseModel):
    user_text: str = Field(min_length=1, max_length=2000)
    thread_id: str | None = Field(default=None, min_length=1, max_length=128)
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    finbert_score: float | None = None
    finbert_assessment: str | None = None


class VoiceDecisionRequest(BaseModel):
    thread_id: str = Field(min_length=1, max_length=128)
    warning_id: str | None = Field(default=None, min_length=1, max_length=64)
    decision: Literal["approve", "reject"]
    purpose: str | None = Field(default=None, max_length=1000)


class VoiceTurnResponse(BaseModel):
    thread_id: str
    mode: Literal["hitl_required", "final"]
    assistant_text: str
    card: TransferReviewCard | None = None
    transfer: dict[str, Any] | None = None
    backend_status: str | None = None
    hitl: dict[str, Any] | None = None
    steps: list[str] = Field(default_factory=list)
