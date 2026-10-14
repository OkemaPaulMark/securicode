"""Shared request dependencies: DB session, authenticated principal, admin check, audit helper."""
from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import ApiSession, AuditEntry, Setting, User, utcnow
from .security import decode_token

bearer = HTTPBearer(auto_error=False)
LAST_SEEN_WRITE_INTERVAL = 60  # seconds; avoids a DB write on every request


@dataclass
class Principal:
    id: str
    email: str
    name: str
    role: str
    email_verified: bool
    scope: str
    jti: str


def get_db(request: Request):
    db = request.app.state.sessionmaker()
    try:
        yield db
    finally:
        db.close()


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def audit(db, action: str, *, user_id: str | None = None, actor: str = "", target: str = "",
          detail: str = "", ip: str = "") -> None:
    db.add(AuditEntry(action=action, user_id=user_id, actor=actor, target=target, detail=detail, ip=ip))
    db.commit()


def unauthorized(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"})


def get_principal(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                  db=Depends(get_db)) -> Principal:
    if creds is None:
        raise unauthorized("Missing bearer token")
    s = request.app.state.settings
    try:
        claims = decode_token(creds.credentials, secret=s.jwt_secret, issuer=s.jwt_issuer)
    except jwt.ExpiredSignatureError:
        raise unauthorized("Token expired")
    except jwt.PyJWTError:
        raise unauthorized("Invalid token")

    session = db.get(ApiSession, claims["jti"])
    if session is None or session.revoked_at is not None:
        raise unauthorized("Session revoked")
    now = utcnow()
    idle = (now - session.last_seen_at).total_seconds()
    if idle > s.idle_timeout_seconds:  # SEC-3: 60 minutes of inactivity
        session.revoked_at = now
        db.commit()
        raise unauthorized("Session expired due to inactivity")

    user = db.get(User, claims["sub"])
    if user is None or not user.is_active:
        raise unauthorized("Account not found or deactivated")
    if idle > LAST_SEEN_WRITE_INTERVAL:
        session.last_seen_at = now
        db.commit()
    return Principal(id=user.id, email=user.email, name=user.name, role=user.role,
                     email_verified=user.email_verified, scope=session.scope, jti=session.jti)


def require_admin(p: Principal = Depends(get_principal)) -> Principal:
    if p.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator role required")
    return p


def daily_assessment_limit(db, settings) -> int:
    row = db.get(Setting, "daily_assessment_limit")
    return int(row.value) if row else settings.daily_assessment_limit
