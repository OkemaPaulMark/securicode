"""Identity store. SQLite by default; set DATABASE_URL to use the shared PostgreSQL
(e.g. postgresql+psycopg://securicode:securicode@postgres:5432/securicode)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

ROLES = ("developer", "admin")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "gateway_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="developer")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RevokedToken(Base):
    """Token IDs (jti) invalidated by POST /api/auth/logout/."""
    __tablename__ = "gateway_revoked_tokens"

    jti: Mapped[str] = mapped_column(String(36), primary_key=True)
    revoked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


def make_sessionmaker(database_url: str) -> sessionmaker:
    kwargs = {"connect_args": {"check_same_thread": False}} if database_url.startswith("sqlite") else {}
    engine = create_engine(database_url, pool_pre_ping=True, **kwargs)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)
