# Gateway Service

The Gateway is the public entry point for the platform. It authenticates users, issues and validates
tokens, and routes traffic to the owning backend service. It does not own scanning logic, project state,
or AI reasoning; it protects and routes the platform.

Owner: Musheija Abraham

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health`, `/ready` | none | liveness / DB readiness |
| POST | `/api/auth/register/` | none | `{username, email, password, full_name}` |
| POST | `/api/auth/login/` | none | `{username (or email), password, name, scope}` → `{id, name, scope, token, access_token, expires_in}` (VS Code `TokenIssued`) |
| POST | `/api/auth/logout/` | bearer | revokes the token |
| GET | `/api/auth/me/` | bearer | current user |
| GET | `/api/auth/users/` | admin | list users |
| PATCH | `/api/auth/users/{id}/role/` | admin | `{role: developer\|admin}` |
| GET | `/gateway/routes/`, `/gateway/status/` | none | configured backends / live health of each |
| ANY | `/api/projects/…` | bearer | → Project service (`PROJECT_SERVICE_URL`) |
| ANY | `/api/scans/…` | bearer | → Scan service (`SCAN_SERVICE_URL`) |
| ANY | `/api/ai/…` | bearer | → AI service (`AI_SERVICE_URL`) |
| ANY | `/api/reports/…` | bearer | → Reporting service (`REPORTING_SERVICE_URL`) |

Interactive docs: `http://<host>:8000/docs`

## Contract for backend services

- The full path is forwarded unchanged: `GET /api/scans/42/` → `GET {SCAN_SERVICE_URL}/api/scans/42/`.
- The caller arrives as headers: `X-User-Id`, `X-User-Name`, `X-User-Role`, `X-Request-Id`.
  Backends do not need to check tokens. The gateway removes any `X-User-*` headers sent by the client.
- Each backend exposes `GET /health` (used by `/gateway/status/`).

## Run locally

```bash
cd services/gateway
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pytest -q
uvicorn app.main:app --reload --port 8000
```

Configuration is through environment variables: `JWT_SECRET`, `DATABASE_URL` (default SQLite; the shared
Postgres works with `postgresql+psycopg://securicode:securicode@postgres:5432/securicode`),
`ADMIN_USERNAME`/`ADMIN_EMAIL`/`ADMIN_PASSWORD`, `CORS_ORIGINS`, `TOKEN_TTL_SECONDS`, and the four `*_SERVICE_URL`s.

## CI/CD (GitLab, CloudLab runner)

`gw:test` (ruff + pytest inside `docker build --target test` on worker1) → `gw:build` (image
`securicode/gateway:<short SHA>`) → `gw:deploy` (container `securicode-gateway` on worker1:8000; waits
for the Docker HEALTHCHECK and rolls back automatically if the container is unhealthy) → `gw:rollback`
(manual). Build and deploy run only on the default branch.
