/** Identity and administration endpoints served by the API Gateway itself (services/gateway). */
import { request } from "./http";
import type { AuditEntry, GitToken, SystemStatus, TokenIssued, User } from "./types";

export interface GatewayApi {
  login(email: string, password: string): Promise<TokenIssued>;
  register(name: string, email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  me(): Promise<User>;
  deleteAccount(password: string): Promise<void>;
  resendVerification(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(token: string, newPassword: string): Promise<void>;
  myAudit(limit?: number): Promise<AuditEntry[]>;
  listGitTokens(): Promise<GitToken[]>;
  addGitToken(body: { provider: "github" | "gitlab"; token: string; label?: string; host?: string }): Promise<GitToken>;
  deleteGitToken(id: string): Promise<void>;
  // administration (BR-3)
  listUsers(): Promise<User[]>;
  updateUser(id: string, body: { role?: "user" | "admin"; is_active?: boolean }): Promise<User>;
  allAudit(action?: string, limit?: number): Promise<(AuditEntry & { user_id: string | null })[]>;
  getSettings(): Promise<{ daily_assessment_limit: number }>;
  putSettings(limit: number): Promise<{ daily_assessment_limit: number }>;
  status(): Promise<SystemStatus>;
}

export const liveGateway: GatewayApi = {
  login: (email, password) =>
    request("/api/auth/login/", { method: "POST", auth: false, json: { email, password, scope: "web", name: "Web browser" } }),
  register: (name, email, password) => request("/api/auth/register/", { method: "POST", auth: false, json: { name, email, password } }),
  logout: () => request("/api/auth/logout/", { method: "POST" }),
  me: () => request("/api/auth/me/"),
  deleteAccount: (password) => request("/api/auth/me/", { method: "DELETE", json: { password } }),
  resendVerification: () => request("/api/auth/resend-verification/", { method: "POST" }),
  requestPasswordReset: (email) => request("/api/auth/password-reset/", { method: "POST", auth: false, json: { email } }),
  confirmPasswordReset: (token, new_password) =>
    request("/api/auth/password-reset/confirm/", { method: "POST", auth: false, json: { token, new_password } }),
  myAudit: (limit = 100) => request("/api/auth/audit/", { query: { limit } }),
  listGitTokens: () => request("/api/auth/git-tokens/"),
  addGitToken: (body) => request("/api/auth/git-tokens/", { method: "POST", json: body }),
  deleteGitToken: (id) => request(`/api/auth/git-tokens/${encodeURIComponent(id)}/`, { method: "DELETE" }),
  listUsers: () => request("/api/admin/users/"),
  updateUser: (id, body) => request(`/api/admin/users/${encodeURIComponent(id)}/`, { method: "PATCH", json: body }),
  allAudit: (action = "", limit = 200) => request("/api/admin/audit/", { query: { action, limit } }),
  getSettings: () => request("/api/admin/settings/"),
  putSettings: (limit) => request("/api/admin/settings/", { method: "PUT", json: { daily_assessment_limit: limit } }),
  status: () => request("/api/admin/status/"),
};
