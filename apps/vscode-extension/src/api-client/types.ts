/**
 * Shapes mirrored from the Django API (Sheet 19/12). Kept in sync by hand
 * for now; a generated client from /api/schema/ (drf-spectacular) can
 * replace this once the API stabilizes.
 */

export interface TokenIssued {
  id: string;
  name: string;
  scope: "cli" | "vscode" | "ci";
  token: string;
}

export type ScanStatus =
  | "QUEUED"
  | "PREPARING"
  | "ACQUIRING_SOURCE"
  | "ANALYZING"
  | "AI_REVIEW"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface Scan {
  id: string;
  project: string;
  status: ScanStatus;
}

export type Severity = "critical" | "high" | "medium" | "low";

export interface Finding {
  id: string;
  scan: string;
  title: string;
  description: string;
  severity: Severity;
  confidence: number; // 0-100
  file: string;
  line: number;
  cwe: string | null;
  owaspCategory: string | null;
  cve: string | null;
  codeEvidence: string | null;
  impact: string | null;
  aiAnalysis: string | null;
  remediation: string | null;
  suggestedFix: string | null; // replacement source for codeEvidence, when available
  source: "AI_AGENT" | "SAST" | "SCA" | "SECRETS" | "CUSTOM_RULE";
  status: "open" | "triaged" | "resolved" | "accepted_risk";
}

export interface Dependency {
  id: string;
  name: string;
  version: string;
  ecosystem: string;
  severity: Severity | null; // null = no known issue
  cve: string | null;
  summary: string | null;
}

export interface SecretFinding {
  id: string;
  file: string;
  line: number;
  ruleName: string;
  detectedBy: string;
  masked: string; // e.g. "sk_live_****************3f2a"
}

export interface CIStatus {
  provider: "github" | "gitlab" | null;
  connected: boolean;
  lastCommitSha: string | null;
  gatePassed: boolean | null;
  criticalCount: number;
  highCount: number;
  secretsCount: number;
}

export type ScanStageKey =
  | "detect_project"
  | "detect_framework"
  | "analyze_source"
  | "check_dependencies"
  | "detect_secrets"
  | "security_analysis"
  | "ai_review"
  | "finalizing";

export interface ScanStage {
  key: ScanStageKey;
  label: string;
}

export const SCAN_STAGES: ScanStage[] = [
  { key: "detect_project", label: "Detecting project" },
  { key: "detect_framework", label: "Detecting framework" },
  { key: "analyze_source", label: "Analyzing source code" },
  { key: "check_dependencies", label: "Checking dependencies" },
  { key: "detect_secrets", label: "Detecting secrets" },
  { key: "security_analysis", label: "Running security analysis" },
  { key: "ai_review", label: "AI Security Agent" },
  { key: "finalizing", label: "Finalizing findings" },
];

export interface ChatActivityStep {
  label: string;
  done: boolean;
}

export interface ChatMessage {
  id: string;
  role: "agent" | "user";
  text: string;
  activity?: ChatActivityStep[];
  referencedFinding?: string;
  referencedFile?: string;
  confidence?: number;
  timestamp: number;
}
