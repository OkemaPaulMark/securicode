/**
 * Holds the platform APIToken (Sheet 21) in VS Code's SecretStorage —
 * never in a plain settings file. The extension holds exactly one secret:
 * this token. It never sees an LLM key, a vector-store credential, or a
 * repository access token — those stay server-side.
 */
import * as vscode from "vscode";

const SECRET_KEY = "securecode.apiToken";

let extensionContext: vscode.ExtensionContext | undefined;

export function initTokenStore(context: vscode.ExtensionContext) {
  extensionContext = context;
}

export async function getToken(): Promise<string | undefined> {
  return extensionContext?.secrets.get(SECRET_KEY);
}

export async function setToken(token: string): Promise<void> {
  await extensionContext?.secrets.store(SECRET_KEY, token);
}

export async function clearToken(): Promise<void> {
  await extensionContext?.secrets.delete(SECRET_KEY);
}
