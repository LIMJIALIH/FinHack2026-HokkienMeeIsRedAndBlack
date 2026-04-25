from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Guardian Voice Fraud API"
    app_version: str = "0.1.0"
    aws_region: str = "ap-southeast-1"
    aws_profile: str = ""
    neptune_endpoint: str = ""
    dev_user_id: str = "Eric Wong"
    warning_delay_seconds: int = 30
    api_cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    main_agent_model: str = ""
    # main_agent_model_provider: str = "google_genai"
    main_agent_model_provider: str = "openai"
    openai_api_key: str = ""
    google_api_key: str = ""
    gemini_api_key: str = ""

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )
