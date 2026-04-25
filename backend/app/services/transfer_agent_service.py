import json
from typing import Any

from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import settings
from app.schemas.speech import TransferValidationResult


class TransferAgentService:
    def __init__(self) -> None:
        kwargs: dict[str, Any] = {
            "model": settings.gemini_model,
            "max_retries": 2,
            "timeout": settings.gemini_timeout_seconds,
            "temperature": 0.0,
        }
        if settings.google_api_key:
            kwargs["api_key"] = settings.google_api_key

        # Single remaining agent: validate transfer completeness.
        self._validation_agent = ChatGoogleGenerativeAI(**kwargs)

    def validate(self, transcript_text: str) -> TransferValidationResult:
        return self._run_validation_agent(transcript_text)

    def _run_validation_agent(
        self,
        transcript_text: str,
    ) -> TransferValidationResult:
        prompt = (
            "You validate money transfer commands.\n"
            "Return strict JSON only with keys:\n"
            "is_valid_complete_transfer (boolean), missing_fields (array of strings), reason (string).\n"
            "Validation rules:\n"
            "1) valid only if transcript clearly expresses transfer intent.\n"
            "2) amount must be present and clearly specified.\n"
            "3) recipient must be present and clearly specified.\n"
            "4) missing_fields can only include: amount, recipient, intent.\n\n"
            f"Original transcript: {transcript_text}\n"
        )
        response = self._validation_agent.invoke([HumanMessage(content=prompt)])
        payload = _parse_json_response(_response_text(response))

        missing_fields = payload.get("missing_fields", [])
        if not isinstance(missing_fields, list):
            missing_fields = []
        normalized_missing_fields = [str(x) for x in missing_fields if str(x) in {"amount", "recipient", "intent"}]

        is_valid = bool(payload.get("is_valid_complete_transfer", False))
        reason = str(payload.get("reason", "")).strip() or "Validation not provided."
        merged_missing_fields = sorted(set(normalized_missing_fields))
        if merged_missing_fields and is_valid:
            is_valid = False

        return TransferValidationResult(
            is_valid_complete_transfer=is_valid,
            missing_fields=merged_missing_fields,
            reason=reason,
        )


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
