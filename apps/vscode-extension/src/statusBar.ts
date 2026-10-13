/** The status bar item (brief Sheet 15): score normally, critical count when any exist. */
import * as vscode from "vscode";

import { securityState } from "./state/securityState";

export function createStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = "securecode.showFindings";
  context.subscriptions.push(item);

  const render = () => {
    const s = securityState;
    if (s.scanRun.phase === "running") {
      item.text = "$(sync~spin) SecureCode: scanning…";
      item.tooltip = "Scan in progress";
      item.command = undefined;
    } else if (!s.hasScanned) {
      item.text = "$(shield) SecureCode";
      item.tooltip = "No scan yet — click to scan this workspace";
      item.command = "securecode.scanWorkspace";
    } else {
      const counts = s.severityCounts;
      if (counts.critical > 0) {
        item.text = `$(shield) ${counts.critical} Critical`;
      } else {
        item.text = `$(shield) SecureCode: ${s.score.value}`;
      }
      item.tooltip = `Security score ${s.score.value}/100 — click to view findings`;
      item.command = "securecode.showFindings";
    }
    item.show();
  };

  context.subscriptions.push(securityState.onDidChange(render));
  render();
  return item;
}
