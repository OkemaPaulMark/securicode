"""Service-to-service endpoints: /internal/... Require the shared X-Internal-Key header (INTERNAL_API_KEY)."""
from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from .db import GitToken, User
from .deps import audit, get_db
from .security import aes_key, decrypt

router = APIRouter(prefix="/internal", tags=["internal"])


def require_internal_key(request: Request, x_internal_key: str = Header(default="")) -> None:
    expected = request.app.state.settings.internal_api_key
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Internal API is disabled (INTERNAL_API_KEY unset)")
    if not hmac.compare_digest(x_internal_key, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid internal key")


@router.get("/git-tokens/{token_id}/", dependencies=[Depends(require_internal_key)])
def get_git_token(token_id: str, request: Request, x_user_id: str = Header(), db=Depends(get_db)):
    """Used by the Project service to clone a repository on the user's behalf. Only returns the
    token if it belongs to the user named in X-User-Id (from the request the gateway forwarded)."""
    t = db.get(GitToken, token_id)
    if t is None or t.user_id != x_user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Token not found")
    s = request.app.state.settings
    token = decrypt(aes_key(s.git_token_key, s.jwt_secret), t.ciphertext, bound_to=f"{t.user_id}:{t.id}")
    audit(db, "git_token.used", user_id=t.user_id, target=f"{t.provider}:{t.host}", detail="internal fetch")
    return {"provider": t.provider, "host": t.host, "token": token}


@router.get("/users/{user_id}/", dependencies=[Depends(require_internal_key)])
def get_user(user_id: str, db=Depends(get_db)):
    """Basic profile, e.g. so Reporting can show who approved a fix."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "is_active": user.is_active}
