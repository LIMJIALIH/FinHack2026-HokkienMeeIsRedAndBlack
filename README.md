# FinHack 2026 - Guardian Voice

Guardian Voice is a full-stack fraud-prevention prototype built for FinHack 2026.
It combines voice-driven transfer intent capture, AI-assisted fraud analysis, and a live regulatory relationship graph to support both wallet users and compliance teams.

## What This Project Does

- Converts spoken transfer requests into text using Gemini.
- Validates whether a transfer intent is complete (for example, amount + recipient).
- Calls fraud scoring and pattern-analysis services, then synthesizes a final risk assessment with Gemini.
- Uses external fraud engines:
  - Pattern analysis: `http://47.250.192.196:8000/analyze`
  - Fraud score: `http://47.254.237.181:8000/score`
- Supports Alibaba Cloud eKYC checks in the onboarding/identity-verification flow.
- Displays a regulatory dashboard with live transaction graph data from Amazon Neptune.

## Repository Layout

```text
.
|-- frontend/                         # Next.js UI (wallet + regulatory dashboard)
|-- backend/                          # FastAPI API + AI/graph integrations
|   |-- app/
|   |   |-- api/v1/endpoints/         # health, speech, regulatory routes
|   |   |-- core/config.py            # environment-based settings
|   |   |-- services/                 # transcription, transfer check, fraud scoring
|   |   \-- lambda_handler.py         # AWS Lambda entrypoint (Mangum)
|   |-- tests/
|   |-- deploy_apprunner_backend.ps1
|   |-- deploy_lambda_backend.ps1
|   \-- Dockerfile.lambda
|-- amplify.yml                       # Amplify frontend build config
|-- prd.md / prd1.md / prd2.md        # product notes
\-- README.md
```

## Tech Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS
- Backend: FastAPI, Pydantic Settings, LangChain, Google Gemini, boto3
- Data/Infra: Amazon Neptune, AWS App Runner, AWS Lambda + Function URL, AWS Amplify

## Prerequisites

- Node.js 20+ (recommended for Next.js 16)
- npm (or pnpm/yarn)
- Python 3.13+ (per `backend/pyproject.toml`)
- `uv` package manager (recommended for backend local runs)
- Optional for deployment:
  - AWS CLI v2
  - Docker Desktop (Lambda container deployment)

## Local Development

### 1. Clone and enter repo

```bash
git clone https://github.com/LIMJIALIH/FinHack2026-HokkienMeeIsRedAndBlack
cd FinHack2026-HokkienMeeIsRedAndBlack
```

### 2. Backend setup

From `backend/`, create `.env`:

```bash
GEMINI_MODEL=gemini-3.1-flash-lite-preview
GEMINI_TIMEOUT_SECONDS=180
GOOGLE_API_KEY=<your-google-api-key>
FRAUD_SCORE_ENDPOINT_URL=http://47.254.237.181:8000/score
FRAUD_SCORE_TIMEOUT_SECONDS=15
PATTERN_ANALYZE_ENDPOINT_URL=http://47.250.192.196:8000/analyze
PATTERN_ANALYZE_TIMEOUT_SECONDS=15
CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
AWS_REGION=ap-southeast-1
# Alibaba Cloud eKYC (set when eKYC is enabled in your environment)
# ALIBABA_EKYC_ENDPOINT=<your-alibaba-ekyc-endpoint>
# ALIBABA_EKYC_ACCESS_KEY_ID=<your-access-key-id>
# ALIBABA_EKYC_ACCESS_KEY_SECRET=<your-access-key-secret>
# ALIBABA_EKYC_APP_ID=<your-ekyc-app-id>
# Optional if you query Neptune directly in local dev:
# NEPTUNE_ENDPOINT=https://<your-neptune-endpoint>:8182
# AWS_PROFILE=<your-aws-profile>
# NEPTUNE_AWS_PROFILE=<your-aws-profile>
```

Install and run:

