/**
 * The extension's only path to the backend. Every command goes through
 * this client — nothing else in the extension should call `fetch`
 * directly, and nothing here should contain analysis logic (Sheet 16).
 */
import * as vscode from "vscode";

import { getToken } from "../auth/tokenStore";
import { Finding, Scan, TokenIssued } from "./types";

function baseUrl(): string {
  return vscode.workspace.getConfiguration("securecode").get<string>("apiBaseUrl", "http://localhost:8000");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(`SecureCode API ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export const api = {
  login: (username: string, password: string, name: string): Promise<TokenIssued> =>
    request("/api/auth/login/", {
      method: "POST",
      body: JSON.stringify({ username, password, name, scope: "vscode" }),
    }),

  submitZipScan: (_projectId: string, _archive: Uint8Array): Promise<Scan> => {
    throw new Error("not implemented — see Sheet 13/16");
  },

  getScan: (scanId: string): Promise<Scan> => request(`/api/scans/${scanId}/`),

  getFindings: (scanId: string): Promise<Finding[]> => request(`/api/scans/${scanId}/findings/`),

  askAgent: (question: string, context: Record<string, unknown>): Promise<{ answer: string }> =>
    request("/api/ai/ask/", { method: "POST", body: JSON.stringify({ question, ...context }) }),
};
