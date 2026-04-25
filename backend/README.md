# Backend (Guardian Voice Fraud API)

FastAPI backend that combines:
- Main transaction agent + HITL + Neptune persistence
- Onboarding/auth/eKYC + DynamoDB user data
- Speech transcription + fraud/FinBERT-style scoring + regulatory APIs

## Structure

```text
backend/
  app/
    api/
      dependencies.py
      router.py                # speech/regulatory router (/api/v1/...)
      v1/
        endpoints/
          health.py            # /healthz
          risk.py              # /risk/check, /risk/graph
          transfer.py          # /transfer/evaluate, /transfer/llm-decision, /transfer/warning/confirm
          voice.py             # /voice/turn, /voice/turn/stream, /voice/decision
        router.py
    core/
      config.py
    schemas/
      transfer.py
      speech.py
      voice.py
    services/
      risk_engine.py
      warnings.py
      transcribe_service.py
      fraud_score_service.py
      transfer_agent_service.py
    main.py                    # structured app factory
  main.py                      # unified entry point (auth + onboarding + agent)
  tests/
    test_health.py
```

## Environment

Create `.env` in `backend/`.

```bash
# Core app
NEPTUNE_ENDPOINT=<required>
AWS_REGION=ap-southeast-1
AWS_PROFILE=

# Agent
MAIN_AGENT_MODEL=
MAIN_AGENT_MODEL_PROVIDER=openai
OPENAI_API_KEY=
GOOGLE_API_KEY=
GEMINI_API_KEY=

# Speech + fraud scoring
GEMINI_MODEL=gemini-3.1-flash-lite-preview
GEMINI_TIMEOUT_SECONDS=180
FRAUD_SCORE_ENDPOINT_URL=http://47.254.237.181:8000/score
FRAUD_SCORE_TIMEOUT_SECONDS=15
PATTERN_ANALYZE_ENDPOINT_URL=http://47.250.192.196:8000/analyze
PATTERN_ANALYZE_TIMEOUT_SECONDS=15

# CORS
API_CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
```

## Run

```bash
uv sync
uv run python main.py
```

Alternative:

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Tests

```bash
uv run pytest
```

## Notes

- `NEPTUNE_ENDPOINT` is required (mock graph mode removed).
- Speech transcription endpoint: `POST /api/v1/speech/transcribe`
- FinBERT/pattern endpoint: `POST /api/v1/speech/check-finbert`
- Health endpoints:
  - `GET /health` (root app)
  - `GET /healthz` (v1 core route)
