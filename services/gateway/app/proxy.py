"""Reverse proxy: authenticate the caller, then forward /api/<prefix>/... to the owning service.

- The original path and query are forwarded unchanged.
- The caller is passed as X-User-* headers; any X-User-* header sent by the client is dropped and the
  client's Authorization/Cookie headers are not forwarded.
- X-Internal-Key lets backends reject traffic that did not come through the gateway.
- Starting an assessment needs a verified e-mail (AUTH-2) and is limited per user per day (BR-5).
"""
from __future__ import annotations

import uuid
from datetime import timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select

from .db import AuditEntry, utcnow
from .deps import Principal, audit, client_ip, daily_assessment_limit, get_db, get_principal

router = APIRouter(tags=["routing"])

HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
              "transfer-encoding", "upgrade", "host", "content-length"}
STRIP_FROM_CLIENT = HOP_BY_HOP | {"authorization", "cookie", "x-internal-key"}
METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]


def _check_assessment_rules(db, settings, p: Principal) -> None:
    if settings.require_email_verification and not p.email_verified:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Verify your e-mail address before running assessments")
    if p.role == "admin":
        return
    limit = daily_assessment_limit(db, settings)
    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    used = db.scalar(select(func.count()).select_from(AuditEntry).where(
        AuditEntry.user_id == p.id, AuditEntry.action == "assessment.submit",
        AuditEntry.at >= start, AuditEntry.at < start + timedelta(days=1)))
    if used >= limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            f"Daily limit of {limit} assessments reached. Try again tomorrow.")


@router.api_route("/api/{prefix}", methods=METHODS, include_in_schema=False)
@router.api_route("/api/{prefix}/{path:path}", methods=METHODS)
async def proxy(prefix: str, request: Request, path: str = "", p: Principal = Depends(get_principal),
                db=Depends(get_db)):
    s = request.app.state.settings
    service = s.routes.get(prefix)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No service handles /api/{prefix}/")
    base = s.service_urls.get(service, "")
    if not base:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"The {service} service is not configured")

    body = await request.body()
    if len(body) > s.max_body_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Request body too large")

    starts_assessment = request.method == "POST" and s.assessment_regex.match(request.url.path) is not None
    if starts_assessment:
        _check_assessment_rules(db, s, p)

    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    headers = {k: v for k, v in request.headers.items()
               if k.lower() not in STRIP_FROM_CLIENT and not k.lower().startswith("x-user-")}
    headers.update({
        "X-User-Id": p.id,
        "X-User-Email": p.email,
        "X-User-Name": p.name,
        "X-User-Role": p.role,
        "X-User-Verified": "true" if p.email_verified else "false",
        "X-Request-Id": request_id,
        "X-Forwarded-For": client_ip(request),
    })
    if s.internal_api_key:
        headers["X-Internal-Key"] = s.internal_api_key

    upstream_path = request.url.path
    if service in s.strip_api_prefix_for:
        upstream_path = upstream_path[len("/api"):]
    try:
        # follow_redirects: a backend's trailing-slash redirect points at its internal address, which clients
        # cannot reach; the gateway follows it itself (307/308 keep the method and body).
        upstream = await request.app.state.http.request(
            request.method, f"{base}{upstream_path}", params=request.query_params, content=body,
            headers=headers, timeout=s.upstream_timeout_seconds, follow_redirects=True)
    except httpx.TimeoutException:
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, f"The {service} service timed out")
    except httpx.HTTPError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"The {service} service is unreachable")

    if starts_assessment and upstream.status_code < 300:
        audit(db, "assessment.submit", user_id=p.id, actor=p.email, target=request.url.path, ip=client_ip(request))

    out = {k: v for k, v in upstream.headers.items() if k.lower() not in HOP_BY_HOP | {"content-encoding"}}
    out["X-Request-Id"] = request_id
    return Response(content=upstream.content, status_code=upstream.status_code, headers=out)
