/**
 * Demo scan result used until the real scan pipeline (Sheet 07/13) is
 * wired up to `scanWorkspace`/`scanFile`. Every place this is used labels
 * itself as example data in the UI — see ScanRunState / the "(example
 * data)" badge in overviewViewProvider — so it's never mistaken for a
 * real result.
 */
import { CIStatus, Dependency, Finding, SecretFinding } from "../api-client/types";

export const SAMPLE_FINDINGS: Finding[] = [
  {
    id: "f-sqli-users",
    scan: "demo",
    title: "SQL Injection",
    description:
      "User-supplied input is concatenated directly into a SQL query string instead of being passed as a bound parameter, letting an attacker alter the query's structure.",
    severity: "critical",
    confidence: 97,
    file: "src/api/users.py",
    line: 84,
    cwe: "CWE-89",
    owaspCategory: "A03:2021 — Injection",
    cve: null,
    codeEvidence: 'query = "SELECT * FROM users WHERE id=" + user_id\ncursor.execute(query)',
    impact:
      "An attacker who controls `user_id` can read, modify, or delete arbitrary rows — including other users' credentials — by injecting SQL syntax through the request parameter.",
    aiAnalysis:
      "I traced `user_id` back to the `id` query parameter on this endpoint. It reaches `cursor.execute()` with no validation, escaping, or parameterization anywhere on the path. This is directly exploitable by any authenticated caller.",
    remediation:
      "Use a parameterized query so the driver treats `user_id` as data, never as SQL syntax.",
    suggestedFix: 'cursor.execute(\n    "SELECT * FROM users WHERE id=%s",\n    [user_id],\n)',
    source: "AI_AGENT",
    status: "open",
  },
  {
    id: "f-secret-settings",
    scan: "demo",
    title: "Hardcoded Secret",
    description: "A live-looking API key is committed directly in a settings file.",
    severity: "critical",
    confidence: 99,
    file: "config/settings.py",
    line: 19,
    cwe: "CWE-798",
    owaspCategory: "A02:2021 — Cryptographic Failures",
    cve: null,
    codeEvidence: 'STRIPE_API_KEY = "sk_live_51H8x...redacted"',
    impact: "Anyone with read access to this repository (or its history) can use this key directly.",
    aiAnalysis: "This matches the live-key prefix format for this provider — treat it as compromised, not just exposed.",
    remediation: "Revoke this key immediately, then load it from an environment variable or secret manager instead.",
    suggestedFix: 'STRIPE_API_KEY = env("STRIPE_API_KEY")',
    source: "SECRETS",
    status: "open",
  },
  {
    id: "f-bola-orders",
    scan: "demo",
    title: "Broken Object Level Authorization",
    description:
      "The endpoint fetches an order by ID without verifying that the requesting user actually owns it.",
    severity: "high",
    confidence: 94,
    file: "api/orders/views.py",
    line: 42,
    cwe: "CWE-639",
    owaspCategory: "API1:2023 — Broken Object Level Authorization",
    cve: null,
    codeEvidence: "order = Order.objects.get(id=order_id)\nreturn Response(OrderSerializer(order).data)",
    impact: "Any authenticated user can enumerate `order_id` values and read other customers' orders.",
    aiAnalysis:
      "I traced the request from the route through the view to this query. Ownership (`order.user == request.user`) is checked nowhere on this path — compare with `api/orders/cancel.py`, which does check it.",
    remediation: "Filter the queryset by the requesting user before returning the object, or 404 on mismatch.",
    suggestedFix: "order = Order.objects.get(id=order_id, user=request.user)\nreturn Response(OrderSerializer(order).data)",
    source: "AI_AGENT",
    status: "open",
  },
  {
    id: "f-ssrf-webhook",
    scan: "demo",
    title: "Server-Side Request Forgery",
    description: "A user-supplied URL is fetched server-side with no allowlist or private-range check.",
    severity: "high",
    confidence: 88,
    file: "services/webhook.py",
    line: 91,
    cwe: "CWE-918",
    owaspCategory: "API7:2023 — Server Side Request Forgery",
    cve: null,
    codeEvidence: "resp = requests.post(webhook_url, json=payload)",
    impact: "An attacker can point `webhook_url` at internal-only services (e.g. cloud metadata endpoints).",
    aiAnalysis: "No scheme, host, or IP-range restriction exists before this request is made.",
    remediation: "Validate the URL against an allowlist and reject requests to private/link-local address ranges.",
    suggestedFix: null,
    source: "SAST",
    status: "open",
  },
  {
    id: "f-header-missing",
    scan: "demo",
    title: "Missing Security Header",
    description: "Responses do not set `Strict-Transport-Security`.",
    severity: "medium",
    confidence: 100,
    file: "middleware/security.py",
    line: 27,
    cwe: "CWE-693",
    owaspCategory: "A05:2021 — Security Misconfiguration",
    cve: null,
    codeEvidence: "response['X-Content-Type-Options'] = 'nosniff'\n# HSTS not set",
    impact: "Downgrade attacks can force plaintext HTTP on first visit.",
    aiAnalysis: null,
    remediation: "Set `Strict-Transport-Security: max-age=63072000; includeSubDomains` on all responses.",
    suggestedFix: null,
    source: "CUSTOM_RULE",
    status: "open",
  },
];

export const SAMPLE_DEPENDENCIES: Dependency[] = [
  {
    id: "d-lodash",
    name: "lodash",
    version: "4.17.15",
    ecosystem: "npm",
    severity: "high",
    cve: "CVE-2020-8203",
    summary: "Prototype pollution in `zipObjectDeep`.",
  },
  {
    id: "d-axios",
    name: "axios",
    version: "0.21.1",
    ecosystem: "npm",
    severity: "medium",
    cve: "CVE-2021-3749",
    summary: "ReDoS via crafted response headers.",
  },
  {
    id: "d-pyyaml",
    name: "pyyaml",
    version: "5.3.1",
    ecosystem: "pypi",
    severity: "high",
    cve: "CVE-2020-14343",
    summary: "Arbitrary code execution via `yaml.load` on untrusted input.",
  },
  {
    id: "d-django",
    name: "django",
    version: "5.0.14",
    ecosystem: "pypi",
    severity: null,
    cve: null,
    summary: null,
  },
];

export const SAMPLE_SECRETS: SecretFinding[] = [
  {
    id: "s-env-example",
    file: ".env.example",
    line: 14,
    ruleName: "Generic API Key",
    detectedBy: "Secrets Scanner",
    masked: "sk_live_****************3f2a",
  },
];

export const SAMPLE_CI: CIStatus = {
  provider: "github",
  connected: true,
  lastCommitSha: "a83fd92",
  gatePassed: false,
  criticalCount: 2,
  highCount: 2,
  secretsCount: 1,
};
