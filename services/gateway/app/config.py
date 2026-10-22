"""Runtime configuration, read from environment variables (see README for the full list)."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

DEV_SECRET = "dev-insecure-change-me"

# Public prefix -> owning service. The full path is forwarded unchanged:
#   GET /api/scans/42/  ->  {SCAN_SERVICE_URL}/api/scans/42/
DEFAULT_ROUTES = "projects=project,assessments=project,scans=scan,ai=ai,reports=reporting,findings=reporting"

# POST requests matching this start a new assessment; they count toward BR-5 and need a verified e-mail (AUTH-2).
DEFAULT_ASSESSMENT_PATTERN = r"^/api/(assessments|scans)/?$|^/api/projects/[^/]+/(assessments|scans)/?$"


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def _bool(name: str, default: bool) -> bool:
    return _env(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _list(name: str, default: str) -> list[str]:
    return [x.strip() for x in _env(name, default).split(",") if x.strip()]


def parse_routes(spec: str) -> dict[str, str]:
    routes: dict[str, str] = {}
    for item in spec.split(","):
        if "=" in item:
            prefix, service = (p.strip() for p in item.split("=", 1))
            if prefix and service:
                routes[prefix] = service
    return routes


@dataclass
class Settings:
    app_env: str = field(default_factory=lambda: _env("APP_ENV", "development"))
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL", "sqlite:///./gateway.db"))

    # Tokens and sessions (SEC-3)
    jwt_secret: str = field(default_factory=lambda: _env("JWT_SECRET", DEV_SECRET))
    jwt_issuer: str = field(default_factory=lambda: _env("JWT_ISSUER", "securicode-gateway"))
    token_max_age_seconds: int = field(default_factory=lambda: int(_env("TOKEN_MAX_AGE_SECONDS", "43200")))
    idle_timeout_seconds: int = field(default_factory=lambda: int(_env("IDLE_TIMEOUT_SECONDS", "3600")))

    # Accounts (SEC-1, SEC-2, AUTH-2)
    min_password_length: int = field(default_factory=lambda: int(_env("MIN_PASSWORD_LENGTH", "10")))
    lockout_threshold: int = field(default_factory=lambda: int(_env("LOCKOUT_THRESHOLD", "5")))
    lockout_seconds: int = field(default_factory=lambda: int(_env("LOCKOUT_SECONDS", "900")))
    require_email_verification: bool = field(default_factory=lambda: _bool("REQUIRE_EMAIL_VERIFICATION", True))
    admin_email: str = field(default_factory=lambda: _env("ADMIN_EMAIL"))
    admin_password: str = field(default_factory=lambda: _env("ADMIN_PASSWORD"))

    # E-mail (CI-5). Without SMTP_HOST, mails are written to the container log instead.
    public_base_url: str = field(default_factory=lambda: _env("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/"))
    # Where "Open Securicode" links on gateway pages point (the web app, apps/web).
    web_app_url: str = field(default_factory=lambda: _env("WEB_APP_URL", "").rstrip("/"))
    smtp_host: str = field(default_factory=lambda: _env("SMTP_HOST"))
    smtp_port: int = field(default_factory=lambda: int(_env("SMTP_PORT", "587")))
    smtp_user: str = field(default_factory=lambda: _env("SMTP_USER"))
    smtp_password: str = field(default_factory=lambda: _env("SMTP_PASSWORD"))
    smtp_from: str = field(default_factory=lambda: _env("SMTP_FROM", "Securicode <no-reply@securicode.local>"))

    # Git access tokens (AUTH-6, SEC-5)
    git_token_key: str = field(default_factory=lambda: _env("GIT_TOKEN_KEY"))  # 64 hex chars = AES-256 key
    git_token_validate: bool = field(default_factory=lambda: _bool("GIT_TOKEN_VALIDATE", True))
    github_api_url: str = field(default_factory=lambda: _env("GITHUB_API_URL", "https://api.github.com").rstrip("/"))

    # VS Code browser sign-in (AUTH-4)
    vscode_redirect_prefixes: list[str] = field(
        default_factory=lambda: _list("VSCODE_REDIRECT_PREFIXES", "vscode://,vscode-insiders://"))

    # Routing to the other services
    routes: dict[str, str] = field(default_factory=lambda: parse_routes(_env("GATEWAY_ROUTES", DEFAULT_ROUTES)))
    service_urls: dict[str, str] | None = None
    # Services whose own routes have no /api prefix (e.g. Scan uses /scans): /api/scans/1 is sent as /scans/1
    strip_api_prefix_for: list[str] = field(default_factory=lambda: _list("GATEWAY_STRIP_API_PREFIX", ""))
    internal_api_key: str = field(default_factory=lambda: _env("INTERNAL_API_KEY"))
    upstream_timeout_seconds: float = field(default_factory=lambda: float(_env("UPSTREAM_TIMEOUT", "60")))
    max_body_bytes: int = field(default_factory=lambda: int(_env("MAX_BODY_MB", "100")) * 1024 * 1024)
    cors_origins: list[str] = field(default_factory=lambda: _list("CORS_ORIGINS", "*"))

    # Business rules (BR-5)
    daily_assessment_limit: int = field(default_factory=lambda: int(_env("DAILY_ASSESSMENT_LIMIT", "10")))
    assessment_create_pattern: str = field(
        default_factory=lambda: _env("ASSESSMENT_CREATE_PATTERN", DEFAULT_ASSESSMENT_PATTERN))

    def __post_init__(self) -> None:
        self.web_app_url = self.web_app_url or self.public_base_url
        if self.service_urls is None:  # PROJECT_SERVICE_URL, SCAN_SERVICE_URL, AI_SERVICE_URL, REPORTING_SERVICE_URL
            self.service_urls = {s: _env(f"{s.upper()}_SERVICE_URL").rstrip("/") for s in set(self.routes.values())}
        self.assessment_regex = re.compile(self.assessment_create_pattern)

    def validate(self) -> None:
        if self.app_env != "production":
            return
        problems = []
        if self.jwt_secret == DEV_SECRET or len(self.jwt_secret) < 32:
            problems.append("JWT_SECRET must be a random value of 32+ characters")
        if not re.fullmatch(r"[0-9a-fA-F]{64}", self.git_token_key or ""):
            problems.append("GIT_TOKEN_KEY must be 64 hex characters (openssl rand -hex 32)")
        if len(self.internal_api_key) < 16:
            problems.append("INTERNAL_API_KEY must be 16+ characters")
        if problems:
            raise RuntimeError("; ".join(problems))
