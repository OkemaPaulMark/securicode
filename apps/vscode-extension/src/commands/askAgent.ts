import * as vscode from "vscode";

import { findFindingForActiveSelection } from "../findingLookup";
import { ChatPanel } from "../webviews/ai-chat/chatPanel";

export async function askAgent(context: vscode.ExtensionContext, findingId?: string): Promise<void> {
  const resolvedId = findingId ?? findFindingForActiveSelection()?.id;
  ChatPanel.show(context, resolvedId);
}
