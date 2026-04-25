import os

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.schemas.speech import (
    FinBertCheckRequest,
    FinBertCheckResponse,
    FraudScoreResult,
    SpeechToTextResponse,
    TransferValidationResult,
)
from app.services.fraud_score_service import FraudScoreService
from app.services.transfer_agent_service import TransferAgentService
from app.services.transcribe_service import TranscribeService

router = APIRouter()


@router.post("/speech/transcribe", response_model=SpeechToTextResponse)
async def transcribe_speech(
    file: UploadFile = File(...),
    language_code: str = Form("en-US"),
    sender_id: str = Form("speech_user"),
    receiver_id: str = Form("unknown_receiver"),
    currency: str = Form("MYR"),
) -> SpeechToTextResponse:
    media_format = _infer_media_format(file)
    if not media_format:
        raise HTTPException(status_code=400, detail="Unable to infer media format from uploaded file")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty")

    service = TranscribeService()
    text, job_name = service.transcribe_audio(
        content=audio_bytes,
        media_format=media_format,
        language_code=language_code,
    )

    try:
        transfer_agent = TransferAgentService()
        validation_result = transfer_agent.validate(text)
        restructure_result = None
    except Exception as exc:
        restructure_result = None
        validation_result = TransferValidationResult(
            is_valid_complete_transfer=False,
            missing_fields=["intent"],
            reason=f"Transfer-agent processing failed: {exc}",
        )

    if validation_result.is_valid_complete_transfer:
        fraud_score = FraudScoreService().score_text(
            text=text,
            sender_id=sender_id,
            receiver_id=receiver_id,
            currency=currency,
        )
    else:
        fraud_score = FraudScoreResult(
            requested=False,
            scored=False,
            error="Transfer validation failed; fraud scoring skipped.",
        )

    return SpeechToTextResponse(
        text=text,
        job_name=job_name,
        language_code=language_code,
        transfer_restructure=restructure_result,
        transfer_validation=validation_result,
        fraud_score=fraud_score,
    )


@router.post("/speech/check-finbert", response_model=FinBertCheckResponse)
async def check_with_finbert(payload: FinBertCheckRequest) -> FinBertCheckResponse:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required for FinBert scoring.")

    return FraudScoreService().run_combined_check(
        text=text,
        sender_id=payload.sender_id,
        receiver_id=payload.receiver_id,
        currency=payload.currency,
    )


def _infer_media_format(file: UploadFile) -> str:
    extension = os.path.splitext(file.filename or "")[1].lower().lstrip(".")
    if extension:
        return extension

    by_type = {
        "audio/mpeg": "mp3",
        "audio/mp4": "mp4",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/flac": "flac",
        "audio/ogg": "ogg",
        "audio/amr": "amr",
        "audio/webm": "webm",
    }
    return by_type.get(file.content_type or "", "")
