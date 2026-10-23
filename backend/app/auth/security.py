from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Any, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import SECRET_KEY
from app.settings_store import SettingsStore

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"
ACCESS_TOKEN_DEFAULT_MINUTES = 60
REFRESH_TOKEN_DAYS = 30


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: Optional[str]) -> bool:
    if not hashed:
        return False
    return pwd_context.verify(plain, hashed)


def _secret_key() -> str:
    return SECRET_KEY


def create_access_token(subject: int, expires_minutes: Optional[int] = None) -> str:
    if expires_minutes is None:
        expires_minutes = SettingsStore.get_int("access_token_expire_minutes", ACCESS_TOKEN_DEFAULT_MINUTES)
        # Prefer shorter access tokens; cap very long legacy defaults for access
        if expires_minutes > 24 * 60:
            expires_minutes = ACCESS_TOKEN_DEFAULT_MINUTES
    expire = datetime.utcnow() + timedelta(minutes=expires_minutes)
    payload = {"sub": str(subject), "exp": expire, "type": "access"}
    return jwt.encode(payload, _secret_key(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, _secret_key(), algorithms=[ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid token") from exc
    if payload.get("type") != "access":
        raise ValueError("Invalid token type")
    return payload


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def refresh_token_expiry() -> datetime:
    return datetime.utcnow() + timedelta(days=REFRESH_TOKEN_DAYS)


def generate_invite_token() -> str:
    return secrets.token_urlsafe(32)
