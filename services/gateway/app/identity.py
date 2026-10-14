"""Identity endpoints under /api/auth/ — register, login (matches the VS Code extension's
api.login contract), logout, current user, admin user management."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from .db import ROLES, RevokedToken, User
from .security import create_token, decode_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["identity"])
bearer = HTTPBearer(auto_error=False)


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=150, pattern=r"^[A-Za-z0-9_.-]+$")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(default="", max_length=255)


class LoginIn(BaseModel):
    username: str = Field(description="username or email")
    password: str
    name: str = Field(default="", max_length=100, description="label for this token, e.g. 'VS Code'")
    scope: Literal["web", "vscode", "cli", "ci"] = "web"


class TokenIssued(BaseModel):
    id: str
    name: str
    scope: str
    token: str
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    id: str
    username: str
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class RoleIn(BaseModel):
    role: str


def get_db(request: Request):
    db = request.app.state.sessionmaker()
    try:
        yield db
    finally:
        db.close()


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"})


def current_claims(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                   db=Depends(get_db)) -> dict:
    if creds is None:
        raise _unauthorized("Missing bearer token")
    s = request.app.state.settings
    try:
        claims = decode_token(creds.credentials, secret=s.jwt_secret, issuer=s.jwt_issuer)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Token expired")
    except jwt.PyJWTError:
        raise _unauthorized("Invalid token")
    if db.get(RevokedToken, claims["jti"]) is not None:
        raise _unauthorized("Token revoked")
    return claims


def current_user(claims: dict = Depends(current_claims), db=Depends(get_db)) -> User:
    user = db.get(User, claims["sub"])
    if user is None or not user.is_active:
        raise _unauthorized("User not found or disabled")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    return user


@router.post("/register/", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, db=Depends(get_db)):
    user = User(username=body.username.lower(), email=body.email.lower(), full_name=body.full_name,
                password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Username or email already registered")
    return user


@router.post("/login/", response_model=TokenIssued)
def login(body: LoginIn, request: Request, db=Depends(get_db)):
    ident = body.username.strip().lower()
    user = db.scalar(select(User).where(or_(User.username == ident, User.email == ident)))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    s = request.app.state.settings
    jti, token = create_token(user_id=user.id, username=user.username, role=user.role, scope=body.scope,
                              secret=s.jwt_secret, issuer=s.jwt_issuer, ttl=s.token_ttl_seconds)
    return TokenIssued(id=jti, name=body.name or body.scope, scope=body.scope, token=token,
                       access_token=token, expires_in=s.token_ttl_seconds)


@router.post("/logout/", status_code=status.HTTP_204_NO_CONTENT)
def logout(claims: dict = Depends(current_claims), db=Depends(get_db)):
    db.add(RevokedToken(jti=claims["jti"]))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.get("/users/", response_model=list[UserOut])
def list_users(_: User = Depends(require_admin), db=Depends(get_db)):
    return list(db.scalars(select(User).order_by(User.created_at)))


@router.patch("/users/{user_id}/role/", response_model=UserOut)
def set_role(user_id: str, body: RoleIn, _: User = Depends(require_admin), db=Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"role must be one of {ROLES}")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    user.role = body.role
    db.commit()
    return user


def bootstrap_admin(sessionmaker, username: str, email: str, password: str) -> None:
    """Create the first admin from ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD if missing."""
    if not email or not password:
        return
    with sessionmaker() as db:
        exists = db.scalar(select(User).where(or_(User.username == username.lower(), User.email == email.lower())))
        if exists is None:
            db.add(User(username=username.lower(), email=email.lower(), full_name="Administrator",
                        password_hash=hash_password(password), role="admin"))
            db.commit()
