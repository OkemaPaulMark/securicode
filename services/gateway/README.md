# Gateway Service (API Gateway & Identity Service)

The Gateway is the public entry point for the platform. It authenticates users, manages accounts, issues and
validates access tokens, and routes traffic to the owning backend service. It does not own scanning logic,
project state, or AI reasoning; it protects and routes the platform.

Owner: Musheija Abraham · Implements SRS §4.1 (AUTH-1 to AUTH-9), SEC-1 to SEC-5, AUDT-1 to AUDT-4, BR-3, BR-5.

## Endpoints

Interactive OpenAPI 3 docs: `http://<host>:8000/docs` (spec at `/openapi.json`).

### Accounts (`/api/auth/`)

| Method | Path | Auth | SRS |
|---|---|---|---|
| POST | `/api/auth/register/` `{name, email, password}` | — | AUTH-1, SEC-1 (10+ chars, Argon2id) |
| GET | `/api/auth/verify-email/?token=` | — (link in e-mail) | AUTH-2 |
| POST | `/api/auth/resend-verification/` | bearer | AUTH-2 |
| POST | `/api/auth/login/` `{email or username, password, name?, scope?}` → `{id, name, scope, token, …}` | — | AUTH-3, SEC-2 (locks 15 min after 5 failures) |
| POST | `/api/auth/logout/` | bearer | SEC-3 |
| GET / DELETE | `/api/auth/me/` (DELETE body `{password}`) | bearer | AUTH-9 |
| POST | `/api/auth/password-reset/` `{email}` · `/api/auth/password-reset/confirm/` `{token, new_password}` | — | AUTH-5 (single use, 30 min) |
| GET | `/auth/vscode?redirect_uri=vscode://…&state=` → browser login → `vscode://…?code=&state=` | — | AUTH-4 |
| POST | `/api/auth/vscode/exchange/` `{code}` → token | — | AUTH-4 |
| GET / POST / DELETE | `/api/auth/git-tokens/` `{provider: github\|gitlab, token, label?, host?}` | bearer | AUTH-6, SEC-5 (validated with provider, AES-256-GCM, shown masked) |
| GET | `/api/auth/audit/` | bearer | AUDT-2 (own entries) |

Sessions end after **60 minutes of inactivity** or at most 12 hours (SEC-3).

### Administration (`/api/admin/`, administrators only, BR-3)

| Method | Path | SRS |
|---|---|---|
| GET | `/api/admin/users/` | AUTH-7 |
| PATCH | `/api/admin/users/{id}/` `{role: user\|admin, is_active}` | AUTH-7, AUTH-8 |
| GET | `/api/admin/audit/?action=` | AUDT-1, AUDT-2 |
| GET / PUT | `/api/admin/settings/` `{daily_assessment_limit}` | AUDT-3, BR-5 |
| GET | `/api/admin/status/` | AUDT-4 |

### Routing (bearer token required)

| Prefix | Service | URL variable |
|---|---|---|
| `/api/projects/…`, `/api/assessments/…` | Project | `PROJECT_SERVICE_URL` |
| `/api/scans/…` | Scan | `SCAN_SERVICE_URL` |
| `/api/ai/…` | AI | `AI_SERVICE_URL` |
| `/api/reports/…`, `/api/findings/…` | Reporting | `REPORTING_SERVICE_URL` |

Change the table with `GATEWAY_ROUTES`, e.g. `projects=project,assessments=project,scans=scan,ai=ai,reports=reporting`.

`POST /api/assessments/`, `POST /api/scans/` and `POST /api/projects/{id}/assessments|scans/` start an assessment:
the user must have a verified e-mail (AUTH-2), and non-admins may start at most `daily_assessment_limit`
(default 10) per day (BR-5).

## Contract for backend services (Project, Scan, AI, Reporting)

- **Paths are forwarded unchanged:** `GET /api/scans/42/` → `GET {SCAN_SERVICE_URL}/api/scans/42/`.
- **The caller arrives in headers:** `X-User-Id`, `X-User-Email`, `X-User-Name`, `X-User-Role` (`user`|`admin`),
  `X-User-Verified`, `X-Request-Id`. Backends do not check tokens. Enforce ownership (SEC-4) with `X-User-Id`.
- **`X-Internal-Key` equals the shared `INTERNAL_API_KEY`.** Reject requests without it so nobody can bypass the gateway.
- **Each backend exposes `GET /health`.**
- **`DELETE /internal/users/{id}/`:** each backend should delete that user's data. The gateway calls it when an account is deleted (AUTH-9).
- **Gateway internal endpoints** (send `X-Internal-Key`):
  - `GET /internal/git-tokens/{id}/` with `X-User-Id` returns the decrypted Git token, for cloning (Project service).
  - `GET /internal/users/{id}/` returns name and e-mail, for reports.

## Run locally

```bash
cd services/gateway
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pytest -q
uvicorn app.main:app --reload --port 8000
```

Without `SMTP_HOST`, verification and reset e-mails are printed to the log (`docker logs securicode-gateway`).

## Configuration

Required in production (`APP_ENV=production`):

| Variable | Notes |
|---|---|
| `JWT_SECRET` | 32+ characters |
| `GIT_TOKEN_KEY` | 64 hex characters |
| `INTERNAL_API_KEY` | 16+ characters |

Optional:

| Variable | Notes |
|---|---|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first administrator |
| `DATABASE_URL` | default SQLite in `/data`; the shared Postgres works: `postgresql+psycopg://securicode:securicode@postgres:5432/securicode` |
| `PUBLIC_BASE_URL` | used in e-mail links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | outgoing e-mail |
| `IDLE_TIMEOUT_SECONDS` | default 3600 |
| `DAILY_ASSESSMENT_LIMIT` | default 10 |
| `CORS_ORIGINS` | allowed browser origins |
| `GATEWAY_ROUTES` | routing table (see above) |
| the four `*_SERVICE_URL`s | backend addresses |

## CI/CD (GitLab, CloudLab runner)

1. `gw:test`: ruff and 18 pytest tests inside `docker build --target test` on worker1.
2. `gw:build`: builds image `securicode/gateway:<short SHA>`.
3. `gw:deploy`: runs container `securicode-gateway` on worker1:8000, waits for the Docker HEALTHCHECK, and rolls back automatically if the container is unhealthy.
4. `gw:rollback`: manual.

Build and deploy run only on the default branch.

TLS (CI-1) is expected to be terminated in front of the gateway (e.g. a reverse proxy) in the reference deployment.
