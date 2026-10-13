import * as vscode from "vscode";

/** Opens the React web dashboard (not scaffolded yet) for the current project. */
export async function openDashboard(): Promise<void> {
  const base = vscode.workspace.getConfiguration("securecode").get<string>("apiBaseUrl", "http://localhost:8000");
  await vscode.env.openExternal(vscode.Uri.parse(base));
}
