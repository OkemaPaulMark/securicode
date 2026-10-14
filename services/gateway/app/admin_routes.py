"""Administration: /api/admin/... (AUTH-7, AUTH-8, AUDT-2..AUDT-4, BR-3). Administrators only."""
from __future__ import annotations

from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from .auth_routes import AuditOut, UserOut
from .db import ApiSession, AuditEntry, Setting, User, utcnow
from .deps import Principal, audit, client_ip, daily_assessment_limit, get_db, require_admin

router = APIRouter(prefix="/api/admin", tags=["administration"])


class UserUpdateIn(BaseModel):
    role: Literal["user", "admin"] | None = None
    is_active: bool | None = None


class SettingsIn(BaseModel):
    daily_assessment_limit: int = Field(ge=0, le=10_000)


class AdminAuditOut(AuditOut):
    user_id: str | None


@router.get("/users/", response_model=list[UserOut])
def list_users(_: Principal = Depends(require_admin), db=Depends(get_db)):
    return list(db.scalars(select(User).order_by(User.created_at)))


@router.patch("/users/{user_id}/", response_model=UserOut)
def update_user(user_id: str, body: UserUpdateIn, request: Request, admin: Principal = Depends(require_admin),
                db=Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.id and (body.is_active is False or body.role == "user"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate or demote your own account")
    changes = []
    if body.role is not None and body.role != user.role:
        changes.append(f"role {user.role}->{body.role}")
        user.role = body.role
    if body.is_active is not None and body.is_active != user.is_active:
        changes.append("reactivated" if body.is_active else "deactivated")
        user.is_active = body.is_active
        if not body.is_active:  # deactivation ends every open session immediately
            db.execute(update(ApiSession).where(ApiSession.user_id == user.id, ApiSession.revoked_at.is_(None))
                       .values(revoked_at=utcnow()))
    db.commit()
    if changes:
        audit(db, "admin.user_update", user_id=admin.id, actor=admin.email, target=user.email,
              detail="; ".join(changes), ip=client_ip(request))
    return user


@router.get("/audit/", response_model=list[AdminAuditOut])
def all_audit(limit: int = 200, action: str = "", _: Principal = Depends(require_admin), db=Depends(get_db)):
    q = select(AuditEntry).order_by(AuditEntry.id.desc()).limit(min(limit, 1000))
    if action:
        q = q.where(AuditEntry.action == action)
    return list(db.scalars(q))


@router.get("/settings/")
def get_settings(request: Request, _: Principal = Depends(require_admin), db=Depends(get_db)):
    return {"daily_assessment_limit": daily_assessment_limit(db, request.app.state.settings)}


@router.put("/settings/")
def put_settings(body: SettingsIn, request: Request, admin: Principal = Depends(require_admin), db=Depends(get_db)):
    old = daily_assessment_limit(db, request.app.state.settings)
    row = db.get(Setting, "daily_assessment_limit") or Setting(key="daily_assessment_limit", value="")
    row.value = str(body.daily_assessment_limit)
    db.merge(row)
    db.commit()
    audit(db, "admin.settings_update", user_id=admin.id, actor=admin.email, target="daily_assessment_limit",
          detail=f"{old}->{body.daily_assessment_limit}", ip=client_ip(request))
    return {"daily_assessment_limit": body.daily_assessment_limit}


@router.get("/status/")
async def service_status(request: Request, _: Principal = Depends(require_admin)):
    """AUDT-4: health of each backend service the gateway routes to."""
    s = request.app.state.settings
    services = {}
    for name, url in sorted(s.service_urls.items()):
        if not url:
            services[name] = "not-configured"
            continue
        try:
            r = await request.app.state.http.get(f"{url}/health", timeout=3)
            services[name] = "up" if r.status_code < 500 else f"error-{r.status_code}"
        except httpx.HTTPError:
            services[name] = "down"
    return {"gateway": "up", "services": services, "routes": s.routes}
