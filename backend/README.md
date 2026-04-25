# Backend

FastAPI backend organized with a scalable project structure.

## Environment

Create `.env` in `backend/`:

```bash
AWS_REGION=ap-southeast-1
AWS_PROFILE=finhack_IsbUsersPS-393886308397
TRANSCRIBE_INPUT_BUCKET=<your-transcribe-input-bucket>
CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
```

Notes:
- `TRANSCRIBE_INPUT_BUCKET` must be an existing bucket your role can access.
- Endpoint added: `POST /api/v1/speech/transcribe` (multipart `file`, optional `language_code`).

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
