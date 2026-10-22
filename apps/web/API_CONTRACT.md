# Platform API used by the web app

This is what the web app (and the VS Code extension) expects from the Project, Scan, AI and Reporting services.
All paths go through the gateway, which authenticates the caller and forwards the request unchanged with
`X-User-Id`, `X-User-Email`, `X-User-Name`, `X-User-Role`, `X-User-Verified`, `X-Request-Id` and `X-Internal-Key`
(see `services/gateway/README.md`). Every service must enforce ownership with `X-User-Id` (SEC-4).

TypeScript shapes are in `src/api/types.ts`; the sample implementation in `src/demo/store.ts` behaves exactly as
described here and is the quickest way to see the expected responses.

Errors: return `{"detail": "<one sentence the user can act on>"}`. The web app shows `detail` as is, so never put
stack traces or internal IDs in it.

## Project service (`/api/projects/…`, `/api/assessments/…`)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/projects/` | | `Project[]`, newest first |
| POST | `/api/projects/` | multipart `name`, `source_type=zip`, `archive` (≤ 100 MB) **or** JSON `{name, source_type: github\|gitlab, repo_url, branch, git_token_id}` | `Project` (201). Creating a project does **not** start an assessment. |
| GET / DELETE | `/api/projects/{id}/` | | `Project` / 204 (deletes stored code, assessments, findings) |
| GET | `/api/projects/{id}/assessments/` | | `AssessmentSummary[]`, newest first |
| POST | `/api/projects/{id}/assessments/` | `{}` for repositories; multipart `archive` to assess new ZIP code | `Assessment` (201) within 3 s (PERF-2). 409 if one is already running. |
| GET | `/api/assessments/{id}/` | | `Assessment` (polled every 2 s while active) |
| POST | `/api/assessments/{id}/cancel/` · `/retry/` | | `Assessment` |
| GET | `/api/assessments/{id}/findings/` | | `Finding[]` (empty until `completed`) |
| POST | `/api/assessments/{id}/findings/{fid}/decision/` | `{decision: approved\|rejected\|false_positive\|null, comment}` | `Finding`, with `decided_by`, `decided_at` (REV-4, REV-9) |
| POST | `/api/assessments/{id}/findings/{fid}/classification/` | `{status: validated\|false_positive, comment}` | `Finding` (REV-5 override) |

Starting assessments uses the paths the gateway already checks for e-mail verification and the daily limit
(`POST /api/projects/{id}/assessments/`). Starting one any other way would bypass BR-5.

`Project`: `{id, name, source_type, repo_url, branch, created_at, assessment_count, latest_assessment: AssessmentSummary|null}`

`AssessmentSummary`: `{id, number, state, created_at, finished_at, counts: {critical, high, medium, low}}`; counts exclude false positives.

`Assessment` adds:

```json
{
  "project_id": "…", "project_name": "hostel-booking", "started_at": "…",
  "source_label": "main @ 4f2a91c",
  "state": "queued | running_scans | ai_analysing | completed | failed | cancelled",
  "failure_reason": "GitHub rejected the stored access token while fetching the repository. Add a new token under Account, then retry.",
  "tools": [{"name": "Semgrep", "version": "1.95.0", "state": "pending|running|done|failed|timed_out|skipped", "alerts": 8, "reason": "No package.json found"}],
  "ai": {"analysed": 3, "total": 6, "available": true, "model": "…", "model_location": "external | local"},
  "funnel": {"raw": 40, "merged": 34, "validated": 16, "approved": 10},
  "status_counts": {"validated": 16, "false_positive": 12, "needs_review": 6, "unvalidated": 0}
}
```

`ai.available: false` means the LLM was down and findings are unvalidated scanner results (AGNT-8).
`model_location` is shown to the user (SEC-7).

`Finding` follows the guide, chapter 8:

```json
{
  "id": "F-0012", "title": "SQL injection in user lookup", "cwe": "CWE-89", "owasp": "A03:2021 Injection",
  "file": "app/db/users.py", "line": 42, "end_line": 43, "detected_by": ["semgrep", "sonarqube"],
  "evidence": "username from request.args flows into cursor.execute() via an f-string; no validation found",
  "evidence_lines": [{"file": "app/db/users.py", "line": 42, "code": "q = f\"SELECT …\""}],
  "severity": "critical|high|medium|low", "confidence": 0.92,
  "status": "validated|false_positive|needs_review|unvalidated",
  "explanation": "…", "remediation": "Use parameterised queries.",
  "remediation_steps": ["Revoke the key…"],
  "references": [{"title": "OWASP SQL Injection Prevention Cheat Sheet", "url": "https://…"}],
  "proposed_fix": {"diff": "--- a/app/db/users.py\n+++ b/app/db/users.py\n@@ …"},
  "related": ["F-0013"], "manipulation_attempt": false,
  "decision": "approved|rejected|false_positive|null", "decided_by": "amina", "decided_at": "…", "decision_comment": null
}
```

`proposed_fix` is a unified diff or `null` (then `remediation_steps` explain what to do, EXPL-6).
`manipulation_attempt: true` marks text addressed to an AI reviewer (AGNT-7, SEC-8).

## Reporting service (`/api/reports/…`)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/reports/{assessment_id}/sarif/` | SARIF 2.1.0 (`application/sarif+json`), false positives as suppressed results |
| GET | `/api/reports/{assessment_id}/pdf/` | PDF with the SAFE-5 disclaimer. Until this exists the web app uses its printable report page. |
| GET | `/api/reports/{assessment_id}/patch/?findings=F-1,F-2` | one patch file (`text/x-diff`) with the listed approved fixes |
| GET | `/api/reports/compare/?base={id}&head={id}` | `{base, head, new: Finding[], resolved: Finding[], unchanged: Finding[]}` |

## AI service (`/api/ai/…`)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/ai/assessments/{id}/chat/` | | `ChatMessage[]` for this user (CHAT-5) |
| POST | `/api/ai/assessments/{id}/chat/` | `{question, finding_id\|null}` | the assistant's `ChatMessage`: `{id, role: "assistant", text, sources: Reference[], at}` |

The assistant must not change files; a request to edit code gets an answer pointing to the proposed-fix workflow (CHAT-4).
