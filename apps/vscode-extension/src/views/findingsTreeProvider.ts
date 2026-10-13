/**
 * Native TreeView for the sidebar's Findings section (brief Sheet 5).
 * Grouped by severity by default. Empty/unauthenticated states are native
 * `viewsWelcome` content declared in package.json, not rendered here.
 */
import * as vscode from "vscode";

import { Finding, Severity } from "../api-client/types";
import { securityState } from "../state/securityState";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "securecode.critical",
  high: "securecode.high",
  medium: "securecode.medium",
  low: "securecode.low",
};

type TreeNode = { kind: "group"; severity: Severity } | { kind: "finding"; finding: Finding };

export class FindingsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {
    securityState.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "group") {
      const count = securityState.findings.filter((f) => f.severity === node.severity).length;
      const item = new vscode.TreeItem(
        `${SEVERITY_LABEL[node.severity]} (${count})`,
        count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor(SEVERITY_COLOR[node.severity]));
      item.contextValue = "severityGroup";
      return item;
    }

    const { finding } = node;
    const item = new vscode.TreeItem(finding.title, vscode.TreeItemCollapsibleState.None);
    item.description = `${finding.file}:${finding.line}`;
    item.iconPath = new vscode.ThemeIcon("shield", new vscode.ThemeColor(SEVERITY_COLOR[finding.severity]));
    item.contextValue = "finding";
    item.tooltip = new vscode.MarkdownString(
      `**${finding.title}**\n\n${finding.description}\n\n${finding.cwe ?? ""} ${finding.owaspCategory ?? ""}`,
    );
    item.command = {
      command: "securecode.openFinding",
      title: "Open Finding",
      arguments: [finding.id],
    };
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return SEVERITY_ORDER.map((severity) => ({ kind: "group", severity }));
    }
    if (node.kind === "group") {
      return securityState.findings
        .filter((f) => f.severity === node.severity)
        .map((finding) => ({ kind: "finding", finding }));
    }
    return [];
  }
}
