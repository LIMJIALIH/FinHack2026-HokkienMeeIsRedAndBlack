from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "FinHack Backend"
    app_version: str = "0.1.0"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    gemini_model: str = "gemini-3.1-flash-lite-preview"
    gemini_timeout_seconds: int = 180
    google_api_key: str | None = None
    fraud_score_endpoint_url: str = "http://47.254.237.181:8000/score"
    fraud_score_timeout_seconds: int = 15
    pattern_analyze_endpoint_url: str = "http://47.250.192.196:8000/analyze"
    pattern_analyze_timeout_seconds: int = 15

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
