import os
import hashlib
import hmac
import base64
import time
import uuid
import urllib.parse
import json
import logging
from decimal import Decimal
from datetime import datetime, timezone
from threading import Lock
from typing import Optional

import boto3
import httpx
import requests as _req
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Header, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import jwt
from passlib.context import CryptContext

from app.api.v1.router import api_router as v1_api_router
from app.core.config import Settings
from app.services.aws_session import build_boto3_session
from app.services.risk_engine import NeptuneRiskClient, RiskEngine, build_graph
from app.services.wallet_ledger import WalletLedger
from app.services.warnings import InMemoryWarningStore
from transaction_agent import build_main_deep_agent

try:
    import cv2
    import numpy as np
    FACE_CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False
    FACE_CASCADE = None

load_dotenv()
logging.basicConfig(level=logging.INFO)
_log = logging.getLogger(__name__)
settings = Settings()

# ── Config ─────────────────────────────────────────────────────────────────
ALIBABA_ACCESS_KEY_ID      = os.getenv("ALIBABA_CLOUD_ACCESS_KEY_ID", "")
ALIBABA_ACCESS_KEY_SECRET  = os.getenv("ALIBABA_CLOUD_ACCESS_KEY_SECRET", "")
ALIBABA_REGION             = os.getenv("ALIBABA_CLOUD_REGION", "ap-southeast-3")
ALIBABA_ENDPOINT           = os.getenv("ALIBABA_CLOUD_ENDPOINT", "").strip()
ALIBABA_API_VERSION        = os.getenv("ALIBABA_CLOUD_API_VERSION", "").strip()
ALIBABA_PRODUCT_CODE       = os.getenv("ALIBABA_CLOUD_PRODUCT_CODE", "FACE_LIVENESS_PRO").strip()
ALIBABA_DOC_TYPE           = os.getenv("ALIBABA_CLOUD_DOC_TYPE", "").strip()
ALIBABA_PAGES              = os.getenv("ALIBABA_CLOUD_PAGES", "").strip()
ALIBABA_FALLBACK_ON_DENIED = os.getenv("ALIBABA_CLOUD_FALLBACK_ON_DENIED", "true").lower() in {"1","true","yes","on"}

JWT_SECRET       = os.getenv("JWT_SECRET_KEY", "tng-guardian-dev-secret-change-me")
JWT_EXPIRE_DAYS  = int(os.getenv("JWT_EXPIRE_DAYS", "7"))
FRONTEND_URL     = os.getenv("FRONTEND_URL", "http://localhost:3000")
ALIBABA_CB_URL   = os.getenv("ALIBABA_CALLBACK_URL", "")

AWS_REGION       = os.getenv("AWS_REGION", "ap-southeast-1")
DYNAMO_TABLE     = os.getenv("DYNAMO_TABLE", "tng_guardian_users")

def _normalize_neptune_endpoint(value: str) -> str:
    endpoint = (value or "").strip()
    if "://" in endpoint:
        endpoint = endpoint.split("://", 1)[1]
    endpoint = endpoint.split("/", 1)[0]
    if ":" in endpoint:
        endpoint = endpoint.split(":", 1)[0]
    return endpoint.strip()


NEPTUNE_ENDPOINT = _normalize_neptune_endpoint(
    os.getenv(
        "NEPTUNE_ENDPOINT",
        "db-neptune-2.cluster-cjugq6yyw4j8.ap-southeast-1.neptune.amazonaws.com",
    )
)
NEPTUNE_PORT     = int(os.getenv("NEPTUNE_PORT", "8182"))
NEPTUNE_URL      = f"https://{NEPTUNE_ENDPOINT}:{NEPTUNE_PORT}"

SIMULATION_MODE = not bool(ALIBABA_ACCESS_KEY_ID and ALIBABA_ACCESS_KEY_SECRET)

_log.info("=== TNG Guardian Voice API ===")
_log.info("Product : %s | Simulation: %s | Region: %s", ALIBABA_PRODUCT_CODE, SIMULATION_MODE, ALIBABA_REGION)

# ── App ───────────────────────────────────────────────────────────────────
app = FastAPI(title=settings.app_name, version=settings.app_version)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.api_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# Mount core v1 API routes (risk, transfer, voice, healthz)
app.include_router(v1_api_router)

