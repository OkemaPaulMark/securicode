"""Identity: /api/auth/... (JSON) and /auth/... (small HTML pages for VS Code sign-in and password reset).
SRS 4.1 AUTH-1..AUTH-9, SEC-1..SEC-5, AUDT-1."""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Literal
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import AliasChoices, BaseModel, EmailStr, Field
from sqlalchemy import delete, select, update

from . import pages as views
from .db import ApiSession, AuditEntry, GitToken, OneTimeToken, User, utcnow
from .deps import Principal, audit, client_ip, get_db, get_principal
from .mailer import send_mail
from .security import DUMMY_HASH, aes_key, create_token, encrypt, hash_password, new_secret, sha256, verify_password

router = APIRouter(prefix="/api/auth", tags=["identity"])
pages = APIRouter(tags=["identity pages"], include_in_schema=False)

VERIFY_TTL = timedelta(hours=24)
RESET_TTL = timedelta(minutes=30)          # AUTH-5
VSCODE_CODE_TTL = timedelta(minutes=2)
GENERIC_LOGIN_ERROR = "Invalid e-mail or password"  # AUTH-3: does not say which one was wrong


# ---------------------------------------------------------------- schemas
class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(max_length=128)


class LoginIn(BaseModel):
    email: str = Field(validation_alias=AliasChoices("email", "username"))
    password: str
    name: str = Field(default="", max_length=100, description="label for this token, e.g. 'VS Code'")
    scope: Literal["web", "vscode", "cli", "ci"] = "web"


class TokenIssued(BaseModel):
    """Superset of the VS Code extension's TokenIssued type (apps/vscode-extension/src/api-client/types.ts)."""
    id: str
    name: str
    scope: str
    token: str
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    idle_timeout: int


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    is_active: bool
    email_verified: bool
    created_at: object

    model_config = {"from_attributes": True}


class PasswordIn(BaseModel):
    password: str


class ResetRequestIn(BaseModel):
    email: EmailStr


class ResetConfirmIn(BaseModel):
    token: str
    new_password: str = Field(max_length=128)


class CodeIn(BaseModel):
    code: str


class GitTokenIn(BaseModel):
    provider: Literal["github", "gitlab"]
    token: str = Field(min_length=8, max_length=500)
    label: str = Field(default="", max_length=100)
    host: str = Field(default="", max_length=255, description="GitLab host, e.g. gitlab.cranecloud.io")


class GitTokenOut(BaseModel):
    id: str
    provider: str
    host: str
    label: str
    masked: str
    created_at: object


class AuditOut(BaseModel):
    at: object
    actor: str
    action: str
    target: str
    detail: str
    ip: str

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------- helpers
def _settings(request: Request):
    return request.app.state.settings


def _check_password_policy(settings, password: str) -> None:
    if len(password) < settings.min_password_length:  # SEC-1
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Password must be at least {settings.min_password_length} characters")


def _one_time(db, user_id: str, purpose: str, ttl: timedelta) -> str:
    raw, digest = new_secret()
    db.add(OneTimeToken(token_hash=digest, user_id=user_id, purpose=purpose, expires_at=utcnow() + ttl))
    db.commit()
    return raw


def _consume(db, raw: str, purpose: str) -> OneTimeToken | None:
    row = db.get(OneTimeToken, sha256(raw))
    if row is None or row.purpose != purpose or row.used_at is not None or row.expires_at < utcnow():
        return None
    row.used_at = utcnow()
    db.commit()
    return row


def _mail(request: Request, tasks: BackgroundTasks, to: str, subject: str, body: str) -> None:
    tasks.add_task(send_mail, _settings(request), request.app.state.outbox, to, subject, body)


def _send_verification(request: Request, tasks: BackgroundTasks, db, user: User) -> None:
    raw = _one_time(db, user.id, "verify", VERIFY_TTL)
    link = f"{_settings(request).public_base_url}/api/auth/verify-email/?token={raw}"
    _mail(request, tasks, user.email, "Verify your Securicode account",
          f"Hello {user.name},\n\nConfirm your e-mail address to start running assessments:\n{link}\n\n"
          "The link expires in 24 hours.")


