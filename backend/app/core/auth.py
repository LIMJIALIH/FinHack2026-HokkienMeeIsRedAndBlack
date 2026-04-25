import os

import jwt
from fastapi import Header, HTTPException


JWT_SECRET = os.getenv("JWT_SECRET_KEY", "tng-guardian-dev-secret-change-me")


def decode_jwt(token: str) -> str:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])["sub"]
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Session expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    return decode_jwt(token)