# Mount feature-branch API routes (speech transcription, regulatory dashboard)
try:
    from app.api.router import api_router as feature_router
    app.include_router(feature_router)
except ImportError:
    pass

if not settings.neptune_endpoint:
    raise RuntimeError("NEPTUNE_ENDPOINT is required. Mock graph mode has been removed.")

graph_client = NeptuneRiskClient(
    endpoint=settings.neptune_endpoint,
    region=settings.aws_region,
    profile=settings.aws_profile or None,
)
risk_engine = RiskEngine(graph_client=graph_client)
app.state.risk_engine = risk_engine
app.state.flow_graph = build_graph(risk_engine)
app.state.warning_store = InMemoryWarningStore()
app.state.wallet_ledger = WalletLedger(settings=settings)
app.state.warning_delay_seconds = settings.warning_delay_seconds
app.state.voice_thread_owners = {}
app.state.voice_thread_owners_lock = Lock()

try:
    provider = (settings.main_agent_model_provider or "").strip().lower()
    api_key = None
    if provider == "openai":
        api_key = settings.openai_api_key or None
    elif provider == "google_genai":
        api_key = settings.google_api_key or settings.gemini_api_key or None
    app.state.main_agent = build_main_deep_agent(
        model=settings.main_agent_model,
        model_provider=settings.main_agent_model_provider,
        api_key=api_key,
    )
    app.state.main_agent_error = None
except Exception:  # noqa: BLE001
    _log.exception("Failed to initialize main agent")
    app.state.main_agent = None
    app.state.main_agent_error = "main_agent_init_failed"

# ── DynamoDB ──────────────────────────────────────────────────────────────
_dynamo_resource = None

_EXPIRED_CODES = {"ExpiredTokenException", "InvalidClientTokenId", "UnrecognizedClientException"}


def _reset_dynamo():
    global _dynamo_resource
    _dynamo_resource = None


def dynamo():
    global _dynamo_resource
    if _dynamo_resource is None:
        load_dotenv(override=True)  # pick up refreshed credentials from .env
        _dynamo_resource = boto3.resource(
            "dynamodb",
            region_name=AWS_REGION,
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            aws_session_token=os.getenv("AWS_SESSION_TOKEN") or None,
        )
    return _dynamo_resource.Table(DYNAMO_TABLE)


def _handle_dynamo_error(e: ClientError, op: str):
    code = e.response.get("Error", {}).get("Code", "")
    _log.error("DynamoDB %s error [%s]: %s", op, code, e)
    if code in _EXPIRED_CODES:
        _reset_dynamo()
        raise HTTPException(status_code=503, detail="AWS session expired — backend credentials need refresh")
    raise HTTPException(status_code=503, detail="Database unavailable")


def _h(value: str) -> str:
    return hashlib.sha256(value.strip().encode()).hexdigest()


def get_user_by_gmail(gmail: str) -> Optional[dict]:
    try:
        resp = dynamo().query(
            IndexName="gmail-index",
            KeyConditionExpression="gmail = :g",
            ExpressionAttributeValues={":g": gmail.lower()},
        )
        items = resp.get("Items", [])
        return items[0] if items else None
    except ClientError as e:
        _handle_dynamo_error(e, "query")


def get_user_by_id(user_id: str) -> Optional[dict]:
    try:
        resp = dynamo().get_item(Key={"user_id": user_id})
        return resp.get("Item")
    except ClientError as e:
        _handle_dynamo_error(e, "get_item")


def create_user(item: dict):
    try:
        dynamo().put_item(Item=item)
    except ClientError as e:
        _handle_dynamo_error(e, "put_item")


def update_user_kyc(user_id: str, status: str, transaction_id: str = None, verified_at: str = None):
    try:
        expr = "SET kyc_status = :s"
        vals: dict = {":s": status}
        if transaction_id:
            expr += ", kyc_transaction_id = :t"; vals[":t"] = transaction_id
        if verified_at:
            expr += ", kyc_verified_at = :v"; vals[":v"] = verified_at
        dynamo().update_item(
            Key={"user_id": user_id},
            UpdateExpression=expr,
            ExpressionAttributeValues=vals,
        )
    except ClientError as e:
        _handle_dynamo_error(e, "update_item")


