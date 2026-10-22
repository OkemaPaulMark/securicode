/**
 * Data shapes used by the web app.
 * Identity types mirror services/gateway (auth_routes.py, admin_routes.py).
 * Platform types (projects, assessments, findings) follow the SRS (ASMT-3, REV-2) and the finding format in the
 * Securicode guide, chapter 8. The contract the backend services must honour is in apps/web/API_CONTRACT.md.
 */

// ---------------------------------------------------------------- identity (gateway)
export type Role = "user" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  email_verified: boolean;
  created_at: string;
}

export interface TokenIssued {
  id: string;
  name: string;
  scope: string;
  token: string;
  access_token: string;
  token_type: string;
  expires_in: number;
  idle_timeout: number;
}

export interface GitToken {
  id: string;
  provider: "github" | "gitlab";
  host: string;
  label: string;
  masked: string;
  created_at: string;
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
  user_id?: string | null;
}

export interface SystemStatus {
  gateway: string;
  services: Record<string, string>;
  routes: Record<string, string>;
}

// ---------------------------------------------------------------- platform (project / scan / ai / reporting)
export type Severity = "critical" | "high" | "medium" | "low";
export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export type SeverityCounts = Record<Severity, number>;

export type SourceType = "zip" | "github" | "gitlab";

/** ASMT-3 states. */
export type AssessmentState = "queued" | "running_scans" | "ai_analysing" | "completed" | "failed" | "cancelled";

export type ToolState = "pending" | "running" | "done" | "failed" | "timed_out" | "skipped";

export interface ToolRun {
  name: string;
  version?: string;
  state: ToolState;
  alerts?: number;
  reason?: string;
}

export interface Funnel {
  raw: number;        // alerts from all scanners
  merged: number;     // after duplicates were merged (ORCH-6)
  validated: number;  // confirmed by the AI agent (AGNT-2)
  approved: number;   // fixes approved by a person (REV-4)
}

export interface AssessmentSummary {
  id: string;
  number: number;
  state: AssessmentState;
  created_at: string;
  finished_at?: string | null;
  counts: SeverityCounts;
}

export interface Assessment extends AssessmentSummary {
  project_id: string;
  project_name: string;
  started_at?: string | null;
  source_label: string;           // "main @ 4f2a91c" or "upload, 12 Oct 14:02"
  failure_reason?: string | null;
  tools: ToolRun[];
  /** SEC-7: the interface must say whether an external or a local model is in use. */
  ai: { analysed: number; total: number; available: boolean; model?: string; model_location?: "external" | "local" };
  funnel: Funnel;
  status_counts: Record<FindingStatus, number>;
}

export interface Project {
  id: string;
  name: string;
  source_type: SourceType;
  repo_url?: string | null;
  branch?: string | null;
  created_at: string;
  latest_assessment: AssessmentSummary | null;
  assessment_count: number;
}

export type FindingStatus = "validated" | "false_positive" | "needs_review" | "unvalidated";
export type Decision = "approved" | "rejected" | "false_positive";

export interface Reference {
  title: string;
  url?: string;
}

export interface Finding {
  id: string;                       // "F-0012"
  title: string;
  cwe?: string | null;              // "CWE-89"
  owasp?: string | null;            // "A03:2021 Injection"
  file: string;
  line: number;
  end_line?: number;
  detected_by: string[];            // ["semgrep", "sonarqube"]
  evidence: string;                 // the agent's justification (AGNT-3)
  evidence_lines?: { file: string; line: number; code: string }[];
  code?: string | null;             // snippet around the finding
  severity: Severity;
  confidence: number;               // 0..1
  status: FindingStatus;
  explanation: string;
  remediation: string;
  remediation_steps?: string[];     // EXPL-6 when no safe diff exists
  references: Reference[];
  proposed_fix: { diff: string } | null;
  related?: string[];               // AGNT-5
  manipulation_attempt?: boolean;   // AGNT-7 / SEC-8
  decision?: Decision | null;
  decided_by?: string | null;
  decided_at?: string | null;
  decision_comment?: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: Reference[];
  at: string;
}

export interface Comparison {
  base: AssessmentSummary;
  head: AssessmentSummary;
  new: Finding[];
  resolved: Finding[];
  unchanged: Finding[];
}

export interface NewRepoProject {
  name: string;
  source_type: "github" | "gitlab";
  repo_url: string;
  branch: string;
  git_token_id?: string | null;
}
