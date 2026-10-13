import * as vscode from "vscode";

/** TODO: wire to the `reports` app once it exists (Sheet 23) — async render + signed download URL. */
export async function generateReport(): Promise<void> {
  vscode.window.showInformationMessage("SecureCode: report generation isn't connected to the backend yet.");
}
