"""Secrets handling for the email import feature.

A single EMAIL_SECRET_KEY (a Fernet key) is used to:
  - encrypt Gmail refresh tokens at rest, and
  - derive an HMAC key for signing OAuth state and scan proposals.

Generate one with:
  .venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException


def _secret_key() -> bytes:
    key = os.getenv("EMAIL_SECRET_KEY", "")
    if not key:
        raise HTTPException(status_code=500, detail="EMAIL_SECRET_KEY not configured on server")
    return key.encode()


def _fernet() -> Fernet:
    try:
        return Fernet(_secret_key())
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="EMAIL_SECRET_KEY is not a valid Fernet key") from exc


def _hmac_key() -> bytes:
    # Separate key for signing so the encryption key is never used directly as a MAC key.
    return hashlib.sha256(b"get-dressed/email-signing/" + _secret_key()).digest()


def encrypt_token(token: str) -> str:
    return _fernet().encrypt(token.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise HTTPException(status_code=500, detail="Stored email token could not be decrypted") from exc


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def sign(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    mac = hmac.new(_hmac_key(), body, hashlib.sha256).digest()
    return f"{_b64(body)}.{_b64(mac)}"


def verify(token: str) -> dict[str, Any]:
    """Return the signed payload, or raise 400 if the signature or expiry is invalid."""
    try:
        body_part, mac_part = token.split(".", 1)
        body = _unb64(body_part)
        mac = _unb64(mac_part)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Malformed signed value") from exc

    expected = hmac.new(_hmac_key(), body, hashlib.sha256).digest()
    if not hmac.compare_digest(mac, expected):
        raise HTTPException(status_code=400, detail="Invalid signature")

    payload = json.loads(body)
    exp = payload.get("exp")
    if exp is not None and time.time() > exp:
        raise HTTPException(status_code=400, detail="Signed value has expired")
    return payload
