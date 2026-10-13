/** Shared helper: match the active editor's cursor/selection to a known finding. */
import * as vscode from "vscode";

import { Finding } from "./api-client/types";
import { securityState } from "./state/securityState";

export function findFindingNear(document: vscode.TextDocument, line: number): Finding | undefined {
  const relativePath = vscode.workspace.asRelativePath(document.uri, false);
  return securityState.findings.find(
    (f) => f.file === relativePath && Math.abs(f.line - (line + 1)) <= 2,
  );
}

export function findFindingForActiveSelection(): Finding | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  return findFindingNear(editor.document, editor.selection.active.line);
}

/**
 * Command handlers are invoked two different ways: with a plain findingId
 * string (from the webviews, or the Command Palette), or with the tree
 * node object VS Code passes for a `view/item/context` menu click. This
 * normalizes either into an id.
 */
export function resolveFindingIdArg(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object" && "finding" in arg) {
    const finding = (arg as { finding?: Finding }).finding;
    return finding?.id;
  }
  return undefined;
}
