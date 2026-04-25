import os

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.schemas.speech import SpeechToTextResponse
from app.services.transcribe_service import TranscribeService

router = APIRouter()


@router.post("/speech/transcribe", response_model=SpeechToTextResponse)
async def transcribe_speech(
    file: UploadFile = File(...),
    language_code: str = Form("en-US"),
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
    return SpeechToTextResponse(text=text, job_name=job_name, language_code=language_code)


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
