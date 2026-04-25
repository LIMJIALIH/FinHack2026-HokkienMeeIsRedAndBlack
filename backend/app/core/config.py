from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Guardian Voice Fraud API"
    app_version: str = "0.1.0"
    aws_region: str = "ap-southeast-1"
    aws_profile: str = ""
    neptune_endpoint: str = ""
    warning_delay_seconds: int = 30

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