```bash
cd backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Alternative (existing scripts):

```powershell
./run_backend_local.ps1
# or
./run_backend_8001.ps1
```

Backend will be available at `http://127.0.0.1:8000`.

### 3. Frontend setup

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Install and run:

```bash
cd frontend
npm install
npm run dev
```

Frontend will be available at `http://localhost:3000`.

## API Endpoints

Base URL: `http://127.0.0.1:8000`

- `GET /api/v1/health`
  - Health check endpoint.
- `POST /api/v1/speech/transcribe`
  - Multipart form request with `file` (WAV), optional `language_code`, `sender_id`, `receiver_id`, `currency`.
  - Transcribes audio and runs transfer-intent validation.
  - Calls fraud score endpoint when transfer validation is complete.
- `POST /api/v1/speech/check-finbert`
  - JSON request with `text` (+ optional sender/receiver/currency).
  - Runs combined check: fraud score + pattern analysis + Gemini final assessment.
  - Upstream integrations:
    - Pattern analysis endpoint: `http://47.250.192.196:8000/analyze`
    - Fraud score endpoint: `http://47.254.237.181:8000/score`
- `GET /api/v1/regulatory-dashboard/graph`
  - Returns nodes/edges from Neptune for regulatory dashboard visualization.

## Audio Requirements

`/api/v1/speech/transcribe` currently accepts WAV and expects:

- Mono (1 channel)
- 16-bit PCM
- Sample rate: 8k, 16k, or 24k Hz

The frontend recorder converts browser audio to a compatible WAV format before upload.

## Testing

Backend tests:

```bash
cd backend
uv run pytest
```

## Deployment

### Frontend (AWS Amplify)

`amplify.yml` is configured to:

1. `cd frontend`
2. `npm ci`
3. `npm run build`
4. Publish static output from `frontend/out`

Note: `frontend/next.config.mjs` sets `output: "export"` for static export.

### Backend (AWS App Runner)

Use:

```powershell
cd backend
./deploy_apprunner_backend.ps1
```

This script configures service source from GitHub, build/start commands, health check, and runtime env vars.

### Backend (AWS Lambda container)

Use:

```powershell
cd backend
./deploy_lambda_backend.ps1 -GoogleApiKey "<key>" -NeptuneEndpoint "https://<endpoint>:8182"
```

This script handles ECR image push, IAM role setup, Lambda creation/update, and Function URL configuration.

See [`backend/LAMBDA_DEPLOYMENT.md`](backend/LAMBDA_DEPLOYMENT.md) for details.

## Alibaba Cloud eKYC Integration

Alibaba Cloud eKYC is included as an identity-verification step for high-risk or compliance-sensitive user flows.

Typical implementation flow:

1. Frontend captures required KYC data/documents.
2. Backend sends eKYC verification request to Alibaba Cloud eKYC service.
3. Backend receives verification result and risk signals.
4. Result is combined with fraud checks to allow, challenge, or block transactions.

Recommended runtime configuration:

- `ALIBABA_EKYC_ENDPOINT`
- `ALIBABA_EKYC_ACCESS_KEY_ID`
- `ALIBABA_EKYC_ACCESS_KEY_SECRET`
- `ALIBABA_EKYC_APP_ID`

## Troubleshooting

- CORS errors from frontend:
  - Ensure backend `CORS_ORIGINS` includes your frontend host.
- Empty or failed transcription:
  - Ensure uploaded audio is valid WAV PCM mono and one of the supported sample rates.
  - Verify `GOOGLE_API_KEY` is set.
- Regulatory graph fails to load:
  - Confirm AWS credentials/profile and Neptune endpoint/network access.
- FinBert/pattern checks fail:
  - Verify `FRAUD_SCORE_ENDPOINT_URL` and `PATTERN_ANALYZE_ENDPOINT_URL` are reachable.

## Notes

- This repository currently includes active backend changes beyond this README.
- When shipping to production, rotate secrets and move keys to secure secret management (for example AWS Secrets Manager).
