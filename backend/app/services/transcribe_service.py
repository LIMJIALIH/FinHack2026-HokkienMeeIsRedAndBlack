import time
import uuid
from typing import Any

import boto3
import httpx
from fastapi import HTTPException

from app.core.config import settings

SUPPORTED_FORMATS = {"mp3", "mp4", "wav", "flac", "ogg", "amr", "webm"}


class TranscribeService:
    def __init__(self) -> None:
        if not settings.transcribe_input_bucket:
            raise HTTPException(
                status_code=500,
                detail="TRANSCRIBE_INPUT_BUCKET is not configured on backend",
            )

        if settings.aws_profile:
            session = boto3.session.Session(
                profile_name=settings.aws_profile,
                region_name=settings.aws_region,
            )
        else:
            session = boto3.session.Session(region_name=settings.aws_region)

        self._s3 = session.client("s3")
        self._transcribe = session.client("transcribe")

    def transcribe_audio(
        self,
        content: bytes,
        media_format: str,
        language_code: str,
    ) -> tuple[str, str]:
        if media_format not in SUPPORTED_FORMATS:
            raise HTTPException(status_code=400, detail=f"Unsupported media format: {media_format}")

        job_id = str(uuid.uuid4())
        job_name = f"finhack-stt-{job_id}"
        s3_key = f"speech-input/{job_name}.{media_format}"

        self._s3.put_object(
            Bucket=settings.transcribe_input_bucket,
            Key=s3_key,
            Body=content,
            ContentType=_content_type_for(media_format),
        )

        media_uri = f"s3://{settings.transcribe_input_bucket}/{s3_key}"
        self._transcribe.start_transcription_job(
            TranscriptionJobName=job_name,
            LanguageCode=language_code,
            MediaFormat=media_format,
            Media={"MediaFileUri": media_uri},
        )

        transcript_uri = self._wait_for_completion(job_name)
        text = self._download_transcript_text(transcript_uri)

        self._safe_cleanup(s3_key, job_name)
        return text, job_name

    def _wait_for_completion(self, job_name: str) -> str:
        timeout_at = time.monotonic() + settings.transcribe_job_timeout_seconds

        while time.monotonic() < timeout_at:
            response = self._transcribe.get_transcription_job(TranscriptionJobName=job_name)
            job = response["TranscriptionJob"]
            status = job["TranscriptionJobStatus"]
            if status == "COMPLETED":
                return job["Transcript"]["TranscriptFileUri"]
            if status == "FAILED":
                reason = job.get("FailureReason", "unknown error")
                raise HTTPException(status_code=502, detail=f"Transcribe job failed: {reason}")
            time.sleep(2)

        raise HTTPException(status_code=504, detail="Transcribe job timed out")

    def _download_transcript_text(self, transcript_uri: str) -> str:
        try:
            response = httpx.get(transcript_uri, timeout=20.0)
            response.raise_for_status()
            payload: dict[str, Any] = response.json()
            return payload["results"]["transcripts"][0]["transcript"]
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to download transcript: {exc}") from exc

    def _safe_cleanup(self, s3_key: str, job_name: str) -> None:
        try:
            self._s3.delete_object(Bucket=settings.transcribe_input_bucket, Key=s3_key)
        except Exception:
            pass
        try:
            self._transcribe.delete_transcription_job(TranscriptionJobName=job_name)
        except Exception:
            pass


def _content_type_for(media_format: str) -> str:
    return {
        "mp3": "audio/mpeg",
        "mp4": "audio/mp4",
        "wav": "audio/wav",
        "flac": "audio/flac",
        "ogg": "audio/ogg",
        "amr": "audio/amr",
        "webm": "audio/webm",
    }[media_format]
