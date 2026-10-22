import type { AssessmentState, Finding, Severity, SeverityCounts } from "../api/types";

export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const STATE_LABEL: Record<AssessmentState, string> = {
  queued: "Queued",
  running_scans: "Running scans",
  ai_analysing: "AI analysing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const isActive = (s: AssessmentState) => s === "queued" || s === "running_scans" || s === "ai_analysing";

export const STATUS_LABEL: Record<Finding["status"], string> = {
  validated: "Confirmed",
  false_positive: "False positive",
  needs_review: "Needs review",
  unvalidated: "Not validated",
};

export const DECISION_LABEL = { approved: "Fix approved", rejected: "Fix rejected", false_positive: "Marked false positive" } as const;

export const SOURCE_LABEL = { zip: "ZIP upload", github: "GitHub", gitlab: "GitLab" } as const;

export function total(c: SeverityCounts): number {
  return c.critical + c.high + c.medium + c.low;
}

export function countBySeverity(findings: Finding[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) if (f.status !== "false_positive") c[f.severity] += 1;
  return c;
}

const rtf = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["minute", 60], ["hour", 3600], ["day", 86400], ["week", 604800]];
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let size = 60;
  for (const [u, s] of units) if (abs >= s) { unit = u; size = s; }
  if (abs >= 604800 * 5) return dateTime(iso);
  const value = Math.round(diff / size);
  return rtf ? rtf.format(value, unit) : `${Math.abs(value)} ${unit}s ago`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function duration(fromIso?: string | null, toIso?: string | null): string {
  if (!fromIso || !toIso) return "";
  const s = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60 ? `${s % 60} s` : ""}`.trim() : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function sortFindings(list: Finding[], by: "severity" | "confidence" | "file" | "status"): Finding[] {
  const out = [...list];
  const sev = (a: Finding, b: Finding) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.confidence - a.confidence;
  if (by === "severity") out.sort(sev);
  if (by === "confidence") out.sort((a, b) => b.confidence - a.confidence || sev(a, b));
  if (by === "file") out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  if (by === "status") out.sort((a, b) => a.status.localeCompare(b.status) || sev(a, b));
  return out;
}

export function download(name: string, data: Blob | string, type = "text/plain"): void {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Matches a finding across two assessments of the same project (REPT-4). */
export const findingKey = (f: Finding) => `${f.title}|${f.file}`;
