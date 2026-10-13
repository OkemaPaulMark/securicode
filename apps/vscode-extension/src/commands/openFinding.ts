import * as vscode from "vscode";

import { securityState } from "../state/securityState";
import { FindingDetailPanel } from "../views/findingDetailPanel";

export async function openFinding(findingId: string): Promise<void> {
  FindingDetailPanel.show(findingId);
}

/** Jumps to the finding's real location in the editor, if the file exists on disk. */
export async function openFindingLocation(findingId: string): Promise<void> {
  const finding = securityState.findFinding(findingId);
  if (!finding) return;

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("SecureCode: no workspace folder is open.");
    return;
  }

  const uri = vscode.Uri.joinPath(folder.uri, finding.file);
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    const line = Math.max(finding.line - 1, 0);
    const range = new vscode.Range(line, 0, line, 0);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  } catch {
    vscode.window.showWarningMessage(`SecureCode: ${finding.file} not found in this workspace (example finding).`);
  }
}
