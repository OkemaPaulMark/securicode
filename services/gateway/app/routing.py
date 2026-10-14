"""Reverse proxy: authenticate the caller, then forward /api/<prefix>/... to the owning service.

The original path is forwarded unchanged. Backends trust the X-User-* headers set here, so any
X-User-* header sent by a client is dropped, and the client's Authorization header is not forwarded.
"""
from __future__ import annotations

import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from .identity import current_claims

router = APIRouter(tags=["gateway"])

HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
              "transfer-encoding", "upgrade", "host", "content-length"}
STRIP_FROM_CLIENT = HOP_BY_HOP | {"authorization", "cookie"}
METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]


@router.get("/gateway/routes/")
def routes(request: Request):
    """Public prefixes and whether each has a backend configured."""
    return {p: {"configured": bool(url)} for p, url in request.app.state.settings.upstreams.items()}


@router.get("/gateway/status/")
async def upstream_status(request: Request):
    """Calls each backend's /health — handy during the demo to see what is up."""
    client: httpx.AsyncClient = request.app.state.http
    result = {}
    for prefix, url in request.app.state.settings.upstreams.items():
        if not url:
            result[prefix] = "not-configured"
            continue
        try:
            r = await client.get(f"{url}/health", timeout=3)
            result[prefix] = "up" if r.status_code < 500 else f"error-{r.status_code}"
        except httpx.HTTPError:
            result[prefix] = "down"
    return result


@router.api_route("/api/{prefix}/{path:path}", methods=METHODS)
async def proxy(prefix: str, path: str, request: Request, claims: dict = Depends(current_claims)):
    settings = request.app.state.settings
    if prefix not in settings.upstreams:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No service handles /api/{prefix}/")
    base = settings.upstreams[prefix]
    if not base:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"Service for /api/{prefix}/ is not configured")

    body = await request.body()
    if len(body) > settings.max_body_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Request body too large")

    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    headers = {k: v for k, v in request.headers.items()
               if k.lower() not in STRIP_FROM_CLIENT and not k.lower().startswith("x-user-")}
    headers.update({
        "X-User-Id": claims["sub"],
        "X-User-Name": claims.get("username", ""),
        "X-User-Role": claims.get("role", ""),
        "X-Request-Id": request_id,
        "X-Forwarded-For": request.client.host if request.client else "",
    })

    client: httpx.AsyncClient = request.app.state.http
    try:
        upstream = await client.request(request.method, f"{base}{request.url.path}", params=request.query_params,
                                        content=body, headers=headers, timeout=settings.upstream_timeout_seconds)
    except httpx.TimeoutException:
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, f"/api/{prefix}/ service timed out")
    except httpx.HTTPError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"/api/{prefix}/ service is unreachable")

    out = {k: v for k, v in upstream.headers.items() if k.lower() not in HOP_BY_HOP | {"content-encoding"}}
    out["X-Request-Id"] = request_id
    return Response(content=upstream.content, status_code=upstream.status_code, headers=out)
