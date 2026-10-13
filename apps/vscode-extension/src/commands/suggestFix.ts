import * as vscode from "vscode";

import { applySuggestedFix, showSuggestedFixDiff } from "../diff/suggestedFixDiff";
import { findFindingForActiveSelection, resolveFindingIdArg } from "../findingLookup";
import { securityState } from "../state/securityState";

export async function suggestFix(arg?: unknown): Promise<void> {
  const findingId = resolveFindingIdArg(arg);
  const finding = findingId ? securityState.findFinding(findingId) : findFindingForActiveSelection();
  if (!finding) {
    vscode.window.showInformationMessage("SecureCode: no detected finding at the cursor.");
    return;
  }
  if (!finding.suggestedFix) {
    vscode.window.showInformationMessage("SecureCode: no AI-suggested fix is available for this finding yet.");
    return;
  }

  await showSuggestedFixDiff(finding);

  const choice = await vscode.window.showInformationMessage(
    "Review the diff above. Apply this fix to your file?",
    "Apply Fix",
    "Not Now",
  );
  if (choice === "Apply Fix") {
    await applySuggestedFix(finding);
  }
}
