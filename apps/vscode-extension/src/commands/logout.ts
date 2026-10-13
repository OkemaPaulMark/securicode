import * as vscode from "vscode";

import { logout as clearSession } from "../auth/authManager";
import { securityState } from "../state/securityState";

export async function logout(_context: vscode.ExtensionContext): Promise<void> {
  await clearSession();
  securityState.setSession(null);
  vscode.window.showInformationMessage("SecureCode: signed out.");
}
