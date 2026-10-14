"""Runtime configuration, read from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass, field

DEV_SECRET = "dev-insecure-change-me"

# Public prefix (/api/<prefix>/...) -> env var holding that backend's base URL.
# The full original path is forwarded unchanged, e.g. GET /api/scans/42/ -> {SCAN_SERVICE_URL}/api/scans/42/
UPSTREAM_ENV = {
    "projects": "PROJECT_SERVICE_URL",    # services/project
    "scans": "SCAN_SERVICE_URL",          # services/scan
    "ai": "AI_SERVICE_URL",               # services/ai
    "reports": "REPORTING_SERVICE_URL",   # services/reporting
}


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def _upstreams_from_env() -> dict[str, str]:
    return {prefix: _env(var).rstrip("/") for prefix, var in UPSTREAM_ENV.items()}


@dataclass
class Settings:
    app_env: str = field(default_factory=lambda: _env("APP_ENV", "development"))
    jwt_secret: str = field(default_factory=lambda: _env("JWT_SECRET", DEV_SECRET))
    jwt_issuer: str = field(default_factory=lambda: _env("JWT_ISSUER", "securicode-gateway"))
    token_ttl_seconds: int = field(default_factory=lambda: int(_env("TOKEN_TTL_SECONDS", "86400")))
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL", "sqlite:///./gateway.db"))
    admin_username: str = field(default_factory=lambda: _env("ADMIN_USERNAME", "admin"))
    admin_email: str = field(default_factory=lambda: _env("ADMIN_EMAIL"))
    admin_password: str = field(default_factory=lambda: _env("ADMIN_PASSWORD"))
    cors_origins: list[str] = field(
        default_factory=lambda: [o.strip() for o in _env("CORS_ORIGINS", "*").split(",") if o.strip()]
    )
    upstream_timeout_seconds: float = field(default_factory=lambda: float(_env("UPSTREAM_TIMEOUT", "60")))
    max_body_bytes: int = field(default_factory=lambda: int(_env("MAX_BODY_MB", "50")) * 1024 * 1024)
    upstreams: dict[str, str] = field(default_factory=_upstreams_from_env)

    def validate(self) -> None:
        if self.app_env == "production" and (self.jwt_secret == DEV_SECRET or len(self.jwt_secret) < 32):
            raise RuntimeError("JWT_SECRET must be a random value of 32+ characters in production")
