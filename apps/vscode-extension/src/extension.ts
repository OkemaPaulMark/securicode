/**
 * Entry point. Registers views, commands, and the status bar, and keeps
 * VS Code context keys in sync with securityState so viewsWelcome `when`
 * clauses (declared in package.json) can react to scan state. Signing in
 * is optional — see overviewViewProvider.ts — nothing here is gated on it.
 * This file wires things together — it doesn't implement anything itself
 * (see Sheet 16: the extension is a thin API client, all analysis/
 * reasoning stays server-side).
 */
import * as vscode from "vscode";

import { askAgent } from "./commands/askAgent";
import { explainWithAI } from "./commands/explainWithAI";
import { generateReport } from "./commands/generateReport";
import { login } from "./commands/login";
import { logout } from "./commands/logout";
import { openFinding, openFindingLocation } from "./commands/openFinding";
import { openDashboard } from "./commands/openDashboard";
import { rescanFinding } from "./commands/rescanFinding";
import { scanFile } from "./commands/scanFile";
import { scanSelection } from "./commands/scanSelection";
import { scanWorkspace } from "./commands/scanWorkspace";
import { showFindings } from "./commands/showFindings";
import { suggestFix } from "./commands/suggestFix";
import { initTokenStore } from "./auth/tokenStore";
import { registerSuggestedFixProvider } from "./diff/suggestedFixDiff";
import { createDiagnosticCollection, publishFindings } from "./diagnostics/diagnosticsProvider";
import { securityState } from "./state/securityState";
import { createStatusBarItem } from "./statusBar";
import { DependenciesTreeProvider } from "./views/dependenciesTreeProvider";
import { FindingsTreeProvider } from "./views/findingsTreeProvider";
import { OverviewViewProvider } from "./views/overviewViewProvider";
import { SecretsTreeProvider } from "./views/secretsTreeProvider";

export function activate(context: vscode.ExtensionContext) {
  initTokenStore(context);
  registerSuggestedFixProvider(context);

  // --- Views -----------------------------------------------------------
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(OverviewViewProvider.viewType, new OverviewViewProvider(context.extensionUri)),
  );

  const findingsTree = vscode.window.createTreeView("securecode.findings", {
    treeDataProvider: new FindingsTreeProvider(),
  });
  const dependenciesTree = vscode.window.createTreeView("securecode.dependencies", {
    treeDataProvider: new DependenciesTreeProvider(),
  });
  const secretsTree = vscode.window.createTreeView("securecode.secrets", {
    treeDataProvider: new SecretsTreeProvider(),
  });
  context.subscriptions.push(findingsTree, dependenciesTree, secretsTree);

  // --- Diagnostics -------------------------------------------------------
  const diagnostics = createDiagnosticCollection();
  context.subscriptions.push(diagnostics);
  const refreshDiagnostics = () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    publishFindings(
      diagnostics,
      folder.uri,
      securityState.findings.filter((f) => f.status !== "resolved"),
    );
  };
  context.subscriptions.push(securityState.onDidChange(refreshDiagnostics));

  // --- Status bar --------------------------------------------------------
  createStatusBarItem(context);

  // --- Context keys for viewsWelcome `when` clauses ---------------------
  const syncContextKeys = () => {
    vscode.commands.executeCommand("setContext", "securecode.hasScanned", securityState.hasScanned);
  };
  context.subscriptions.push(securityState.onDidChange(syncContextKeys));
  syncContextKeys();

  // --- Commands ------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("securecode.login", () => login(context)),
    vscode.commands.registerCommand("securecode.logout", () => logout(context)),
    vscode.commands.registerCommand("securecode.scanWorkspace", () => scanWorkspace()),
    vscode.commands.registerCommand("securecode.scanFile", () => scanFile()),
    vscode.commands.registerCommand("securecode.scanSelection", () => scanSelection()),
    vscode.commands.registerCommand("securecode.showFindings", () => showFindings()),
    vscode.commands.registerCommand("securecode.openFinding", (findingId: string) => openFinding(findingId)),
    vscode.commands.registerCommand("securecode.openFindingLocation", (findingId: string) => openFindingLocation(findingId)),
    vscode.commands.registerCommand("securecode.askAgent", () => askAgent(context)),
    vscode.commands.registerCommand("securecode.explainWithAI", (arg?: unknown) => explainWithAI(context, arg)),
    vscode.commands.registerCommand("securecode.suggestFix", (arg?: unknown) => suggestFix(arg)),
    vscode.commands.registerCommand("securecode.rescanFinding", () => rescanFinding()),
    vscode.commands.registerCommand("securecode.generateReport", () => generateReport()),
    vscode.commands.registerCommand("securecode.openDashboard", () => openDashboard()),
  );
}

export function deactivate() {}
