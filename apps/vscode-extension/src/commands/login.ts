import * as vscode from "vscode";

import { loginWithCredentials } from "../auth/authManager";
import { securityState } from "../state/securityState";

export async function login(_context: vscode.ExtensionContext): Promise<void> {
  const username = await vscode.window.showInputBox({ prompt: "SecureCode username" });
  if (!username) return;

  const password = await vscode.window.showInputBox({ prompt: "SecureCode password", password: true });
  if (!password) return;

  try {
    await loginWithCredentials(username, password);
    // organizations isn't wired up on the backend yet (Sheet 04) — shown
    // as "—" rather than guessed at.
    securityState.setSession({ username, organization: "—" });
    vscode.window.showInformationMessage("SecureCode: signed in.");
  } catch (err) {
    vscode.window.showErrorMessage(`SecureCode: sign-in failed — ${(err as Error).message}`);
  }
}
