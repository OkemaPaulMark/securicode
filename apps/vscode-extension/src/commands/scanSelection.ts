import * as vscode from "vscode";

import { Finding } from "../api-client/types";
import { findFindingNear } from "../findingLookup";
import { securityState } from "../state/securityState";

/** Checks the current scan's findings against the selected lines — see the demo-data caveat in scanWorkspace.ts. */
export async function scanSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage("SecureCode: select some code first.");
    return;
  }
  if (!securityState.hasScanned) {
    vscode.window.showInformationMessage("SecureCode: run Scan Workspace first so there's something to check against.");
    return;
  }

  const start = editor.selection.start.line;
  const end = editor.selection.end.line;
  const matches: Finding[] = [];
  for (let line = start; line <= end; line++) {
    const finding = findFindingNear(editor.document, line);
    if (finding && !matches.includes(finding)) matches.push(finding);
  }

  if (matches.length === 0) {
    vscode.window.showInformationMessage("SecureCode: no known findings in this selection.");
    return;
  }
  vscode.window
    .showInformationMessage(`SecureCode: ${matches.length} finding(s) touch this selection: ${matches.map((f) => f.title).join(", ")}`, "Open First")
    .then((choice) => choice && vscode.commands.executeCommand("securecode.openFinding", matches[0].id));
}
