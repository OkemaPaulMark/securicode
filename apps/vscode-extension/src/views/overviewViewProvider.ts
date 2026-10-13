/**
 * The sidebar's primary panel (brief Sheet 2): auth state, security score,
 * severity summary, main actions, and a compact CI/CD status line. A
 * WebviewView rather than a TreeView because it needs a gauge and buttons,
 * not a list — everything else in the sidebar (Findings/Dependencies/
 * Secrets) is a native TreeView instead.
 */
import * as vscode from "vscode";

import { SCAN_STAGES, Severity } from "../api-client/types";
import { SecurityScore, securityState } from "../state/securityState";

export class OverviewViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "securecode.overview";

  private view: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {
    securityState.onDidChange(() => this.render());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "signIn":
          vscode.commands.executeCommand("securecode.login");
          break;
        case "signOut":
          vscode.commands.executeCommand("securecode.logout");
          break;
        case "scanWorkspace":
          vscode.commands.executeCommand("securecode.scanWorkspace");
          break;
        case "scanFile":
          vscode.commands.executeCommand("securecode.scanFile");
          break;
        case "openFindings":
          vscode.commands.executeCommand("securecode.showFindings");
          break;
        case "openAgent":
          vscode.commands.executeCommand("securecode.askAgent");
          break;
        case "retryScan":
          vscode.commands.executeCommand("securecode.scanWorkspace");
          break;
      }
    });

    this.render();
  }

  private render() {
    if (this.view) {
      this.view.webview.html = this.html();
    }
  }

  private html(): string {
    const s = securityState;
    const score = s.score;
    const counts = s.severityCounts;

    // Signing in is optional — it only matters once the backend AI agent
    // is actually connected (see chatPanel.ts). Nothing here is gated on it.
    const authSection = s.isSignedIn
      ? `<div class="session">
           <div class="session-row"><span class="muted">Signed in as</span><strong>${escape(s.session!.username)}</strong></div>
           <button class="link-btn" data-cmd="signOut">Sign out</button>
         </div>`
      : `<div class="session">
           <span class="muted">Not signed in</span>
           <button class="link-btn" data-cmd="signIn">Sign in</button>
         </div>`;

    const body =
      s.scanRun.phase === "running"
        ? this.scanningHtml()
        : s.scanRun.phase === "failed"
          ? `<div class="empty-state error">
               <p>Scan failed${s.scanRun.error ? `: ${escape(s.scanRun.error)}` : "."}</p>
               <button class="primary" data-cmd="retryScan">Retry Scan</button>
             </div>`
          : !s.hasScanned
            ? `<div class="empty-state">
                 <p>No security scan yet. Analyze this workspace to discover security vulnerabilities.</p>
                 <button class="primary" data-cmd="scanWorkspace">Scan Workspace</button>
               </div>`
            : this.resultsHtml(score, counts);

    const actions = `<div class="actions">
           <button class="primary" data-cmd="scanWorkspace" ${s.scanRun.phase === "running" ? "disabled" : ""}>Scan Workspace</button>
           <button class="secondary" data-cmd="scanFile" ${s.scanRun.phase === "running" ? "disabled" : ""}>Scan Current File</button>
         </div>`;

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" />${styles()}</head>
<body>
  ${authSection}
  ${actions}
  ${body}
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-cmd]').forEach((el) => {
      el.addEventListener('click', () => vscode.postMessage({ command: el.getAttribute('data-cmd') }));
    });
  </script>
</body>
</html>`;
  }

  private scanningHtml(): string {
    const s = securityState;
    const rows = SCAN_STAGES.map((stage) => {
      const done = s.scanRun.completedStages.includes(stage.key);
      const current = s.scanRun.currentStage === stage.key;
      const icon = done ? "✓" : current ? "◉" : "○";
      const cls = done ? "done" : current ? "current" : "pending";
      return `<div class="stage ${cls}"><span class="stage-icon">${icon}</span>${escape(stage.label)}</div>`;
    }).join("");
    const total = SCAN_STAGES.length;
    const doneCount = s.scanRun.completedStages.length;
    const pct = Math.round((doneCount / total) * 100);
    return `<div class="scan-progress">
      <div class="section-title">SCANNING</div>
      ${rows}
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  }

  private resultsHtml(score: SecurityScore, counts: Record<Severity, number>): string {
    const scoreColorVar = score.value >= 75 ? "success" : score.value >= 50 ? "medium" : "critical";
    return `
    <div class="score-card">
      <div class="section-title">SECURITY SCORE</div>
      <div class="score-row">
        <div class="score-value" style="color:var(--sc-${scoreColorVar})">${score.value}<span class="score-max">/100</span></div>
        <div class="score-label">Security posture: <strong>${score.label}</strong></div>
      </div>
    </div>
    <div class="summary-card">
      <div class="section-title">FINDINGS</div>
      <div class="sev-row"><span class="dot critical"></span>Critical<span class="count">${counts.critical}</span></div>
      <div class="sev-row"><span class="dot high"></span>High<span class="count">${counts.high}</span></div>
      <div class="sev-row"><span class="dot medium"></span>Medium<span class="count">${counts.medium}</span></div>
      <div class="sev-row"><span class="dot low"></span>Low<span class="count">${counts.low}</span></div>
      <button class="link-btn" data-cmd="openFindings">View all findings →</button>
    </div>
    <div class="summary-card">
      <div class="section-title">AI SECURITY AGENT</div>
      <p class="muted">Ask about any finding, endpoint, or dependency in this project.</p>
      <button class="secondary" data-cmd="openAgent">Ask Security Agent</button>
    </div>
    <div class="summary-card">
      <div class="section-title">CI/CD</div>
      ${ciHtml()}
    </div>
    <p class="demo-note">Showing example data — connect a scan to replace this with real results.</p>`;
  }
}

