import * as vscode from "vscode";

export async function showFindings(): Promise<void> {
  await vscode.commands.executeCommand("securecode.findings.focus");
}
