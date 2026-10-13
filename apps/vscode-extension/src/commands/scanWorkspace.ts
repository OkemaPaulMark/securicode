import * as vscode from "vscode";

import { SCAN_STAGES } from "../api-client/types";
import { SAMPLE_CI, SAMPLE_DEPENDENCIES, SAMPLE_FINDINGS, SAMPLE_SECRETS } from "../fixtures/sampleScanResult";
import { securityState } from "../state/securityState";

/**
 * Runs the scan progress UI (brief Sheet 11) using VS Code's native
 * `withProgress` — the idiomatic, native-feeling way to show staged
 * progress, rather than a custom webview.
 *
 * The real submission (Sheet 13: package workspace → POST → poll) isn't
 * wired up yet since the scans pipeline doesn't exist in the backend. This
 * runs the same UI against the sample fixture so the rest of the
 * extension (findings tree, detail panel, agent chat) is fully clickable
 * today; swapping in a real `api.submitZipScan` + poll loop is a
 * self-contained change to this one function.
 */
export async function scanWorkspace(): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    vscode.window.showWarningMessage("SecureCode: open a folder to scan.");
    return;
  }

  securityState.beginScan();

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "SecureCode scan", cancellable: false },
    async (progress) => {
      const step = 100 / SCAN_STAGES.length;
      for (const stage of SCAN_STAGES) {
        securityState.advanceScan(stage.key);
        progress.report({ increment: step, message: stage.label });
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    },
  );

  securityState.completeScan({
    findings: SAMPLE_FINDINGS,
    dependencies: SAMPLE_DEPENDENCIES,
    secrets: SAMPLE_SECRETS,
    ci: SAMPLE_CI,
  });

  const counts = securityState.severityCounts;
  vscode.window
    .showInformationMessage(
      `SecureCode scan complete — score ${securityState.score.value}/100, ${securityState.findings.length} findings ` +
        `(${counts.critical} critical, ${counts.high} high).`,
      "View Findings",
    )
    .then((choice) => {
      if (choice) vscode.commands.executeCommand("securecode.showFindings");
    });
}
