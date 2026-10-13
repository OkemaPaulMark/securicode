import * as vscode from "vscode";

import { SAMPLE_FINDINGS } from "../fixtures/sampleScanResult";
import { securityState } from "../state/securityState";

/** Scans just the active file — same demo-data caveat as scanWorkspace.ts. */
export async function scanFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("SecureCode: open a file to scan.");
    return;
  }

  const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `SecureCode: scanning ${relativePath}` },
    async () => new Promise((resolve) => setTimeout(resolve, 900)),
  );

  const fileFindings = SAMPLE_FINDINGS.filter((f) => f.file === relativePath);
  const others = securityState.findings.filter((f) => f.file !== relativePath);

  securityState.completeScan({
    findings: [...others, ...fileFindings],
    dependencies: securityState.dependencies,
    secrets: securityState.secrets,
    ci: securityState.ci,
  });

  if (fileFindings.length === 0) {
    vscode.window.showInformationMessage(`SecureCode: no findings in ${relativePath}.`);
  } else {
    vscode.window
      .showInformationMessage(`SecureCode: ${fileFindings.length} finding(s) in ${relativePath}.`, "View Findings")
      .then((choice) => choice && vscode.commands.executeCommand("securecode.showFindings"));
  }
}
