/** Native TreeView for the sidebar's Secrets section (brief Sheet 13). */
import * as vscode from "vscode";

import { SecretFinding } from "../api-client/types";
import { securityState } from "../state/securityState";

export class SecretsTreeProvider implements vscode.TreeDataProvider<SecretFinding> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {
    securityState.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(secret: SecretFinding): vscode.TreeItem {
    const item = new vscode.TreeItem(secret.ruleName, vscode.TreeItemCollapsibleState.None);
    item.description = `${secret.file}:${secret.line}`;
    item.iconPath = new vscode.ThemeIcon("key", new vscode.ThemeColor("securecode.critical"));
    item.tooltip = `${secret.masked}\n\nDetected by: ${secret.detectedBy}`;
    item.contextValue = "secret";
    item.command = {
      command: "vscode.open",
      title: "Open File",
      arguments: [vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file("/"), secret.file)],
    };
    return item;
  }

  getChildren(): SecretFinding[] {
    return securityState.secrets;
  }
}
