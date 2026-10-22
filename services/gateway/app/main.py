"""Gateway service entry point — authentication, request routing, and API entry point (API Gateway &
Identity Service). OpenAPI 3 docs at /docs and /openapi.json."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from sqlalchemy import select, text

from . import admin_routes, auth_routes, internal_routes, pages, proxy
from .config import Settings
from .db import User, make_sessionmaker
from .security import hash_password

VERSION = os.environ.get("APP_VERSION", "dev")


def bootstrap_admin(sessionmaker, email: str, password: str) -> None:
    """Creates the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD if that account does not exist."""
    if not email or not password:
        return
    with sessionmaker() as db:
        if db.scalar(select(User).where(User.email == email.lower())) is None:
            db.add(User(email=email.lower(), name="Administrator", password_hash=hash_password(password),
                        role="admin", email_verified=True))
            db.commit()


def create_app(settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.validate()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.sessionmaker = make_sessionmaker(settings.database_url)
        bootstrap_admin(app.state.sessionmaker, settings.admin_email, settings.admin_password)
        async with httpx.AsyncClient(transport=transport, follow_redirects=False) as client:
            app.state.http = client
            yield

    app = FastAPI(title="Securicode Gateway", version=VERSION, lifespan=lifespan,
                  description="API Gateway & Identity Service: authentication, accounts and routing.")
    app.state.settings = settings
    app.state.outbox = [] if settings.app_env == "test" else None
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
                       allow_headers=["*"], allow_credentials="*" not in settings.cors_origins)

    @app.get("/health", tags=["ops"])
    def health():
        return {"status": "ok", "service": "gateway", "version": VERSION}

    @app.get("/", include_in_schema=False, response_class=HTMLResponse)
    def home():
        return HTMLResponse(pages.home(VERSION, settings.web_app_url), headers=pages.SECURITY_HEADERS)

    @app.get("/ready", tags=["ops"])
    def ready():
        with app.state.sessionmaker() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ready"}

    # Order matters: local routers first, the catch-all proxy last.
    app.include_router(auth_routes.router)
    app.include_router(auth_routes.pages)
    app.include_router(admin_routes.router)
    app.include_router(internal_routes.router)
    app.include_router(proxy.router)
    return app


app = create_app()
