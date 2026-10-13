import * as vscode from "vscode";

import { findFindingForActiveSelection, resolveFindingIdArg } from "../findingLookup";
import { ChatPanel } from "../webviews/ai-chat/chatPanel";

/** Used by the Finding Detail panel's "Explain with AI" button, the editor context menu, and the findings tree. */
export async function explainWithAI(context: vscode.ExtensionContext, arg?: unknown): Promise<void> {
  const resolvedId = resolveFindingIdArg(arg) ?? findFindingForActiveSelection()?.id;
  if (!resolvedId) {
    vscode.window.showInformationMessage(
      "SecureCode: no detected finding at the cursor — open one from the Findings view, or run Scan Workspace first.",
    );
    return;
  }
  ChatPanel.show(context, resolvedId);
}
