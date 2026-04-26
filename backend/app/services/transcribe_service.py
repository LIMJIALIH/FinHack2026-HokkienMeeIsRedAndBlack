import base64
import io
import uuid
import wave
from typing import Any

from fastapi import HTTPException
from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import settings

SUPPORTED_FORMATS = {"wav"}
PCM_SAMPLE_SIZE_BITS = 16
PCM_CHANNELS = 1
ALLOWED_SAMPLE_RATES = {8000, 16000, 24000}


class TranscribeService:
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

    def transcribe_audio(
        self,
        content: bytes,
        media_format: str,
        language_code: str,
    ) -> tuple[str, str]:
        if media_format not in SUPPORTED_FORMATS:
            raise HTTPException(status_code=400, detail=f"Unsupported media format: {media_format}")

        pcm_bytes, sample_rate_hz = _extract_wav_pcm(content)
        request_id = str(uuid.uuid4())

        try:
            user_message = HumanMessage(
                content=[
                    {
                        "type": "text",
                        "text": (
                            "Transcribe this speech audio. "
                            f"Language hint: {language_code}. Target user normally Malaysian. "
                            "Return only the transcript text. "
                            "Do not add commentary, labels, or markdown."
                        ),
                    },
                    {
                        "type": "audio",
                        "mime_type": "audio/wav",
                        "base64": _to_wav_base64(pcm_bytes, sample_rate_hz),
                    },
                ]
            )
            response = self._llm.invoke([user_message])
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Gemini transcription failed: {exc}") from exc

        text = _extract_text_response(response)
        if not text:
            raise HTTPException(status_code=502, detail="Gemini returned empty transcript")

        return text, request_id


def _extract_wav_pcm(content: bytes) -> tuple[bytes, int]:
    try:
        with wave.open(io.BytesIO(content), "rb") as wav_file:
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            pcm_bytes = wav_file.readframes(wav_file.getnframes())
    except wave.Error as exc:
        raise HTTPException(status_code=400, detail=f"Invalid WAV file: {exc}") from exc

    if channels != PCM_CHANNELS:
        raise HTTPException(status_code=400, detail="WAV must be mono (1 channel)")
    if sample_width != PCM_SAMPLE_SIZE_BITS // 8:
        raise HTTPException(status_code=400, detail="WAV must be 16-bit PCM")
    if sample_rate not in ALLOWED_SAMPLE_RATES:
        raise HTTPException(status_code=400, detail="WAV sample rate must be one of 8000, 16000, or 24000 Hz")
    if not pcm_bytes:
        raise HTTPException(status_code=400, detail="Uploaded WAV has no audio frames")

    return pcm_bytes, sample_rate


def _to_wav_base64(pcm_bytes: bytes, sample_rate_hz: int) -> str:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(PCM_CHANNELS)
        wav_file.setsampwidth(PCM_SAMPLE_SIZE_BITS // 8)
        wav_file.setframerate(sample_rate_hz)
        wav_file.writeframes(pcm_bytes)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _extract_text_response(response: Any) -> str:
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
