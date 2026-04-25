import json
import re
import uuid
from typing import Any
from urllib import error, request

from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import settings
from app.schemas.speech import FinBertCheckResponse, FraudScoreResult, PatternCheckResult


class FraudScoreService:
    def __init__(self) -> None:
        kwargs: dict[str, Any] = {
            "model": settings.gemini_model,
            "max_retries": 2,
            "timeout": settings.gemini_timeout_seconds,
            "temperature": 0.0,
        }
        if settings.google_api_key:
            kwargs["api_key"] = settings.google_api_key
        self._llm = ChatGoogleGenerativeAI(**kwargs)

    def score_text(
        self,
        *,
        text: str,
        sender_id: str,
        receiver_id: str,
        currency: str,
    ) -> FraudScoreResult:
        payload = {
            "transaction_id": f"stt_{uuid.uuid4().hex[:12]}",
            "sender_id": sender_id,
            "receiver_id": receiver_id,
            "text": text,
            "amount": _extract_amount(text),
            "currency": currency,
        }
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            settings.fraud_score_endpoint_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=settings.fraud_score_timeout_seconds) as resp:
                response_text = resp.read().decode("utf-8")
            parsed: dict[str, Any] = json.loads(response_text) if response_text else {}
        except (error.URLError, error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            return FraudScoreResult(
                requested=True,
                scored=False,
                error=f"Fraud score API call failed: {exc}",
            )

        return FraudScoreResult(
            requested=True,
            scored=True,
            is_fraud_or_spam=_infer_fraud_or_spam(parsed),
            risk_score=_as_float(parsed.get("risk_score")),
            risk_level=_as_str(parsed.get("risk_level")),
            scam_category=_as_str(parsed.get("scam_category")),
            top_categories=_as_str_list(parsed.get("top_categories")),
            risk_reasons=_as_str_list(parsed.get("risk_reasons")),
            raw=parsed,
        )

    def analyze_patterns(self, *, text: str) -> PatternCheckResult:
        payload = {"text": text}
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            settings.pattern_analyze_endpoint_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=settings.pattern_analyze_timeout_seconds) as resp:
                response_text = resp.read().decode("utf-8")
            parsed: dict[str, Any] = json.loads(response_text) if response_text else {}
        except (error.URLError, error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            return PatternCheckResult(
                requested=True,
                analyzed=False,
                error=f"Pattern analyze API call failed: {exc}",
            )

        return PatternCheckResult(
            requested=True,
            analyzed=True,
            status=_as_str(parsed.get("status")),
            decision_hint=_as_str(parsed.get("decision_hint")),
            summary_reason=_as_str(parsed.get("summary_reason")),
            overall_pattern_risk=_as_float(parsed.get("overall_pattern_risk")),
            matched_patterns=_as_str_list(parsed.get("matched_patterns")),
            evidence_atoms=_as_str_list(parsed.get("evidence_atoms")),
            dataset_anchors=_as_str_list(parsed.get("dataset_anchors")),
            library_version=_as_str(parsed.get("library_version")),
            ontology_fingerprint=_as_str(parsed.get("ontology_fingerprint")),
            config_id=_as_str(parsed.get("config_id")),
            raw=parsed,
        )

    def run_combined_check(
        self,
        *,
        text: str,
        sender_id: str,
        receiver_id: str,
        currency: str,
    ) -> FinBertCheckResponse:
        fraud_score = self.score_text(
            text=text,
            sender_id=sender_id,
            receiver_id=receiver_id,
            currency=currency,
        )
        pattern_check = self.analyze_patterns(text=text)
        gemini_assessment, fraud_spam_final, confidence = self._analyze_with_gemini(
            text=text,
            fraud_score=fraud_score,
            pattern_check=pattern_check,
        )
        return FinBertCheckResponse(
            gemini_assessment=gemini_assessment,
            fraud_spam_final=fraud_spam_final,
            confidence=confidence,
        )

    def _analyze_with_gemini(
        self,
        *,
        text: str,
        fraud_score: FraudScoreResult,
        pattern_check: PatternCheckResult,
    ) -> tuple[str, bool | None, str | None]:
        prompt = (
            "You are a fraud-risk decision assistant.\n"
            "Input includes:\n"
            "1) FinBert scoring endpoint result\n"
            "2) Pattern analysis endpoint result\n"
            "3) Original text\n\n"
            "Return strict JSON only with keys:\n"
            "gemini_assessment (string), fraud_spam_final (boolean), confidence (LOW|MEDIUM|HIGH).\n\n"
            f"Original text:\n{text}\n\n"
            f"FinBert result:\n{json.dumps(fraud_score.model_dump(), ensure_ascii=True)}\n\n"
            f"Pattern result:\n{json.dumps(pattern_check.model_dump(), ensure_ascii=True)}\n"
        )

        try:
            response = self._llm.invoke([HumanMessage(content=prompt)])
            payload = _parse_json_response(_response_text(response))
        except Exception:
            payload = {}

        assessment = str(payload.get("gemini_assessment", "")).strip()
        if not assessment:
            assessment = (
                "Unable to produce model narrative. "
                "Use endpoint outputs to determine risk manually."
            )

        fraud_spam_final_raw = payload.get("fraud_spam_final")
        fraud_spam_final: bool | None = (
            bool(fraud_spam_final_raw) if isinstance(fraud_spam_final_raw, bool) else None
        )
        confidence_raw = str(payload.get("confidence", "")).upper().strip()
        confidence = confidence_raw if confidence_raw in {"LOW", "MEDIUM", "HIGH"} else None

        return assessment, fraud_spam_final, confidence


def _extract_amount(text: str) -> float:
    match = re.search(r"(?:rm\s*)?(\d+(?:[.,]\d+)?)", text.lower())
    if not match:
        return 0.0
    amount_raw = match.group(1).replace(",", "")
    try:
        return float(amount_raw)
    except ValueError:
        return 0.0


def _infer_fraud_or_spam(payload: dict[str, Any]) -> bool:
    risk_score = _as_float(payload.get("risk_score"))
    risk_level = (_as_str(payload.get("risk_level")) or "").upper()
    return bool(risk_score is not None and risk_score > 50 and risk_level in {"MEDIUM", "HIGH"})


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_str_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    if value is None:
        return []
    return [str(value)]


def _response_text(response: Any) -> str:
    response_text = getattr(response, "text", None)
    if isinstance(response_text, str) and response_text.strip():
        return response_text.strip()

    content = getattr(response, "content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts).strip()
    return ""


def _parse_json_response(raw_text: str) -> dict[str, Any]:
    if not raw_text:
        return {}

    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.replace("```json", "").replace("```", "").strip()

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and start < end:
        try:
            parsed = json.loads(cleaned[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}
    return {}
