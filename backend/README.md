# Backend (Guardian Voice Fraud API)

## Structure

```text
backend/
  app/
    api/
      dependencies.py
      v1/
        endpoints/
          health.py
          risk.py
          transfer.py
        router.py
    core/
      config.py
    schemas/
      transfer.py
    services/
      risk_engine.py
      warnings.py
    main.py
  tests/
    test_health.py
  main.py  # compatibility entrypoint
```

## Run

```bash
uv sync
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Primary module entrypoint:

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Endpoints

- `GET /healthz`
- `POST /risk/check`
- `POST /transfer/evaluate`
- `POST /transfer/warning/confirm`

## Example request

```json
{
  "user_id": "u_123",
  "recipient_id": "u_999",
  "amount": 3500,
  "message": "Please transfer urgently now",
  "recipient_is_new": true,
  "device_id": "device_hash",
  "ip_hash": "ip_hash",
  "transaction_context_hash": "txctx_hash"
}
```

If `decision=WARNING`, call `/transfer/warning/confirm` with `confirmed=true`.
The API enforces a 30-second cooling-off delay before it returns `APPROVED_AFTER_WARNING`.
