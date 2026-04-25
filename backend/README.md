# Backend

FastAPI backend organized with a scalable project structure.

## Environment

Create `.env` in `backend/`:

```bash
GEMINI_MODEL=gemini-3.1-flash-lite-preview
GEMINI_TIMEOUT_SECONDS=180
GOOGLE_API_KEY=<your-google-api-key>
FRAUD_SCORE_ENDPOINT_URL=http://47.254.237.181:8000/score
FRAUD_SCORE_TIMEOUT_SECONDS=15
PATTERN_ANALYZE_ENDPOINT_URL=http://47.250.192.196:8000/analyze
PATTERN_ANALYZE_TIMEOUT_SECONDS=15
CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
```

Notes:
- Backend speech-to-text uses LangChain `ChatGoogleGenerativeAI` with Gemini.
- Default model is `gemini-3.1-flash-lite-preview` (Gemini 3.1 Flash-Lite preview).
- Endpoint added: `POST /api/v1/speech/transcribe` (multipart `file`, optional `language_code`).
- Endpoint added: `POST /api/v1/speech/check-finbert` (JSON body with `text`, optional `sender_id`, `receiver_id`, `currency`).
  It calls both endpoints below and injects their outputs into LangChain Gemini for final assessment:
  - FinBert-style risk score from `FRAUD_SCORE_ENDPOINT_URL`
  - Pattern analysis from `PATTERN_ANALYZE_ENDPOINT_URL` (`/analyze`)
- Endpoint expects WAV PCM (mono, 16-bit; sample rate 8k/16k/24k). The frontend recorder converts browser audio to compatible WAV before upload.
- After transcription, backend runs one LLM validation agent to check whether transfer intent is complete (amount + recipient).
- If transfer validation is valid, backend calls `FRAUD_SCORE_ENDPOINT_URL` (`/score`) to assess fraud/spam risk.

## Run

```bash
uv run fastapi dev app/main.py
```

or

```bash
uv run python main.py
```

## Test

```bash
uv run pytest
```

## Structure

```
backend/
  app/
    api/
      v1/
        endpoints/
          health.py
      router.py
    core/
      config.py
    schemas/
      health.py
    main.py
  tests/
    test_health.py
  main.py
```
