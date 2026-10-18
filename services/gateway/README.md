# Gateway Service (API Gateway & Identity Service)

**Owner:** Musheija Abraham · **Runs on:** worker1, port **8090** · **Container:** `securicode-gateway`
**Image:** `gitlab.cranecloud.io:5050/2027-se4-final-year-projects/bse27-23/gateway:<commit short SHA>`
**Deployed from branch:** `musheijaa` (and the default branch)

The Gateway is the single entry point for the Securicode web app and VS Code extension. It handles accounts
and sign-in, issues and checks access tokens, and forwards each `/api/...` request to the service that owns it.
It holds no scanning, project or AI logic.

Implements SRS §4.1 AUTH-1 to AUTH-9, SEC-1 to SEC-5, AUDT-1 to AUDT-4, BR-3 and BR-5.

## How a request flows

```
VS Code extension / web app
        │  Authorization: Bearer <token>
        ▼
  Gateway (worker1:8090)  ── checks token, session (60-min idle), role, daily limit
        │  adds X-User-Id, X-User-Role, X-User-Verified, X-Internal-Key
        ├── /api/projects/…, /api/assessments/…  → Project   (worker1:8002)
        ├── /api/scans/…   (sent as /scans/…)    → Scan      (worker1:5000)
        ├── /api/ai/…                            → AI        (not deployed yet)
        └── /api/reports/…, /api/findings/…      → Reporting (not deployed yet)
```

## Endpoints

Interactive OpenAPI docs: `http://worker1:8090/docs`.

| Method | Path | Who | SRS |
|---|---|---|---|
| POST | `/api/auth/register/` `{name, email, password}` | anyone | AUTH-1, SEC-1 (10+ chars, Argon2id) |
| GET | `/api/auth/verify-email/?token=` | link in e-mail | AUTH-2 |
| POST | `/api/auth/login/` `{email or username, password, name?, scope?}` | anyone | AUTH-3, SEC-2 (15-min lock after 5 failures) |
| POST | `/api/auth/logout/` · GET/DELETE `/api/auth/me/` | signed in | SEC-3, AUTH-9 |
| POST | `/api/auth/password-reset/` · `/api/auth/password-reset/confirm/` | anyone | AUTH-5 (single use, 30 min) |
| GET | `/auth/vscode?redirect_uri=vscode://…` → POST `/api/auth/vscode/exchange/` | VS Code | AUTH-4 |
| GET/POST/DELETE | `/api/auth/git-tokens/` | signed in | AUTH-6, SEC-5 (AES-256-GCM, masked) |
| GET | `/api/auth/audit/` | signed in | AUDT-2 |
| GET/PATCH | `/api/admin/users/…` | admin | AUTH-7, AUTH-8 |
| GET | `/api/admin/audit/` | admin | AUDT-1, AUDT-2 |
| GET/PUT | `/api/admin/settings/` `{daily_assessment_limit}` | admin | AUDT-3, BR-5 |
| GET | `/api/admin/status/` | admin | AUDT-4 |
| ANY | `/api/<prefix>/…` | signed in | routing |

## Contract for the other services

- **The caller arrives in headers.** `X-User-Id`, `X-User-Email`, `X-User-Name`, `X-User-Role` (`user` or `admin`),
  `X-User-Verified` and `X-Request-Id`. Backends do not check tokens; they use `X-User-Id` to enforce ownership (SEC-4).
- **`X-Internal-Key` equals the shared `INTERNAL_API_KEY`.** Reject requests without it.
- **Paths are forwarded unchanged.** For services listed in `GATEWAY_STRIP_API_PREFIX` (currently `scan`), the `/api` prefix is removed first.
- **Each service provides `GET /health`.**
- **Each service provides `DELETE /internal/users/{id}/`**, so a deleted account's data is removed everywhere (AUTH-9).

## Pipeline (`services/gateway/.gitlab-ci.yml`, runner tag `docker`)

| Job | Stage | What it does |
|---|---|---|
| `gw:test` | test | `docker build --target test`: ruff lint plus 20 pytest tests. Any failure stops the pipeline. |
| `gw:build` | build | Builds the runtime image and pushes it to the GitLab registry, tagged with the commit SHA. |
| `gw:deploy` | deploy | `DOCKER_HOST=ssh://gitlab-runner@worker1`: pulls and runs the image and waits for the Docker health check. If the container is unhealthy, it rolls back to the previous image automatically. |
| `gw:verify` | deploy | Smoke test from the runner: health, register, verify e-mail, login, lockout, and backend status through the gateway. |
| `gw:rollback` | deploy | **Manual.** Redeploys the previous image, or `ROLLBACK_TAG=<sha>`. |

Build and deploy run only on the default branch and on `musheijaa`. Other branches run `gw:test` only.

Evidence:
- Pipeline #10698: a deliberate password-check bug failed 6 tests, and build and deploy were blocked.
- Pipeline #10699: the fix went green, and a manual rollback to `72b75ba3` was followed by a redeploy.

## CI/CD variables (Settings → CI/CD → Variables)

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | yes | `openssl rand -hex 32` |
| `GIT_TOKEN_KEY` | yes | `openssl rand -hex 32` (AES-256 key for stored Git tokens) |
| `INTERNAL_API_KEY` | yes | `openssl rand -hex 24`. Shared with the other services. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | yes | The first administrator account. The password needs 10+ characters. |
| `GW_PORT` | yes | `8090`, because port 8000 on worker1 is taken by `hello`. |
| `PROJECT_SERVICE_URL` | when deployed | `http://worker1:8002` |
| `SCAN_SERVICE_URL` | when deployed | `http://worker1:5000` |
| `GATEWAY_STRIP_API_PREFIX` | optional | `scan` |
| `AI_SERVICE_URL`, `REPORTING_SERVICE_URL` | when deployed | e.g. `http://worker2:<port>` |
| `GW_HOST` | optional | Defaults to `worker1`. Set it to `worker2` to move the gateway. |

The container can reach `worker1` and `worker2` by name: the deploy step passes their addresses in with `--add-host`.

## Rebuild from a fresh CloudLab experiment

1. Start a new experiment from the course profile and wait until `runner`, `worker1` and `worker2` are ready.
2. On the runner, register the GitLab runner with the tag `docker` and the shell executor, then run `sudo usermod -aG docker gitlab-runner && sudo systemctl restart gitlab-runner` (Lab 1 §1).
3. On the runner, run `sudo /local/repository/scripts/setup-deploy-key.sh` and check that both workers show `OK` (Lab 1 §3).
4. In GitLab, check that all the CI/CD variables above exist.
5. Go to **Build → Pipelines → Run pipeline** on `musheijaa`. Test, build, deploy and verify run with no manual step.
6. Check that `gw:verify` ends with `Job succeeded` and `/api/projects/ -> 200`.

## Run locally

```bash
cd services/gateway
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pytest -q                                    # 20 passed
uvicorn app.main:app --reload --port 8000    # http://localhost:8000/docs
```

Without `SMTP_HOST`, verification and reset e-mails are printed to the log (`docker logs securicode-gateway`).
