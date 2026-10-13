/**
 * Single in-memory source of truth for everything the UI renders: auth,
 * the current/last scan, and its findings/dependencies/secrets. Every view
 * (overview webview, findings tree, status bar, diagnostics) reads from
 * here and re-renders on `onDidChange` rather than holding its own copy.
 *
 * This intentionally mirrors Scan/Finding ownership from the backend
 * (Sheet 06) — it is a read-through cache of what the API would return,
 * not a place for new business logic.
 */
import * as vscode from "vscode";

import { CIStatus, Dependency, Finding, ScanStageKey, SecretFinding, Severity } from "../api-client/types";

export type ScanPhase = "idle" | "running" | "completed" | "failed";

export interface ScanRunState {
  phase: ScanPhase;
  currentStage: ScanStageKey | null;
  completedStages: ScanStageKey[];
  error?: string;
}

export interface SessionInfo {
  username: string;
  organization: string;
}

export interface SecurityScore {
  value: number; // 0-100
  label: "Excellent" | "Good" | "Moderate" | "Weak" | "Critical";
}

function scoreLabel(value: number): SecurityScore["label"] {
  if (value >= 90) return "Excellent";
  if (value >= 75) return "Good";
  if (value >= 50) return "Moderate";
  if (value >= 25) return "Weak";
  return "Critical";
}

class SecurityState {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  session: SessionInfo | null = null;

  scanRun: ScanRunState = { phase: "idle", currentStage: null, completedStages: [] };
  lastScanAt: number | null = null;

  findings: Finding[] = [];
  dependencies: Dependency[] = [];
  secrets: SecretFinding[] = [];
  ci: CIStatus = {
    provider: null,
    connected: false,
    lastCommitSha: null,
    gatePassed: null,
    criticalCount: 0,
    highCount: 0,
    secretsCount: 0,
  };

  get isSignedIn(): boolean {
    return this.session !== null;
  }

  get hasScanned(): boolean {
    return this.lastScanAt !== null;
  }

  get score(): SecurityScore {
    if (!this.hasScanned) return { value: 0, label: "Critical" };
    const weight: Record<Severity, number> = { critical: 20, high: 10, medium: 4, low: 1 };
    const penalty = this.findings.reduce((sum, f) => sum + weight[f.severity], 0);
    const value = Math.max(0, 100 - penalty);
    return { value, label: scoreLabel(value) };
  }

  get severityCounts(): Record<Severity, number> {
    const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of this.findings) counts[f.severity]++;
    return counts;
  }

  findFinding(id: string): Finding | undefined {
    return this.findings.find((f) => f.id === id);
  }

  setSession(session: SessionInfo | null) {
    this.session = session;
    this.notify();
  }

  beginScan() {
    this.scanRun = { phase: "running", currentStage: null, completedStages: [] };
    this.notify();
  }

  advanceScan(stage: ScanStageKey) {
    if (this.scanRun.currentStage) {
      this.scanRun.completedStages.push(this.scanRun.currentStage);
    }
    this.scanRun.currentStage = stage;
    this.notify();
  }

  completeScan(result: { findings: Finding[]; dependencies: Dependency[]; secrets: SecretFinding[]; ci: CIStatus }) {
    if (this.scanRun.currentStage) {
      this.scanRun.completedStages.push(this.scanRun.currentStage);
    }
    this.scanRun = { phase: "completed", currentStage: null, completedStages: this.scanRun.completedStages };
    this.findings = result.findings;
    this.dependencies = result.dependencies;
    this.secrets = result.secrets;
    this.ci = result.ci;
    this.lastScanAt = Date.now();
    this.notify();
  }

  failScan(error: string) {
    this.scanRun = { phase: "failed", currentStage: null, completedStages: this.scanRun.completedStages, error };
    this.notify();
  }

  resolveFinding(id: string) {
    const finding = this.findFinding(id);
    if (finding) {
      finding.status = "resolved";
      this.notify();
    }
  }

  notify() {
    this._onDidChange.fire();
  }
}

export const securityState = new SecurityState();