function ciHtml(): string {
  const ci = securityState.ci;
  if (!ci.connected) {
    return `<p class="muted">Not connected.</p>`;
  }
  const gate = ci.gatePassed
    ? `<span class="gate pass">✓ Security gate passed</span>`
    : `<span class="gate fail">✗ Security gate failed</span>`;
  return `<div class="ci-row"><span class="muted">${ci.provider === "github" ? "GitHub" : "GitLab"}</span><span>✓ Connected</span></div>
          <div class="ci-row"><span class="muted">Last commit</span><span>${ci.lastCommitSha}</span></div>
          <div class="ci-row">${gate}</div>`;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function styles(): string {
  return `<style>
    :root {
      --sc-critical: #f14c4c;
      --sc-high: #e2913a;
      --sc-medium: #dbb440;
      --sc-low: #4f9cd6;
      --sc-success: #3fb950;
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      padding: 4px 2px 16px;
    }
    .section-title {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
      margin: 14px 0 8px;
    }
    button { font-family: inherit; cursor: pointer; border-radius: 3px; border: none; }
    .primary {
      width: 100%; padding: 6px 10px; margin-bottom: 6px;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    }
    .primary:hover { background: var(--vscode-button-hoverBackground); }
    .primary:disabled { opacity: 0.5; cursor: default; }
    .secondary {
      width: 100%; padding: 6px 10px;
      background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    }
    .secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .link-btn {
      background: none; color: var(--vscode-textLink-foreground); padding: 4px 0; font-size: 12px;
    }
    .link-btn:hover { text-decoration: underline; }
    .muted { color: var(--vscode-descriptionForeground); }
    .actions { margin: 10px 0 4px; }
    .empty-state { padding: 10px 0; }
    .empty-state p { color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
    .empty-state.error p { color: var(--sc-critical); }
    .session { display: flex; flex-direction: column; gap: 2px; padding-bottom: 8px; border-bottom: 1px solid var(--vscode-widget-border); }
    .session-row { display: flex; justify-content: space-between; gap: 8px; }
    .score-card, .summary-card { padding-top: 4px; }
    .score-row { display: flex; align-items: baseline; gap: 10px; }
    .score-value { font-size: 30px; font-weight: 700; }
    .score-max { font-size: 13px; color: var(--vscode-descriptionForeground); font-weight: 400; }
    .score-label { font-size: 12px; color: var(--vscode-descriptionForeground); }
    .sev-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
    .sev-row .count { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; }
    .dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
    .dot.critical { background: var(--sc-critical); }
    .dot.high { background: var(--sc-high); }
    .dot.medium { background: var(--sc-medium); }
    .dot.low { background: var(--sc-low); }
    .ci-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
    .gate { font-weight: 600; }
    .gate.pass { color: var(--sc-success); }
    .gate.fail { color: var(--sc-critical); }
    .demo-note { margin-top: 14px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic; }
    .scan-progress .stage { display: flex; gap: 8px; padding: 3px 0; font-size: 12px; }
    .scan-progress .stage.done { color: var(--vscode-descriptionForeground); }
    .scan-progress .stage.current { color: var(--vscode-foreground); font-weight: 600; }
    .scan-progress .stage.pending { color: var(--vscode-descriptionForeground); opacity: 0.6; }
    .stage-icon { width: 14px; display: inline-block; }
    .progress-track { height: 4px; background: var(--vscode-widget-border); border-radius: 2px; margin-top: 10px; overflow: hidden; }
    .progress-fill { height: 100%; background: var(--vscode-progressBar-background, #0078d4); }
  </style>`;
}
