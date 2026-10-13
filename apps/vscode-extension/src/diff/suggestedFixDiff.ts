/**
 * The "Suggest Fix" review flow (brief Sheet 10). Uses VS Code's native
 * diff editor rather than a custom webview — it's the most native way to
 * show a before/after, and it makes "apply" an explicit, reviewable act
 * instead of the agent silently editing the file.
 */
import * as vscode from "vscode";

import { Finding } from "../api-client/types";

const SCHEME = "securecode-fix";
const content = new Map<string, string>();

class FixContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return content.get(uri.toString()) ?? "";
  }
}

export function registerSuggestedFixProvider(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, new FixContentProvider()),
  );
}

export async function showSuggestedFixDiff(finding: Finding): Promise<void> {
  if (!finding.suggestedFix || !finding.codeEvidence) {
    vscode.window.showInformationMessage("SecureCode: no AI-suggested fix is available for this finding yet.");
    return;
  }

  const ext = finding.file.includes(".") ? finding.file.split(".").pop() : "txt";
  const beforeUri = vscode.Uri.parse(`${SCHEME}:/${finding.id}/current.${ext}`);
  const afterUri = vscode.Uri.parse(`${SCHEME}:/${finding.id}/suggested.${ext}`);

  content.set(beforeUri.toString(), finding.codeEvidence);
  content.set(afterUri.toString(), finding.suggestedFix);

  await vscode.commands.executeCommand(
    "vscode.diff",
    beforeUri,
    afterUri,
    `${finding.title} — AI Suggested Fix (${finding.file}:${finding.line})`,
  );
}

/**
 * Applies the fix to the real file, but only after the developer reviews
 * the diff and explicitly confirms — the agent never edits code on its
 * own. Falls back to a message if the vulnerable snippet can no longer be
 * found verbatim (the safest thing to do is ask the developer to apply it
 * by hand rather than guess at a location).
 */
export async function applySuggestedFix(finding: Finding): Promise<void> {
  if (!finding.suggestedFix || !finding.codeEvidence) return;

  const confirm = await vscode.window.showWarningMessage(
    `Apply the AI-suggested fix to ${finding.file}:${finding.line}?`,
    { modal: true },
    "Apply Fix",
  );
  if (confirm !== "Apply Fix") return;

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage("SecureCode: no workspace folder is open.");
    return;
  }

  const fileUri = vscode.Uri.joinPath(folder.uri, finding.file);
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(fileUri);
  } catch {
    vscode.window.showErrorMessage(`SecureCode: could not open ${finding.file}.`);
    return;
  }

  const text = document.getText();
  const index = text.indexOf(finding.codeEvidence);
  if (index === -1) {
    vscode.window.showWarningMessage(
      "SecureCode: the vulnerable snippet no longer matches this file exactly — apply the fix manually from the diff view.",
    );
    return;
  }

  const startPos = document.positionAt(index);
  const endPos = document.positionAt(index + finding.codeEvidence.length);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(fileUri, new vscode.Range(startPos, endPos), finding.suggestedFix);
  await vscode.workspace.applyEdit(edit);
  await document.save();

  vscode.window.showInformationMessage("SecureCode: fix applied. Rescan to confirm it's resolved.");
}
