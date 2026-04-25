from typing import Any

from pydantic import BaseModel, Field


class TransferRestructureResult(BaseModel):
    is_transfer_intent: bool
    restructured_text: str | None = None
    amount: str | None = None
    recipient: str | None = None


class TransferValidationResult(BaseModel):
    is_valid_complete_transfer: bool
    missing_fields: list[str] = Field(default_factory=list)
    reason: str


class FraudScoreResult(BaseModel):
    requested: bool
    scored: bool
    is_fraud_or_spam: bool | None = None
    risk_score: float | None = None
    risk_level: str | None = None
    scam_category: str | None = None
    top_categories: list[str] = Field(default_factory=list)
    risk_reasons: list[str] = Field(default_factory=list)
    error: str | None = None
    raw: dict[str, Any] | None = None


class PatternCheckResult(BaseModel):
    requested: bool
    analyzed: bool
    status: str | None = None
    decision_hint: str | None = None
    summary_reason: str | None = None
    overall_pattern_risk: float | None = None
    matched_patterns: list[str] = Field(default_factory=list)
    evidence_atoms: list[str] = Field(default_factory=list)
    dataset_anchors: list[str] = Field(default_factory=list)
    library_version: str | None = None
    ontology_fingerprint: str | None = None
    config_id: str | None = None
    error: str | None = None
    raw: dict[str, Any] | None = None


class FinBertCheckRequest(BaseModel):
    text: str
    sender_id: str = "speech_user"
    receiver_id: str = "unknown_receiver"
    currency: str = "MYR"


class FinBertCheckResponse(BaseModel):
    gemini_assessment: str
    fraud_spam_final: bool | None = None
    confidence: str | None = None
    risk_score: float | None = None
    risk_level: str | None = None
    overall_pattern_risk: float | None = None


class SpeechToTextResponse(BaseModel):
    text: str
    job_name: str
    language_code: str
    transfer_restructure: TransferRestructureResult | None = None
    transfer_validation: TransferValidationResult | None = None
    fraud_score: FraudScoreResult | None = None
