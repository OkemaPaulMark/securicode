# Web App

The browser client for Securicode. It talks only to the API Gateway; it has no security logic of its own.

Owner: Musheija Abraham (with the Gateway). Implements the web side of SRS §3.1 and §4: AUTH-1–9, SUBM-2/4/6/7,
ASMT-3–8, REV-1–9, CHAT-1–5, REPT-1–4, AUDT-2–4, plus SAFE-5/6, SEC-7 and SEC-11 in the interface.

## What's in it

| Screen | Path | Requirements |
|---|---|---|
| Sign in, create account, forgot password | `/signin`, `/register`, `/forgot-password` | AUTH-1, AUTH-3, AUTH-5 |
| Projects dashboard: status and severity counts, upload a ZIP, connect a repository | `/` | SUBM-2, SUBM-4, REPT-1 |
| Project history, re-assess, delete, compare two assessments | `/projects/:id`, `/projects/:id/compare` | SUBM-6, ASMT-8, REPT-4 |
| Assessment: live progress per scanner, cancel/retry, alerts-to-fixes funnel, findings review | `/assessments/:id` | ASMT-3–6, REV-1–9, SAFE-6 |
| Finding detail: evidence, explanation, references, diff, approve/reject/false positive, override | same page | REV-2–5, REV-7, EXPL-6, AGNT-7 |
| Assistant drawer with the finding as context; it never edits code | same page | CHAT-1–5 |
| Exports: SARIF 2.1.0, approved fixes as one `.patch`, printable report (Save as PDF) | same page, `/assessments/:id/report` | REPT-2, REPT-3, REV-7, SAFE-5 |
| Account: profile, Git tokens (masked), activity, delete account | `/account` | AUTH-6, AUTH-9, AUDT-2 |
| Administration: users, audit log, service status, daily limit | `/admin`, `/admin/audit`, `/admin/system` | AUTH-7/8, AUDT-1–4, BR-3, BR-5 |

Interface rules from SRS §3.1 are applied everywhere: severity is always a text label plus a shape (never colour
alone), errors say what happened and what to do next, every page has help (`?` key or the Help button), destructive
or code-changing actions ask for confirmation, and colours meet WCAG 2.1 AA in light and dark themes. Keyboard: `j`/`k`
move through findings.

### When the other services aren't running yet

Identity, Git tokens, audit and administration always use the real gateway. If the gateway answers that the
Project, Scan, AI or Reporting service is not configured or not reachable (502/503/504), the projects and findings
screens switch to built-in sample data (the five scenarios from the project guide) and a banner says so. "Explore
with sample data" on the sign-in page runs the whole app in the browser with no backend at all, which is handy for
demos. As soon as the services implement [API_CONTRACT.md](API_CONTRACT.md), the same screens show real data with no
change here.

## Run it

```bash
cd apps/web
npm install
npm run dev            # http://localhost:5173, proxies /api and /auth to the gateway on :8000
npm run check          # type check + 22 unit tests + production build
```

Start the gateway first (see `services/gateway/README.md`), or use "Explore with sample data".
Point the dev server at another gateway with `GATEWAY_URL=http://worker1:8000 npm run dev`.

Whole stack in Docker: `make up` from the repository root, then open http://localhost:8080.

## Deployment

`Dockerfile` stages: `test` (type check + tests, fails the build on any error), `build`, `runtime` (unprivileged nginx
on port 8080). nginx serves the app and forwards `/api/*`, `/auth/*`, `/docs` and `/openapi.json` to `GATEWAY_URL`,
so the browser only ever talks to one origin. It sets a strict Content-Security-Policy (no inline scripts, no third
party origins), `X-Frame-Options: DENY`, `nosniff`, and allows 100 MB uploads (CI-4).

GitLab pipeline (`apps/web/.gitlab-ci.yml`, included from the root file), same pattern as the gateway:

1. `web:test`: type check and unit tests inside `docker build --target test` on worker1.
2. `web:build`: image `securicode/web:<short SHA>`.
3. `web:deploy`: runs `securicode-web` on worker1:8080, waits for the HEALTHCHECK, checks that `/signin` loads and
   `/api/auth/me/` reaches the gateway, and rolls back automatically if either fails.
4. `web:rollback`: manual.

Set the gateway's `PUBLIC_BASE_URL` and `WEB_APP_URL` to the web address (e.g. `http://worker1:8080`) so links in
verification and reset e-mails open through the web app.

## Layout

```text
src/
  api/          http.ts (fetch, token, errors) · gateway.ts · platform.ts · index.ts (live / sample routing) · types.ts
  demo/         sample projects from the guide's scenarios and an in-browser implementation of the API
  components/   Layout, FindingDetail, DiffView, ChatDrawer, NewAssessment dialogs, help text, shared UI
  pages/        auth, Dashboard, Project (+ compare), Assessment, Report, Account, Admin
  lib/          formatting, diff parser, SARIF export, session/toasts/theme
  styles/       tokens.css (colour, type, spacing) · app.css
  test/         unit and screen tests (Vitest + Testing Library)
nginx/          default.conf.template
ci/ci.sh        test | build | deploy | rollback | status
```
