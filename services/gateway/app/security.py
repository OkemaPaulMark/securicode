"""Password hashing (PBKDF2-SHA256, stdlib) and JWT issue/verify."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
import uuid

import jwt

ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt_b64, hash_b64 = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(iterations))
        return hmac.compare_digest(dk, base64.b64decode(hash_b64))
    except (ValueError, TypeError):
        return False


def create_token(*, user_id: str, username: str, role: str, scope: str,
                 secret: str, issuer: str, ttl: int) -> tuple[str, str]:
    """Returns (jti, encoded token)."""
    now = int(time.time())
    jti = str(uuid.uuid4())
    claims = {"sub": user_id, "username": username, "role": role, "scope": scope,
              "jti": jti, "iss": issuer, "iat": now, "exp": now + ttl}
    return jti, jwt.encode(claims, secret, algorithm="HS256")


def decode_token(token: str, *, secret: str, issuer: str) -> dict:
    return jwt.decode(token, secret, algorithms=["HS256"], issuer=issuer,
                      options={"require": ["exp", "sub", "jti"]})
