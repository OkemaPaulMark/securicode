/**
 * Renders Finding[] from the API as VS Code Diagnostics. This is the only
 * place severity-to-color / squiggle mapping happens (Sheet 16).
 */
import * as vscode from "vscode";

import { Finding, Severity } from "../api-client/types";

export type DiagnosticsController = vscode.DiagnosticCollection;

export function createDiagnosticCollection(): DiagnosticsController {
  return vscode.languages.createDiagnosticCollection("securecode");
}

const SEVERITY_MAP: Record<Severity, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Error,
  high: vscode.DiagnosticSeverity.Error,
  medium: vscode.DiagnosticSeverity.Warning,
  low: vscode.DiagnosticSeverity.Information,
};

export function publishFindings(diagnostics: DiagnosticsController, workspaceRoot: vscode.Uri, findings: Finding[]) {
  const byFile = new Map<string, vscode.Diagnostic[]>();

  for (const finding of findings) {
    const uri = vscode.Uri.joinPath(workspaceRoot, finding.file).toString();
    const line = Math.max(finding.line - 1, 0);
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);

    const diagnostic = new vscode.Diagnostic(range, finding.title, SEVERITY_MAP[finding.severity]);
    diagnostic.source = "SecureCode";
    diagnostic.code = finding.cwe ?? finding.owaspCategory ?? undefined;

    const list = byFile.get(uri) ?? [];
    list.push(diagnostic);
    byFile.set(uri, list);
  }

  diagnostics.clear();
  for (const [uri, list] of byFile) {
    diagnostics.set(vscode.Uri.parse(uri), list);
  }
}
