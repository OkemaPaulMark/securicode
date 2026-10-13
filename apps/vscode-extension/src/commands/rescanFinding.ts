import * as vscode from "vscode";

/** Rescanning a single finding needs backend support (Sheet 07) that doesn't exist yet — falls back to a full rescan. */
export async function rescanFinding(): Promise<void> {
  await vscode.commands.executeCommand("securecode.scanWorkspace");
}