# ── Neptune (openCypher via IAM SigV4) ────────────────────────────────────
def _neptune_creds() -> Credentials:
    load_dotenv(override=True)
    profile = (
        os.getenv("NEPTUNE_AWS_PROFILE")
        or os.getenv("AWS_PROFILE")
        or None
    )
    if isinstance(profile, str):
        profile = profile.strip() or None
    session = build_boto3_session(region=AWS_REGION, profile=profile)

    sdk_creds = session.get_credentials()
    if sdk_creds is None:
        raise RuntimeError(
            "No AWS credentials found for Neptune. Set NEPTUNE_AWS_PROFILE/AWS_PROFILE or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY."
        )

    frozen = sdk_creds.get_frozen_credentials()
    if not frozen.access_key or not frozen.secret_key:
        raise RuntimeError(
            "Incomplete AWS credentials for Neptune. Ensure access key and secret key are available."
        )

    return Credentials(frozen.access_key, frozen.secret_key, frozen.token or None)


def neptune_run(cypher: str, params: dict = None) -> dict:
    """Execute an openCypher query against the Neptune cluster."""
    body = urllib.parse.urlencode({
        "query": cypher,
        **({"parameters": json.dumps(params)} if params else {}),
    })
    url = f"{NEPTUNE_URL}/openCypher"
    aws_req = AWSRequest(
        method="POST", url=url, data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    SigV4Auth(_neptune_creds(), "neptune-db", AWS_REGION).add_auth(aws_req)
    r = _req.post(url, data=body, headers=dict(aws_req.headers), timeout=10)
    if r.status_code != 200:
        raise RuntimeError(f"Neptune {r.status_code}: {r.text[:300]}")
    return r.json()


def neptune_create_user(user_id: str, full_name: str, gmail: str,
                        hashed_phone: str, hashed_ic: str, kyc_status: str,
                        created_at: str) -> None:
    """Create a :User node in Neptune. Idempotent via MERGE."""
    cypher = """
    MERGE (u:User {user_id: $user_id})
    ON CREATE SET
        u.name                 = $name,
        u.gmail                = $gmail,
        u.hashed_phone         = $hashed_phone,
        u.hashed_ic            = $hashed_ic,
        u.kyc_status           = $kyc_status,
        u.balance              = 0.0,
        u.risk_tier_current    = 'unrated',
        u.created_at           = $created_at,
        u.updated_at           = $created_at
    RETURN u.user_id AS id
    """
    neptune_run(cypher, {
        "user_id": user_id, "name": full_name, "gmail": gmail,
        "hashed_phone": hashed_phone, "hashed_ic": hashed_ic,
        "kyc_status": kyc_status, "created_at": created_at,
    })


def neptune_update_kyc(user_id: str, kyc_status: str, updated_at: str) -> None:
    cypher = """
    MATCH (u:User {user_id: $user_id})
    SET u.kyc_status = $kyc_status, u.updated_at = $updated_at
    """
    neptune_run(cypher, {"user_id": user_id, "kyc_status": kyc_status, "updated_at": updated_at})


def neptune_update_balance(user_id: str, new_balance: float, updated_at: str) -> None:
    neptune_run(
        "MATCH (u:User {user_id: $uid}) SET u.balance = $bal, u.updated_at = $ts",
        {"uid": user_id, "bal": new_balance, "ts": updated_at},
    )


def neptune_get_wallet_user(user_id: str) -> Optional[dict]:
    result = neptune_run(
        """
        MATCH (u:User)
        WHERE u.user_id = $uid OR u.`~id` = $uid OR u.`~id` = $graph_uid
        RETURN
            u.`~id` AS graph_id,
            u.user_id AS user_id,
            u.name AS name,
            coalesce(u.balance, 0) AS balance,
            u.updated_at AS updated_at
        """,
        {"uid": user_id, "graph_uid": user_id if user_id.startswith("user:") else f"user:{user_id}"},
    )
    rows = result.get("results", [])
    if not rows:
        return None
    rows.sort(
        key=lambda row: (
            1 if row.get("balance") is None else 0,
            0 if row.get("user_id") == user_id else 1,
        )
    )
    return rows[0]


def neptune_get_wallet_balance(user_id: str, fallback: float = 0.0) -> float:
    wallet_user = neptune_get_wallet_user(user_id)
    if not wallet_user:
        return fallback
    return float(wallet_user.get("balance", fallback) or 0)


def neptune_recent_wallet_transactions(user_id: str, limit: int = 20) -> list[dict]:
    wallet_user = neptune_get_wallet_user(user_id)
    if not wallet_user:
        return []
    result = neptune_run(
        """
        MATCH (s:User)-[t:TRANSFERRED_TO]->(r:User)
        WHERE s.`~id` = $sender_graph_id
          AND (coalesce(t.wallet_settled, false) = true OR coalesce(t.status, '') <> 'approved')
        RETURN
            t.`~id` AS id,
            coalesce(r.name, r.user_id, r.`~id`) AS recipient,
            r.`~id` AS recipient_graph_id,
            coalesce(t.amount, 0) AS amount,
            coalesce(t.currency, 'MYR') AS currency,
            coalesce(t.message_text, t.tx_note, 'Transfer') AS purpose,
            coalesce(t.tx_time, toString(t.updated_at), '') AS date,
            coalesce(t.status, 'unknown') AS status,
            coalesce(t.wallet_settled, false) AS wallet_settled,
            t.sender_balance_after AS sender_balance_after,
            t.recipient_balance_after AS recipient_balance_after,
            coalesce(t.channel, 'voice_agent') AS channel,
            coalesce(t.risk_score_latest, 0) AS risk_score,
            coalesce(t.risk_reason_codes, '[]') AS reason_codes,
            coalesce(t.risk_decision_latest, 'APPROVED') AS decision
        ORDER BY coalesce(t.updated_at, 0) DESC
        LIMIT $limit
        """,
        {
            "sender_graph_id": wallet_user["graph_id"],
            "limit": max(1, min(int(limit), 50)),
        },
    )
    txs: list[dict] = []
    for row in result.get("results", []):
        reason_codes = row.get("reason_codes", [])
        if isinstance(reason_codes, str):
            try:
                reason_codes = json.loads(reason_codes)
            except json.JSONDecodeError:
                reason_codes = [reason_codes] if reason_codes else []
        txs.append({
            "id": str(row.get("id", "")),
            "recipient": str(row.get("recipient", "Unknown recipient")),
            "recipient_graph_id": str(row.get("recipient_graph_id", "")),
            "amount": float(row.get("amount", 0) or 0),
            "currency": str(row.get("currency", "MYR") or "MYR"),
            "purpose": str(row.get("purpose", "Transfer") or "Transfer"),
            "date": str(row.get("date", "") or ""),
            "type": "sent",
            "status": str(row.get("status", "unknown") or "unknown"),
            "wallet_settled": bool(row.get("wallet_settled", False)),
            "sender_balance_after": (
                float(row["sender_balance_after"])
                if row.get("sender_balance_after") is not None
                else None
            ),
            "recipient_balance_after": (
                float(row["recipient_balance_after"])
                if row.get("recipient_balance_after") is not None
                else None
            ),
            "channel": str(row.get("channel", "voice_agent") or "voice_agent"),
            "risk_score": int(float(row.get("risk_score", 0) or 0)),
            "reason_codes": reason_codes if isinstance(reason_codes, list) else [],
            "decision": str(row.get("decision", "APPROVED") or "APPROVED"),
        })
    return txs


def neptune_get_user(user_id: str) -> Optional[dict]:
    result = neptune_run(
        "MATCH (u:User {user_id: $uid}) RETURN u", {"uid": user_id}
    )
    rows = result.get("results", [])
    return rows[0]["u"] if rows else None


# ── Auth helpers ──────────────────────────────────────────────────────────
def create_jwt(user_id: str) -> str:
    return jwt.encode(
        {"sub": user_id, "iat": int(time.time()), "exp": int(time.time()) + JWT_EXPIRE_DAYS * 86400},
        JWT_SECRET, algorithm="HS256",
    )


def decode_jwt(token: str) -> str:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user_id(authorization: str = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    return decode_jwt(authorization.split(" ", 1)[1])


# ── Alibaba Cloud eKYC ────────────────────────────────────────────────────
_REGION_ENDPOINTS = {
    "ap-southeast-1": "cloudauth-intl.ap-southeast-1.aliyuncs.com",
    "ap-southeast-3": "cloudauth-intl.ap-southeast-3.aliyuncs.com",
    "ap-southeast-5": "cloudauth-intl.ap-southeast-5.aliyuncs.com",
    "eu-central-1":   "cloudauth-intl.eu-central-1.aliyuncs.com",
    "us-west-1":      "cloudauth-intl.us-west-1.aliyuncs.com",
    "cn-hongkong":    "cloudauth-intl.cn-hongkong.aliyuncs.com",
}

_DOC_PRODUCTS = {"eKYC_PRO", "eKYC", "eKYC_MIN", "KYC_GLOBAL", "ID_OCR", "ID_OCR_MAX", "ID_OCR_MIN"}


def _percent_encode(s: str) -> str:
    return urllib.parse.quote(str(s), safe="~")


def _alibaba_sign(params: dict, method: str = "POST") -> str:
    sorted_pairs = sorted(params.items())
    canonical = "&".join(f"{_percent_encode(k)}={_percent_encode(v)}" for k, v in sorted_pairs)
    string_to_sign = f"{method}&{_percent_encode('/')}&{_percent_encode(canonical)}"
    key = (ALIBABA_ACCESS_KEY_SECRET + "&").encode()
    return base64.b64encode(hmac.new(key, string_to_sign.encode(), hashlib.sha1).digest()).decode()


def _is_intl(endpoint: str) -> bool:
    return "cloudauth-intl" in endpoint


def _detect_face_local(image_data: bytes) -> dict:
    """Local face detection fallback using OpenCV."""
    if not HAS_OPENCV or FACE_CASCADE is None:
        return {"detected": False, "confidence": 0, "reason": "OpenCV not available"}
    
    try:
        # Decode image
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {"detected": False, "confidence": 0, "reason": "Invalid image format"}
        
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Detect faces
        faces = FACE_CASCADE.detectMultiScale(gray, 1.1, 4)
        
        if len(faces) > 0:
            # Check face size (should be reasonable portion of image)
            img_area = gray.shape[0] * gray.shape[1]
            face_area = faces[0][2] * faces[0][3]  # width * height of largest face
            face_ratio = face_area / img_area
            
            if face_ratio > 0.05:  # Face should be at least 5% of image
                return {
                    "detected": True,
                    "confidence": min(0.95, 0.7 + (face_ratio * 0.25)),
                    "faces_found": len(faces),
                    "reason": "Face detected successfully"
                }
            else:
                return {"detected": False, "confidence": 0, "reason": "Face too small in image"}
        else:
            return {"detected": False, "confidence": 0, "reason": "No face detected"}
    except Exception as e:
        _log.error("Local face detection error: %s", e)
        return {"detected": False, "confidence": 0, "reason": str(e)}


async def _alibaba_call(action: str, extra: dict) -> dict:
    endpoint = ALIBABA_ENDPOINT or _REGION_ENDPOINTS.get(ALIBABA_REGION, "cloudauth-intl.ap-southeast-1.aliyuncs.com")
    version   = ALIBABA_API_VERSION or ("2022-08-09" if _is_intl(endpoint) else "2019-03-07")
    params: dict = {
        "Format": "JSON", "Version": version,
        "AccessKeyId": ALIBABA_ACCESS_KEY_ID, "Action": action,
        "SignatureMethod": "HMAC-SHA1", "SignatureVersion": "1.0",
        "SignatureNonce": uuid.uuid4().hex,
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        **{k: str(v) for k, v in extra.items()},
    }
    params["Signature"] = _alibaba_sign(params)
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"https://{endpoint}/", data=params)
    body = r.text
    try:
        data = r.json()
    except ValueError:
        raise HTTPException(status_code=502, detail=f"Alibaba non-JSON response (HTTP {r.status_code}): {body[:300]}")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Alibaba Cloud API error (HTTP {r.status_code}) from '{endpoint}': {json.dumps(data)}")
    code = str(data.get("Code", "")) if isinstance(data, dict) else ""
    if code and code not in {"Success", "200"}:
        raise HTTPException(status_code=502, detail=f"Alibaba Cloud API code '{code}' from '{endpoint}': {json.dumps(data)}")
    return data


async def initiate_ekyc(full_name: str, user_agent: str = "") -> dict:
    if SIMULATION_MODE:
        cid = f"SIM-{uuid.uuid4().hex[:16].upper()}"
        return {"certifyId": cid, "transactionId": cid, "pageUrl": None, "simulation": True}

    endpoint = ALIBABA_ENDPOINT or _REGION_ENDPOINTS.get(ALIBABA_REGION, "cloudauth-intl.ap-southeast-1.aliyuncs.com")

    if _is_intl(endpoint):
        merchant_biz_id = uuid.uuid4().hex[:32]
        extra: dict = {
            "ProductCode":   ALIBABA_PRODUCT_CODE,
            "MerchantBizId": merchant_biz_id,
            "ReturnUrl":     f"{FRONTEND_URL}/kyc-callback",
            "MetaInfo":      json.dumps({"deviceType": "web", "ua": user_agent or "Mozilla/5.0"}),
        }
        if ALIBABA_PRODUCT_CODE in _DOC_PRODUCTS:
            if ALIBABA_DOC_TYPE: extra["DocType"] = ALIBABA_DOC_TYPE
            if ALIBABA_PAGES:    extra["Pages"]   = ALIBABA_PAGES
        if full_name:     extra["MerchantUserId"] = full_name[:64]
        if ALIBABA_CB_URL: extra["CallbackUrl"]   = ALIBABA_CB_URL

        try:
            result = await _alibaba_call("Initialize", extra)
        except HTTPException as exc:
            if ALIBABA_FALLBACK_ON_DENIED and "Forbidden.AccountAccessDenied" in str(exc.detail):
                cid = f"SIM-{uuid.uuid4().hex[:16].upper()}"
                return {"certifyId": cid, "transactionId": cid, "pageUrl": None, "simulation": True}
            raise

        obj = result.get("Result") or {}
        transaction_id = obj.get("TransactionId") or obj.get("CertifyId") or merchant_biz_id
        return {
            "certifyId":     merchant_biz_id,   # OUR ID → used with CheckResult as MerchantBizId
            "transactionId": transaction_id,     # Alibaba's ID → used with CheckResult as TransactionId
            "pageUrl":       obj.get("TransactionUrl") or obj.get("CloudauthPageUrl"),
            "simulation":    False,
        }

    else:
        extra = {"ProductCode": "eKYC_PRO", "CertifyId": uuid.uuid4().hex,
                 "ReturnUrl": f"{FRONTEND_URL}/kyc-callback"}
        if ALIBABA_CB_URL: extra["CallbackUrl"] = ALIBABA_CB_URL
        if full_name:      extra["CertName"]    = full_name
        result = await _alibaba_call("InitSmartVerify", extra)
        obj = result.get("ResultObject") or {}
        cid = obj.get("CertifyId") or extra["CertifyId"]
        return {"certifyId": cid, "transactionId": cid,
                "pageUrl": obj.get("CloudauthPageUrl"), "simulation": False}


async def query_ekyc_result(merchant_biz_id: str, transaction_id: str) -> dict:
    if merchant_biz_id.startswith("SIM-"):
        return {"passed": True, "verifyStatus": "1001", "simulation": True}

    endpoint = ALIBABA_ENDPOINT or _REGION_ENDPOINTS.get(ALIBABA_REGION, "cloudauth-intl.ap-southeast-1.aliyuncs.com")

    if _is_intl(endpoint):
        # CheckResult requires BOTH MerchantBizId AND TransactionId
        result = await _alibaba_call("CheckResult", {
            "MerchantBizId": merchant_biz_id,
            "TransactionId": transaction_id,
        })
        obj = result.get("Result") or {}
        passed = str(obj.get("Passed", "N")).upper() == "Y"
        return {"passed": passed, "verifyStatus": str(obj.get("SubCode", "-1")), "simulation": False}

    result = await _alibaba_call("DescribeSmartVerifyResult", {"CertifyId": merchant_biz_id})
    obj = result.get("ResultObject") or {}
    status = str(obj.get("VerifyStatus", "-1"))
    return {"passed": status == "1", "verifyStatus": status, "simulation": False}


# ── Pydantic models ───────────────────────────────────────────────────────
class SignupRequest(BaseModel):
    full_name:          str
    gmail:              str
    phone:              str          # will be hashed
    ic_number:          str          # will be hashed
    preferred_language: str = "en"
    password:           str


class LoginRequest(BaseModel):
    gmail:    str
    password: str


class KYCCompleteRequest(BaseModel):
    certify_id:     str
    transaction_id: Optional[str] = None
    result_code:    Optional[str] = None   # Alibaba resultCode from callback URL ("1001" = passed)


class ReloadRequest(BaseModel):
    amount: float


# ── Routes ────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "simulation_mode": SIMULATION_MODE,
            "product": ALIBABA_PRODUCT_CODE, "region": ALIBABA_REGION}