def authenticate(db, settings, email: str, password: str, ip: str) -> User:
    """AUTH-3 + SEC-2 lockout. Raises HTTPException on failure; writes audit entries (AUDT-1)."""
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    now = utcnow()
    if user is not None and user.locked_until is not None and user.locked_until > now:
        audit(db, "login.blocked_locked", user_id=user.id, actor=email, ip=ip)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Account temporarily locked after repeated failed logins. Try again later.")
    ok = verify_password(password, user.password_hash if user else DUMMY_HASH)
    if user is None or not ok:
        if user is not None:
            user.failed_logins += 1
            if user.failed_logins >= settings.lockout_threshold:
                user.failed_logins = 0
                user.locked_until = now + timedelta(seconds=settings.lockout_seconds)
                audit(db, "login.locked_out", user_id=user.id, actor=email, ip=ip)
        audit(db, "login.failed", user_id=user.id if user else None, actor=email, ip=ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC_LOGIN_ERROR)
    if not user.is_active:
        audit(db, "login.failed", user_id=user.id, actor=email, detail="deactivated", ip=ip)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated")
    user.failed_logins, user.locked_until, user.last_login_at = 0, None, now
    audit(db, "login", user_id=user.id, actor=email, ip=ip)
    return user


def issue_token(db, settings, user: User, scope: str, name: str) -> TokenIssued:
    jti = str(uuid.uuid4())
    db.add(ApiSession(jti=jti, user_id=user.id, scope=scope, name=name or scope))
    db.commit()
    token = create_token(user_id=user.id, jti=jti, scope=scope, secret=settings.jwt_secret,
                         issuer=settings.jwt_issuer, ttl=settings.token_max_age_seconds)
    return TokenIssued(id=jti, name=name or scope, scope=scope, token=token, access_token=token,
                       expires_in=settings.token_max_age_seconds, idle_timeout=settings.idle_timeout_seconds)


def _revoke_all_sessions(db, user_id: str) -> None:
    db.execute(update(ApiSession).where(ApiSession.user_id == user_id, ApiSession.revoked_at.is_(None))
               .values(revoked_at=utcnow()))
    db.commit()


def _masked(t: GitToken) -> GitTokenOut:
    return GitTokenOut(id=t.id, provider=t.provider, host=t.host, label=t.label,
                       masked=f"****{t.last4}", created_at=t.created_at)


# ---------------------------------------------------------------- registration & verification
@router.post("/register/", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, request: Request, tasks: BackgroundTasks, db=Depends(get_db)):
    """AUTH-1"""
    _check_password_policy(_settings(request), body.password)
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this e-mail already exists")
    user = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    audit(db, "user.register", user_id=user.id, actor=email, ip=client_ip(request))
    _send_verification(request, tasks, db, user)
    return user


@router.get("/verify-email/", response_class=HTMLResponse)
def verify_email(token: str, request: Request, db=Depends(get_db)):
    """AUTH-2"""
    row = _consume(db, token, "verify")
    user = db.get(User, row.user_id) if row else None
    web = _settings(request).web_app_url
    if user is None:
        msg = ("The verification link is invalid, was already used, or is more than 24 hours old. "
               "Sign in and choose \"Send a new link\" to get another.")
        return _html(views.result("This link no longer works", msg, ok=False, action_url=web,
                                  action_label="Open Securicode"), 400)
    user.email_verified = True
    db.commit()
    audit(db, "user.email_verified", user_id=user.id, actor=user.email, ip=client_ip(request))
    return _html(views.result("E-mail verified", f"Thanks, {user.name}. You can now run security assessments.",
                              ok=True, action_url=web, action_label="Open Securicode"))


