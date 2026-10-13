/**
 * The finding detail screen (brief Sheet 6): meta grid, description,
 * evidence, impact, AI analysis, remediation, and the actions that start
 * the rest of the journey (open file, ask the agent, suggest a fix).
 */
import * as vscode from "vscode";

import { Finding, Severity } from "../api-client/types";
import { securityState } from "../state/securityState";

const SEVERITY_ICON: Record<Severity, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };

export class FindingDetailPanel {
  private static current: FindingDetailPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private findingId: string;

  static show(findingId: string) {
    if (FindingDetailPanel.current) {
      FindingDetailPanel.current.findingId = findingId;
      FindingDetailPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      FindingDetailPanel.current.render();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "securecode.findingDetail",
      "Security Finding",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    FindingDetailPanel.current = new FindingDetailPanel(panel, findingId);
  }

  private constructor(panel: vscode.WebviewPanel, findingId: string) {
    this.panel = panel;
    this.findingId = findingId;

    this.panel.onDidDispose(() => {
      FindingDetailPanel.current = undefined;
    });

    this.panel.webview.onDidReceiveMessage(async (message) => {
      const finding = securityState.findFinding(this.findingId);
      if (!finding) return;
      switch (message.command) {
        case "openFile":
          await vscode.commands.executeCommand("securecode.openFindingLocation", finding.id);
          break;
        case "explainWithAI":
          await vscode.commands.executeCommand("securecode.explainWithAI", finding.id);
          break;
        case "suggestFix":
          await vscode.commands.executeCommand("securecode.suggestFix", finding.id);
          break;
        case "rescan":
          await vscode.commands.executeCommand("securecode.scanWorkspace");
          break;
      }
    });

    securityState.onDidChange(() => this.render());
    this.render();
  }

  private render() {
    const finding = securityState.findFinding(this.findingId);
    this.panel.title = finding ? finding.title : "Security Finding";
    this.panel.webview.html = finding ? html(finding) : `<p>Finding not found.</p>`;
  }
}

function html(f: Finding): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" />${styles()}</head>
<body>
  <div class="header">
    <span class="sev-icon">${SEVERITY_ICON[f.severity]}</span>
    <h1>${escape(f.title)}</h1>
    ${f.status === "resolved" ? '<span class="resolved-badge">✓ Resolved</span>' : ""}
  </div>

  <div class="meta-grid">
    <div><div class="meta-label">Severity</div><div class="meta-value sev-${f.severity}">${f.severity.toUpperCase()}</div></div>
    <div><div class="meta-label">Confidence</div><div class="meta-value">${f.confidence}%</div></div>
    <div><div class="meta-label">Location</div><div class="meta-value mono">${escape(f.file)}:${f.line}</div></div>
    <div><div class="meta-label">OWASP</div><div class="meta-value">${f.owaspCategory ? escape(f.owaspCategory) : "—"}</div></div>
    <div><div class="meta-label">CWE</div><div class="meta-value">${f.cwe ?? "—"}</div></div>
    <div><div class="meta-label">Detected by</div><div class="meta-value">${f.source.replace("_", " ")}</div></div>
  </div>

  <section><h2>Description</h2><p>${escape(f.description)}</p></section>

  ${f.codeEvidence ? `<section><h2>Evidence</h2><pre class="code"><code>${escape(f.codeEvidence)}</code></pre></section>` : ""}

  ${f.impact ? `<section><h2>Impact</h2><p>${escape(f.impact)}</p></section>` : ""}

  ${f.aiAnalysis ? `<section class="ai-section"><h2>🤖 AI Analysis</h2><p>${escape(f.aiAnalysis)}</p></section>` : ""}

  ${f.remediation ? `<section><h2>Remediation</h2><p>${escape(f.remediation)}</p></section>` : ""}

  <div class="actions">
    <button data-cmd="openFile">Open File</button>
    <button data-cmd="explainWithAI">Explain with AI</button>
    ${f.suggestedFix ? '<button data-cmd="suggestFix">Suggest Fix</button>' : ""}
    <button data-cmd="rescan" class="secondary">Rescan</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-cmd]').forEach((el) => {
      el.addEventListener('click', () => vscode.postMessage({ command: el.getAttribute('data-cmd') }));
    });
  </script>
</body></html>`;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function styles(): string {
  return `<style>
    :root {
      --sc-critical: #f14c4c; --sc-high: #e2913a; --sc-medium: #dbb440; --sc-low: #4f9cd6;
    }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px 32px 48px; max-width: 760px; }
    .header { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
    .sev-icon { font-size: 20px; }
    h1 { font-size: 20px; margin: 0; }
    .resolved-badge { margin-left: auto; font-size: 12px; color: #3fb950; font-weight: 600; }
    .meta-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 14px;
      padding: 14px 16px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border);
      border-radius: 6px; margin-bottom: 20px;
    }
    .meta-label { font-size: 10px; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); margin-bottom: 3px; }
    .meta-value { font-size: 13px; font-weight: 600; }
    .meta-value.mono { font-family: var(--vscode-editor-font-family); font-weight: 400; }
    .sev-critical { color: var(--sc-critical); } .sev-high { color: var(--sc-high); }
    .sev-medium { color: var(--sc-medium); } .sev-low { color: var(--sc-low); }
    section { margin-bottom: 20px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); margin: 0 0 8px; }
    p { line-height: 1.55; margin: 0; font-size: 13px; }
    .code {
      background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-widget-border);
      border-left: 3px solid var(--sc-critical); border-radius: 4px; padding: 12px 14px; overflow-x: auto;
      font-family: var(--vscode-editor-font-family); font-size: 12.5px;
    }
    .ai-section { padding: 12px 14px; background: var(--vscode-textBlockQuote-background); border-radius: 6px; }
    .actions { display: flex; gap: 8px; margin-top: 28px; flex-wrap: wrap; }
    button {
      padding: 6px 14px; border-radius: 3px; border: none; cursor: pointer; font-family: inherit; font-size: 12.5px;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-left: auto; }
  </style>`;
}
