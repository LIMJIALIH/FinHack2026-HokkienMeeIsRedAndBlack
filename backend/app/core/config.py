from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App
    app_name: str = "Guardian Voice Fraud API"
    app_version: str = "0.1.0"

    # AWS / Neptune
    aws_region: str = "ap-southeast-1"
    aws_profile: str = ""
    neptune_endpoint: str = ""
    dev_user_id: str = ""

    # Risk / HITL
    warning_delay_seconds: int = 30
    api_cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Agent model
    main_agent_model: str = ""
    main_agent_model_provider: str = "openai"
    openai_api_key: str = ""
    google_api_key: str = ""
    gemini_api_key: str = ""

    # Gemini speech / transfer-agent
    gemini_model: str = "gemini-3.1-flash-lite-preview"
    gemini_timeout_seconds: int = 180

    # Fraud scoring
    fraud_score_endpoint_url: str = "http://47.254.237.181:8000/score"
    fraud_score_timeout_seconds: int = 15
    pattern_analyze_endpoint_url: str = "http://47.250.192.196:8000/analyze"
    pattern_analyze_timeout_seconds: int = 15

    # Aliases for backward compat
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("neptune_endpoint", mode="before")
    @classmethod
    def normalize_neptune_endpoint(cls, value: object) -> str:
        raw = str(value or "").strip()
        if not raw:
            return ""
        if "://" in raw:
            raw = raw.split("://", 1)[1]
        raw = raw.split("/", 1)[0]
        if ":" in raw:
            raw = raw.split(":", 1)[0]
        return raw.strip()


settings = Settings()