@router.post("/resend-verification/", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(request: Request, tasks: BackgroundTasks, p: Principal = Depends(get_principal),
                        db=Depends(get_db)):
    user = db.get(User, p.id)
    if not user.email_verified:
        _send_verification(request, tasks, db, user)
    return {"detail": "If the address is not yet verified, a new link has been sent"}


# ---------------------------------------------------------------- login / logout / me
@router.post("/login/", response_model=TokenIssued)
def login(body: LoginIn, request: Request, db=Depends(get_db)):
    """AUTH-3. Accepts {email|username, password, name, scope} so the existing VS Code client works."""
    s = _settings(request)
    user = authenticate(db, s, body.email, body.password, client_ip(request))
    return issue_token(db, s, user, body.scope, body.name)


@router.post("/logout/", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, p: Principal = Depends(get_principal), db=Depends(get_db)):
    db.get(ApiSession, p.jti).revoked_at = utcnow()
    db.commit()
    audit(db, "logout", user_id=p.id, actor=p.email, ip=client_ip(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/", response_model=UserOut)
def me(p: Principal = Depends(get_principal), db=Depends(get_db)):
    return db.get(User, p.id)


@router.delete("/me/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(body: PasswordIn, request: Request, p: Principal = Depends(get_principal),
                         db=Depends(get_db)):
    """AUTH-9. Deletes identity data here and asks every backend service to delete the user's data."""
    user = db.get(User, p.id)
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Password is incorrect")
    s = _settings(request)
    results = []
    headers = {"X-Internal-Key": s.internal_api_key, "X-User-Id": p.id}
    for service, url in sorted(s.service_urls.items()):
        if not url:
            continue
        try:
            r = await request.app.state.http.delete(f"{url}/internal/users/{p.id}/", headers=headers, timeout=10)
            results.append(f"{service}:{r.status_code}")
        except httpx.HTTPError:
            results.append(f"{service}:unreachable")
    for model in (ApiSession, OneTimeToken, GitToken):
        db.execute(delete(model).where(model.user_id == p.id))
    db.delete(user)
    db.commit()
    audit(db, "user.delete", user_id=p.id, actor=p.email, detail=", ".join(results), ip=client_ip(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/audit/", response_model=list[AuditOut])
def my_audit(limit: int = 100, p: Principal = Depends(get_principal), db=Depends(get_db)):
    """AUDT-2: a user sees their own entries."""
    q = select(AuditEntry).where(AuditEntry.user_id == p.id).order_by(AuditEntry.id.desc()).limit(min(limit, 500))
    return list(db.scalars(q))


# ---------------------------------------------------------------- password reset (AUTH-5)
@router.post("/password-reset/", status_code=status.HTTP_202_ACCEPTED)
def request_password_reset(body: ResetRequestIn, request: Request, tasks: BackgroundTasks, db=Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is not None and user.is_active:
        raw = _one_time(db, user.id, "reset", RESET_TTL)
        link = f"{_settings(request).public_base_url}/auth/reset-password?{urlencode({'token': raw})}"
        _mail(request, tasks, user.email, "Reset your Securicode password",
              f"Use this link to choose a new password (valid for 30 minutes, single use):\n{link}\n\n"
              "If you did not ask for this, ignore this e-mail.")
        audit(db, "password.reset_requested", user_id=user.id, actor=user.email, ip=client_ip(request))
    return {"detail": "If an account exists for this address, a reset link has been sent"}


@router.post("/password-reset/confirm/", status_code=status.HTTP_204_NO_CONTENT)
def confirm_password_reset(body: ResetConfirmIn, request: Request, db=Depends(get_db)):
    _check_password_policy(_settings(request), body.new_password)
    row = _consume(db, body.token, "reset")
    user = db.get(User, row.user_id) if row else None
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Reset link is invalid or has expired")
    user.password_hash = hash_password(body.new_password)
    user.failed_logins, user.locked_until = 0, None
    db.commit()
    _revoke_all_sessions(db, user.id)
    audit(db, "password.reset", user_id=user.id, actor=user.email, ip=client_ip(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- VS Code sign-in through the browser (AUTH-4)
def _check_redirect(settings, redirect_uri: str) -> None:
    if not any(redirect_uri.startswith(p) for p in settings.vscode_redirect_prefixes):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "redirect_uri is not an allowed VS Code URI")


@pages.get("/auth/vscode", response_class=HTMLResponse)
def vscode_login_page(request: Request, redirect_uri: str, state: str = ""):
    _check_redirect(_settings(request), redirect_uri)
    return _html(views.vscode_login(redirect_uri, state))


@pages.post("/auth/vscode")
async def vscode_login_submit(request: Request, db=Depends(get_db)):
    form = await request.form()
    redirect_uri, state = str(form.get("redirect_uri", "")), str(form.get("state", ""))
    s = _settings(request)
    _check_redirect(s, redirect_uri)
    try:
        user = authenticate(db, s, str(form.get("email", "")), str(form.get("password", "")), client_ip(request))
    except HTTPException as exc:
        return _html(views.vscode_login(redirect_uri, state, exc.detail, str(form.get("email", ""))), exc.status_code)
    code = _one_time(db, user.id, "vscode", VSCODE_CODE_TTL)
    sep = "&" if "?" in redirect_uri else "?"
    return RedirectResponse(f"{redirect_uri}{sep}{urlencode({'code': code, 'state': state})}",
                            status_code=status.HTTP_303_SEE_OTHER)


@router.post("/vscode/exchange/", response_model=TokenIssued)
def vscode_exchange(body: CodeIn, request: Request, db=Depends(get_db)):
    """The extension swaps the one-time code from its URI handler for a token (stored in SecretStorage)."""
    row = _consume(db, body.code, "vscode")
    user = db.get(User, row.user_id) if row else None
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sign-in code is invalid or has expired")
    return issue_token(db, _settings(request), user, "vscode", "VS Code")


@pages.get("/auth/reset-password", response_class=HTMLResponse)
def reset_password_page(request: Request, token: str = ""):
    s = _settings(request)
    if not token:
        msg = "Open the link from the e-mail again, or request a new one from the sign-in page."
        return _html(views.result("This link is incomplete", msg, ok=False,
                                  action_url=f"{s.web_app_url}/forgot-password",
                                  action_label="Request a new link"), 400)
    return _html(views.reset_form(token, min_length=s.min_password_length))


@pages.post("/auth/reset-password", response_class=HTMLResponse)
async def reset_password_submit(request: Request, db=Depends(get_db)):
    """Plain HTML form version of /api/auth/password-reset/confirm/, so the page needs no JavaScript."""
    form = await request.form()
    token, new = str(form.get("token", "")), str(form.get("new_password", ""))
    s = _settings(request)
    if new != str(form.get("confirm", new)):
        return _html(views.reset_form(token, "The two passwords don't match.", s.min_password_length), 422)
    try:
        confirm_password_reset(ResetConfirmIn(token=token, new_password=new), request, db)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_400_BAD_REQUEST:
            msg = f"{exc.detail}. Request a new link from the sign-in page."
            return _html(views.result("This link no longer works", msg, ok=False,
                                      action_url=f"{s.web_app_url}/forgot-password",
                                      action_label="Request a new link"), 400)
        return _html(views.reset_form(token, str(exc.detail), s.min_password_length), exc.status_code)
    except ValueError:
        return _html(views.reset_form(token, "Passwords can be at most 128 characters.", s.min_password_length), 422)
    return _html(views.result("Password changed", "You've been signed out everywhere. Sign in with your new password.",
                              ok=True, action_url=f"{s.web_app_url}/signin", action_label="Sign in"))


# ---------------------------------------------------------------- Git access tokens (AUTH-6, SEC-5)
async def _validate_with_provider(request: Request, provider: str, host: str, token: str) -> None:
    s = _settings(request)
    if not s.git_token_validate:
        return
    if provider == "github":
        url, headers = f"{s.github_api_url}/user", {"Authorization": f"Bearer {token}",
                                                    "Accept": "application/vnd.github+json"}
    else:
        url, headers = f"https://{host}/api/v4/user", {"PRIVATE-TOKEN": token}
    try:
        r = await request.app.state.http.get(url, headers=headers, timeout=10)
    except httpx.HTTPError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not reach {host} to validate the token")
    if r.status_code != 200:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{host} rejected this token")


@router.get("/git-tokens/", response_model=list[GitTokenOut])
def list_git_tokens(p: Principal = Depends(get_principal), db=Depends(get_db)):
    return [_masked(t) for t in db.scalars(select(GitToken).where(GitToken.user_id == p.id))]


@router.post("/git-tokens/", response_model=GitTokenOut, status_code=status.HTTP_201_CREATED)
async def add_git_token(body: GitTokenIn, request: Request, p: Principal = Depends(get_principal),
                        db=Depends(get_db)):
    host = "github.com" if body.provider == "github" else (body.host.strip().lower() or "gitlab.com")
    await _validate_with_provider(request, body.provider, host, body.token)
    s = _settings(request)
    t = GitToken(id=str(uuid.uuid4()), user_id=p.id, provider=body.provider, host=host, label=body.label,
                 last4=body.token[-4:], ciphertext="")
    t.ciphertext = encrypt(aes_key(s.git_token_key, s.jwt_secret), body.token, bound_to=f"{p.id}:{t.id}")
    db.add(t)
    db.commit()
    audit(db, "git_token.add", user_id=p.id, actor=p.email, target=f"{body.provider}:{host}", ip=client_ip(request))
    return _masked(t)


@router.delete("/git-tokens/{token_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_git_token(token_id: str, request: Request, p: Principal = Depends(get_principal), db=Depends(get_db)):
    t = db.get(GitToken, token_id)
    if t is None or t.user_id != p.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Token not found")
    db.delete(t)
    db.commit()
    audit(db, "git_token.remove", user_id=p.id, actor=p.email, target=f"{t.provider}:{t.host}", ip=client_ip(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- HTML
def _html(body: str, status_code: int = 200) -> HTMLResponse:
    return HTMLResponse(body, status_code=status_code, headers=views.SECURITY_HEADERS)
