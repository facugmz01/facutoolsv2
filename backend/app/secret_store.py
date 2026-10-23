"""Encryption helpers for secrets stored in the database."""

from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken

ENCRYPTED_PREFIX = "fernet:v1:"


def _fernet() -> Fernet:
    key = os.environ.get("CLIENT_SECRET_ENCRYPTION_KEY", "").strip()
    if not key:
        raise RuntimeError("CLIENT_SECRET_ENCRYPTION_KEY environment variable is required")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise RuntimeError("CLIENT_SECRET_ENCRYPTION_KEY must be a valid Fernet key") from exc


def encrypt_secret(value: str) -> str:
    return ENCRYPTED_PREFIX + _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str:
    if not value.startswith(ENCRYPTED_PREFIX):
        raise RuntimeError("Unencrypted client secret found; migrate it before enabling SSO")
    try:
        return _fernet().decrypt(value[len(ENCRYPTED_PREFIX):].encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError, ValueError, UnicodeEncodeError) as exc:
        raise RuntimeError("Unable to decrypt stored client secret") from exc