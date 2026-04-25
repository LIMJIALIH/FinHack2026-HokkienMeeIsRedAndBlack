from pydantic import BaseModel


class SpeechToTextResponse(BaseModel):
    text: str
    job_name: str
    language_code: str
