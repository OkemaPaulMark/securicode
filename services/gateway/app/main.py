"""Gateway service entry point — authentication, request routing, and API entry point."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from . import identity, routing
from .config import Settings
from .db import make_sessionmaker

VERSION = os.environ.get("APP_VERSION", "dev")


def create_app(settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.validate()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.sessionmaker = make_sessionmaker(settings.database_url)
        identity.bootstrap_admin(app.state.sessionmaker, settings.admin_username,
                                 settings.admin_email, settings.admin_password)
        async with httpx.AsyncClient(transport=transport, follow_redirects=False) as client:
            app.state.http = client
            yield

    app = FastAPI(title="Gateway Service", version=VERSION, lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
                       allow_headers=["*"], allow_credentials="*" not in settings.cors_origins)

    @app.get("/health", tags=["ops"])
    def health():
        return {"status": "ok", "service": "gateway", "version": VERSION}

    @app.get("/ready", tags=["ops"])
    def ready():
        with app.state.sessionmaker() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ready"}

    app.include_router(identity.router)   # must come before the catch-all proxy
    app.include_router(routing.router)
    return app


app = create_app()