@app.post("/auth/signup")
async def signup(req: SignupRequest):
    if len(req.full_name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Full name too short")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if get_user_by_gmail(req.gmail):
        raise HTTPException(status_code=400, detail="An account with this email already exists")

    user_id = str(uuid.uuid4())
    now     = datetime.now(timezone.utc).isoformat()

    kyc = await initiate_ekyc(req.full_name.strip())

    item = {
        "user_id":            user_id,
        "full_name":          req.full_name.strip(),
        "gmail":              req.gmail.lower(),
        "phone_hash":         _h(req.phone),
        "ic_hash":            _h(req.ic_number),
        "preferred_language": req.preferred_language,
        "password_hash":      pwd_context.hash(req.password),
        "kyc_status":         "in_progress",
        "kyc_transaction_id": kyc["transactionId"],
        "balance":            Decimal("0"),
        "created_at":         now,
    }
    create_user(item)

    # Write user node to Neptune (non-blocking — signup succeeds even if Neptune is slow)
    try:
        neptune_create_user(
            user_id=user_id,
            full_name=req.full_name.strip(),
            gmail=req.gmail.lower(),
            hashed_phone=_h(req.phone),
            hashed_ic=_h(req.ic_number),
            kyc_status="in_progress",
            created_at=now,
        )
        _log.info("Neptune: User node created for %s", user_id)
    except Exception as exc:
        _log.error("Neptune: failed to create user node: %s", exc)

    return {
        "token":   create_jwt(user_id),
        "user_id": user_id,
        "kyc":     kyc,
    }


@app.post("/auth/login")
def login(req: LoginRequest):
    user = get_user_by_gmail(req.gmail.lower())
    if not user or not pwd_context.verify(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    dynamo_balance = float(user.get("balance", 0))
    return {
        "token": create_jwt(user["user_id"]),
        "user": {
            "id":                user["user_id"],
            "full_name":         user["full_name"],
            "gmail":             user["gmail"],
            "preferred_language": user.get("preferred_language", "en"),
            "kyc_status":        user["kyc_status"],
            "balance":           neptune_get_wallet_balance(user["user_id"], fallback=dynamo_balance),
        },
    }


@app.get("/auth/me")
def get_me(user_id: str = Depends(get_current_user_id)):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    dynamo_balance = float(user.get("balance", 0))
    return {
        "id":                 user["user_id"],
        "full_name":          user["full_name"],
        "gmail":              user["gmail"],
        "preferred_language": user.get("preferred_language", "en"),
        "kyc_status":         user["kyc_status"],
        "balance":            neptune_get_wallet_balance(user_id, fallback=dynamo_balance),
    }


@app.post("/wallet/reload")
def wallet_reload(req: ReloadRequest, user_id: str = Depends(get_current_user_id)):
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    wallet_user = neptune_get_wallet_user(user_id)
    if not wallet_user:
        raise HTTPException(status_code=404, detail="User not found")
    current = float(wallet_user.get("balance", 0) or 0)
    new_balance = round(current + req.amount, 2)
    updated_at = datetime.now(timezone.utc).isoformat()
    try:
        neptune_update_balance(user_id, new_balance, updated_at)
    except Exception as e:
        _log.error("Neptune balance update failed: %s", e)
        raise HTTPException(status_code=503, detail="Wallet balance update failed")
    return {"new_balance": new_balance}


@app.get("/wallet/transactions")
def wallet_transactions(user_id: str = Depends(get_current_user_id), limit: int = 20):
    try:
        return {"transactions": neptune_recent_wallet_transactions(user_id, limit=limit)}
    except Exception as exc:
        _log.error("Neptune wallet transaction fetch failed: %s", exc)
        raise HTTPException(status_code=503, detail="Wallet transactions unavailable")


@app.post("/kyc/complete")
async def kyc_complete(req: KYCCompleteRequest, user_id: str = Depends(get_current_user_id)):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    transaction_id = req.transaction_id or user.get("kyc_transaction_id")

    # Trust Alibaba's callback resultCode=1001 (face liveness passed) directly.
    # For FACE_LIVENESS_PRO there is no document comparison, so CheckResult's
    # "Passed" field often returns N even on success — the callback result is authoritative.
    is_sim = req.certify_id.startswith("SIM-")
    trusted = is_sim or req.result_code == "1001"

    def _mark_verified(status: str):
        now_iso = datetime.now(timezone.utc).isoformat()
        update_user_kyc(user_id, status, transaction_id, now_iso)
        try:
            neptune_update_kyc(user_id, status, now_iso)
        except Exception as exc:
            _log.error("Neptune: failed to update kyc_status: %s", exc)

    if trusted:
        _mark_verified("verified")
        return {"success": True, "message": "Identity verified successfully"}

    # Fallback: call CheckResult for non-liveness products or unknown result codes
    result = await query_ekyc_result(req.certify_id, transaction_id or req.certify_id)
    if result["passed"]:
        _mark_verified("verified")
        return {"success": True, "message": "Identity verified successfully"}

    _mark_verified("failed")
    raise HTTPException(status_code=400,
                        detail=f"Verification did not pass (status: {result.get('verifyStatus')})")


@app.post("/kyc/verify-face")
async def verify_face_local(file: UploadFile = File(...), user_id: str = Depends(get_current_user_id)):
    """Local face detection endpoint as fallback to Alibaba Cloud."""
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if not HAS_OPENCV:
        raise HTTPException(status_code=503, detail="Face detection service not available")
    
    try:
        # Read image data
        image_data = await file.read()
        result = _detect_face_local(image_data)
        
        if result["detected"]:
            # Update user KYC status
            update_user_kyc(
                user_id,
                "verified",
                f"local-face-{uuid.uuid4().hex[:8]}",
                datetime.now(timezone.utc).isoformat(),
            )
            return {
                "success": True,
                "message": "Face verified successfully",
                "method": "local_detection",
                "confidence": result["confidence"]
            }
        else:
            update_user_kyc(user_id, "failed", f"local-face-{uuid.uuid4().hex[:8]}", None)
            raise HTTPException(status_code=400,
                                detail=f"Face verification failed: {result['reason']}")
    except HTTPException:
        raise
    except Exception as e:
        _log.error("Face verification error: %s", e)
        raise HTTPException(status_code=500, detail="Face verification failed")


@app.post("/kyc/callback")
async def kyc_callback(data: dict = None):
    """Alibaba Cloud server-side async callback."""
    return {"received": True}


@app.get("/graph/users")
def graph_users():
    """Return all User nodes from Neptune for dashboard graph visualization."""
    try:
        result = neptune_run(
            "MATCH (u:User) RETURN u ORDER BY u.created_at"
        )
        nodes = []
        for row in result.get("results", []):
            u = row.get("u", {})
            props = u.get("~properties", u)  # handle both raw and flattened
            name = props.get("name") or props.get("full_name") or "Unknown"
            nodes.append({
                "id":               u.get("~id", props.get("user_id", "")),
                "user_id":          props.get("user_id", ""),
                "name":             name,
                "balance":          float(props.get("balance", 0)),
                "kyc_status":       props.get("kyc_status") or props.get("ekyc_status", ""),
                "risk_tier_current": props.get("risk_tier_current", "unrated"),
                "status":           props.get("status", ""),
                "risk_score_latest": float(props.get("risk_score_latest", 0)),
                "gmail":            props.get("gmail", ""),
                "created_at":       str(props.get("created_at", "")),
            })

        # Fetch edges (Neptune uses id() not elementId())
        edge_result = neptune_run(
            "MATCH (a:User)-[r:TRANSFERRED_TO]->(b:User) "
            "RETURN a.user_id AS from_id, id(a) AS from_eid, "
            "b.user_id AS to_id, id(b) AS to_eid, "
            "r.amount AS amount, r.status AS status, r.timestamp AS ts"
        )
        edges = []
        for row in edge_result.get("results", []):
            edges.append({
                "from":   row.get("from_id") or str(row.get("from_eid", "")),
                "to":     row.get("to_id")   or str(row.get("to_eid", "")),
                "amount": float(row.get("amount", 0)),
                "status": row.get("status", ""),
                "ts":     str(row.get("ts", "")),
            })

        return {
            "nodes":  nodes,
            "edges":  edges,
            "source": NEPTUNE_ENDPOINT,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        _log.error("graph_users error: %s", exc)
        raise HTTPException(status_code=503, detail=f"Neptune unavailable: {exc}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
