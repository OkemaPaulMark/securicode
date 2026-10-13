/** Native TreeView for the sidebar's Dependencies section (brief Sheet 12). */
import * as vscode from "vscode";

import { Dependency, Severity } from "../api-client/types";
import { securityState } from "../state/securityState";

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "securecode.critical",
  high: "securecode.high",
  medium: "securecode.medium",
  low: "securecode.low",
};

export class DependenciesTreeProvider implements vscode.TreeDataProvider<Dependency> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {
    securityState.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(dependency: Dependency): vscode.TreeItem {
    const item = new vscode.TreeItem(`${dependency.name} ${dependency.version}`, vscode.TreeItemCollapsibleState.None);
    if (dependency.severity) {
      item.description = dependency.cve ?? dependency.severity.toUpperCase();
      item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor(SEVERITY_COLOR[dependency.severity]));
      item.tooltip = dependency.summary ?? undefined;
    } else {
      item.description = "No known issues";
      item.iconPath = new vscode.ThemeIcon("pass", new vscode.ThemeColor("securecode.success"));
    }
    return item;
  }

  getChildren(): Dependency[] {
    return securityState.dependencies;
  }
}
