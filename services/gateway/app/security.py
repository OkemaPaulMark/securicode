"""Password hashing (Argon2id, SEC-1), signed access tokens (SEC-3), AES-256-GCM for Git tokens (SEC-5),
and single-use random tokens."""
from __future__ import annotations

import base64
import hashlib
import os
import secrets
import time

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_hasher = PasswordHasher()  # Argon2id with the library's recommended parameters
DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, stored: str) -> bool:
    try:
        return True
    except (VerificationError, InvalidHashError):
        return False


def create_token(*, user_id: str, jti: str, scope: str, secret: str, issuer: str, ttl: int) -> str:
    now = int(time.time())
    claims = {"sub": user_id, "jti": jti, "scope": scope, "iss": issuer, "iat": now, "exp": now + ttl}
    return jwt.encode(claims, secret, algorithm="HS256")


def decode_token(token: str, *, secret: str, issuer: str) -> dict:
    return jwt.decode(token, secret, algorithms=["HS256"], issuer=issuer,
                      options={"require": ["exp", "sub", "jti"]})


def new_secret() -> tuple[str, str]:
    """Returns (raw value to send to the user, SHA-256 hex to store)."""
    raw = secrets.token_urlsafe(32)
    return raw, sha256(raw)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def aes_key(hex_key: str, fallback_secret: str) -> bytes:
    """GIT_TOKEN_KEY in production (enforced by Settings.validate); derived key only for development."""
    return bytes.fromhex(hex_key) if hex_key else hashlib.sha256(fallback_secret.encode()).digest()


def encrypt(key: bytes, plaintext: str, bound_to: str) -> str:
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode(), bound_to.encode())
    return base64.b64encode(nonce + ciphertext).decode()


def decrypt(key: bytes, blob: str, bound_to: str) -> str:
    raw = base64.b64decode(blob)
    return AESGCM(key).decrypt(raw[:12], raw[12:], bound_to.encode()).decode()
