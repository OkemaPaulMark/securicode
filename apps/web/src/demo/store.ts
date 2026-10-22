/**
 * In-browser implementation of the platform (and, for a full demo session, the gateway) APIs.
 * Assessments progress in real time from their creation time, so the progress screens behave like the real thing.
 * State lives in memory and resets when the page reloads.
 */
import type { GatewayApi } from "../api/gateway";
import { ApiError } from "../api/http";
import type { PlatformApi } from "../api/platform";
import type {
  Assessment, AssessmentState, AssessmentSummary, AuditEntry, ChatMessage, Decision, Finding, FindingStatus,
  GitToken, Project, SourceType, ToolRun, User,
} from "../api/types";
import { joinPatches } from "../lib/diff";
import { countBySeverity, findingKey } from "../lib/format";
import { toSarif } from "../lib/sarif";
import { DEMO_USERS, SEED_PROJECTS, TEMPLATE_FINDINGS, type SeedProject } from "./seed";

interface StoredAssessment {
  id: string;
  project_id: string;
  number: number;
  created: number;       // ms
  duration: number;      // ms
  raw: number;
  source_label: string;
  failure?: string;
  cancelledAt?: number;
  findings: Finding[];
  chat: ChatMessage[];
}

interface StoredProject {
  id: string;
  name: string;
  source_type: SourceType;
  repo_url?: string | null;
  branch?: string | null;
  created: number;
  assessments: string[];
  hasPython: boolean;
  uploadLabel?: string;  // label for the next assessment of a ZIP project
}

const QUEUED_MS = 2500;
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms));
const iso = (ms: number) => new Date(ms).toISOString();
const deep = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
let seq = 100;
const nextId = (p: string) => `${p}-${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const TOOLS: { name: string; version: string; python?: boolean }[] = [
  { name: "Semgrep", version: "1.95.0" },
  { name: "Bandit", version: "1.7.10", python: true },
  { name: "SonarQube", version: "10.7 CE" },
  { name: "pip-audit", version: "2.7.3", python: true },
  { name: "npm audit", version: "10.9.0" },
  { name: "Gitleaks", version: "8.21.2" },
];

class DemoWorld {
  projects = new Map<string, StoredProject>();
  assessments = new Map<string, StoredAssessment>();
  audit: AuditEntry[] = [];
  users: User[] = [];
  tokens: GitToken[] = [];
  limit = 10;
  actor = "demo@securicode.local";

  constructor() {
    const now = Date.now();
    for (const sp of SEED_PROJECTS) this.addSeed(sp, now);
    this.users = DEMO_USERS.map((u) => ({
      id: u.id, email: u.email, name: u.name, role: u.role, is_active: u.active, email_verified: u.verified,
      created_at: iso(now - u.days * 86400000),
    }));
    this.tokens = [
      { id: "t-1", provider: "github", host: "github.com", label: "Personal projects", masked: "****8f2a", created_at: iso(now - 6 * 86400000) },
    ];
    const log: [number, string, string, string][] = [
      [3, "login", "", ""],
      [60, "finding.decision", "hostel-booking #2 F-0014", "approved"],
      [62, "assessment.submit", "/api/projects/p-hostel/assessments/", ""],
      [300, "git_token.add", "github:github.com", ""],
      [1440, "login.failed", "", ""],
      [1500, "admin.settings_update", "daily_assessment_limit", "5->10"],
    ];
    this.audit = log.map(([min, action, target, detail]) => ({
      at: iso(now - min * 60000), actor: this.actor, action, target, detail, ip: "196.43.133.10", user_id: "u-admin",
    }));
  }

  private addSeed(sp: SeedProject, now: number) {
    const p: StoredProject = {
      id: sp.id, name: sp.name, source_type: sp.source_type, repo_url: sp.repo_url ?? null, branch: sp.branch ?? null,
      created: now - sp.createdDaysAgo * 86400000, assessments: [], hasPython: true,
    };
    for (const sa of sp.assessments) {
      const findings = deep(sa.findings).map((f: Finding) => {
        if (sa.approvedIds?.includes(f.id)) {
          f.decision = "approved";
          f.decided_by = "amina";
          f.decided_at = iso(now - sa.minutesAgo * 60000 + sa.durationSec * 1000 + 3600000);
        }
        return f;
      });
      this.assessments.set(sa.id, {
        id: sa.id, project_id: p.id, number: sa.number, created: now - sa.minutesAgo * 60000, duration: sa.durationSec * 1000,
        raw: sa.raw, source_label: sa.source_label, failure: sa.failure, findings, chat: [],
      });
      p.assessments.push(sa.id);
    }
    this.projects.set(p.id, p);
  }

  log(action: string, target = "", detail = "") {
    this.audit.unshift({ at: iso(Date.now()), actor: this.actor, action, target, detail, ip: "127.0.0.1", user_id: "u-admin" });
  }

  // ---------------------------------------------------------------- derived views
  view(a: StoredAssessment, now = Date.now()): Assessment {
    const p = this.projects.get(a.project_id)!;
    const t = (a.cancelledAt ?? now) - a.created;
    const scanEnd = QUEUED_MS + (a.duration - QUEUED_MS) * 0.55;
    const failAt = a.failure ? Math.min(a.duration, QUEUED_MS + 1500) : Infinity;
    let state: AssessmentState;
    if (a.failure && t >= failAt) state = "failed";
    else if (t < QUEUED_MS) state = "queued";
    else if (t < scanEnd) state = "running_scans";
    else if (t < a.duration) state = "ai_analysing";
    else state = "completed";
    if (a.cancelledAt && state !== "completed" && state !== "failed") state = "cancelled";

    const tools: ToolRun[] = TOOLS.map((tool, i) => {
      if (tool.name === "npm audit") return { name: tool.name, version: tool.version, state: "skipped", reason: "No package.json found" };
      if (tool.python && !p.hasPython) return { name: tool.name, version: tool.version, state: "skipped", reason: "No Python code found" };
      const slice = (scanEnd - QUEUED_MS) / TOOLS.length;
      const start = QUEUED_MS + slice * i * 0.6;
      const end = start + slice * 2.2;
      const alerts = Math.round((a.raw * (i + 2)) / 20);
      if (state === "failed") return { name: tool.name, version: tool.version, state: i === 0 ? "failed" : "pending", reason: i === 0 ? "Source not available" : undefined };
      if (t >= Math.min(end, scanEnd)) return { name: tool.name, version: tool.version, state: "done", alerts };
      if (state === "cancelled") return { name: tool.name, version: tool.version, state: t >= start ? "failed" : "pending", reason: "Cancelled" };
      return { name: tool.name, version: tool.version, state: t >= start ? "running" : "pending" };
    });

    const done = state === "completed";
    const visible = done ? a.findings : [];
    const merged = a.findings.length;
    const aiProgress = state === "ai_analysing" ? Math.min(1, (t - scanEnd) / (a.duration - scanEnd)) : done ? 1 : 0;
    const status_counts: Record<FindingStatus, number> = { validated: 0, false_positive: 0, needs_review: 0, unvalidated: 0 };
    for (const f of visible) status_counts[f.status] += 1;

    return {
      id: a.id, number: a.number, state, project_id: p.id, project_name: p.name,
      created_at: iso(a.created),
      started_at: t >= QUEUED_MS ? iso(a.created + QUEUED_MS) : null,
      finished_at: done ? iso(a.created + a.duration) : state === "failed" ? iso(a.created + failAt) : state === "cancelled" ? iso(a.cancelledAt!) : null,
      source_label: a.source_label,
      failure_reason: state === "failed" ? a.failure : null,
      tools,
      ai: { analysed: Math.floor(merged * aiProgress), total: state === "running_scans" || state === "queued" ? 0 : merged, available: true, model: "Hosted LLM (sample)", model_location: "external" },
      funnel: {
        raw: done || state === "ai_analysing" ? a.raw : 0,
        merged: done || state === "ai_analysing" ? merged : 0,
        validated: done ? status_counts.validated : 0,
        approved: done ? visible.filter((f) => f.decision === "approved").length : 0,
      },
      counts: countBySeverity(visible),
      status_counts,
    };
  }

  summary(a: StoredAssessment): AssessmentSummary {
    const v = this.view(a);
    return { id: v.id, number: v.number, state: v.state, created_at: v.created_at, finished_at: v.finished_at, counts: v.counts };
  }

  project(p: StoredProject): Project {
    const last = p.assessments.length ? this.assessments.get(p.assessments[p.assessments.length - 1])! : null;
    return {
      id: p.id, name: p.name, source_type: p.source_type, repo_url: p.repo_url, branch: p.branch, created_at: iso(p.created),
      latest_assessment: last ? this.summary(last) : null, assessment_count: p.assessments.length,
    };
  }

  getP(id: string) {
    const p = this.projects.get(id);
    if (!p) throw new ApiError(404, "This project does not exist or was deleted.");
    return p;
  }

  getA(id: string) {
    const a = this.assessments.get(id);
    if (!a) throw new ApiError(404, "This assessment does not exist or was deleted.");
    return a;
  }

  getF(aid: string, fid: string) {
    const f = this.getA(aid).findings.find((x) => x.id === fid);
    if (!f) throw new ApiError(404, "Finding not found.");
    return f;
  }

  newAssessment(p: StoredProject, label: string): StoredAssessment {
    const template = p.id === "p-orders" ? SEED_PROJECTS.find((s) => s.id === "p-orders")!.assessments[1].findings
      : p.assessments.length ? this.assessments.get(p.assessments[p.assessments.length - 1])!.findings : TEMPLATE_FINDINGS;
    const findings = deep(template).map((f: Finding) => ({ ...f, decision: null, decided_by: null, decided_at: null, decision_comment: null }));
    const a: StoredAssessment = {
      id: nextId("a"), project_id: p.id, number: p.assessments.length + 1, created: Date.now(), duration: 26000,
      raw: findings.length * 5 + 3, source_label: label, findings, chat: [],
    };
    this.assessments.set(a.id, a);
    p.assessments.push(a.id);
    return a;
  }
}

let world: DemoWorld | null = null;
const W = () => (world ??= new DemoWorld());
export function resetDemo() {
  world = null;
}

// ---------------------------------------------------------------- assistant (CHAT-1..CHAT-5)
function answer(question: string, f: Finding | undefined): Pick<ChatMessage, "text" | "sources"> {
  const q = question.toLowerCase();
  if (/\b(change|edit|modify|rewrite|apply|commit|push|update)\b.*\b(file|code|repo|it|this)\b|\bfix it\b|\bapply\b/.test(q)) {
    return {
      text: "I can't change files. Changes only happen through a proposed fix that you review and approve." +
        (f?.proposed_fix ? " This finding already has one: open the Proposed fix section, check the diff, then choose Approve fix to download it as a patch." : " This finding has no automatic fix, so follow the remediation steps listed with it."),
    };
  }
  if (!f) {
    return {
      text: "Select a finding first and I'll answer with its code and evidence in view. In general: confirm the input really reaches the risky call, fix the highest severity and confidence items first, and re-run the assessment afterwards to check the fix.",
      sources: [{ title: "OWASP Top 10:2021", url: "https://owasp.org/Top10/" }],
    };
  }
  const sources = f.references.slice(0, 2);
  if (/(false positive|sure|real|really|certain|confiden|evidence|proof)/.test(q)) {
    return {
      text: `Confidence is ${Math.round(f.confidence * 100)}%. The evidence: ${f.evidence}` +
        (f.status === "false_positive" ? "\n\nIt was dismissed for that reason. If you disagree, choose Treat as real issue." : "\n\nIf you can show that the input is validated before it reaches this line, mark it as a false positive and say why in the comment."),
      sources,
    };
  }
  if (/(why|severity|how bad|serious|impact|risk|priorit)/.test(q)) {
    return {
      text: `It is rated ${f.severity} because of what an attacker could do if it is real: ${f.explanation}\n\nSeverity is about impact; confidence (${Math.round(f.confidence * 100)}%) is about how sure the agent is that the issue is real.`,
      sources,
    };
  }
  if (/(test|exploit|reproduce|verify|check|try)/.test(q)) {
    const sqli = f.cwe === "CWE-89";
    return {
      text: (sqli
        ? `On your own local copy, send the input ' OR 1=1 -- where ${f.file} reads it. If the response contains rows it shouldn't, the issue is confirmed. `
        : `Test it on a local copy only, never on a live system. `) +
        "After applying the fix, start a new assessment of the project; the finding should then appear as resolved in the comparison.",
      sources,
    };
  }
  if (/(how|fix|remediat|solve|prevent)/.test(q)) {
    return { text: `${f.remediation}${f.remediation_steps?.length ? "\n\n" + f.remediation_steps.map((s, i) => `${i + 1}. ${s}`).join("\n") : ""}`, sources };
  }
  return { text: `${f.explanation}\n\n${f.remediation}`, sources };
}

// ---------------------------------------------------------------- platform API
export const demoPlatform: PlatformApi = {
  async listProjects() {
    await wait();
    return [...W().projects.values()].sort((a, b) => b.created - a.created).map((p) => W().project(p));
  },
  async getProject(id) {
    await wait(120);
    return W().project(W().getP(id));
  },
  async createZipProject(name, file) {
    await wait(700);
    const w = W();
    const p: StoredProject = {
      id: nextId("p"), name, source_type: "zip", created: Date.now(), assessments: [], hasPython: true,
      uploadLabel: `${file.name}, ${(file.size / 1024 / 1024).toFixed(1)} MB`,
    };
    w.projects.set(p.id, p);
    w.log("project.create", name, "zip");
    return w.project(p);
  },
  async createRepoProject(body) {
    await wait(600);
    const w = W();
    const p: StoredProject = {
      id: nextId("p"), name: body.name, source_type: body.source_type, repo_url: body.repo_url, branch: body.branch,
      created: Date.now(), assessments: [], hasPython: true,
    };
    w.projects.set(p.id, p);
    w.log("project.create", body.name, body.source_type);
    return w.project(p);
  },
  async deleteProject(id) {
    await wait();
    const w = W();
    const p = w.getP(id);
    p.assessments.forEach((a) => w.assessments.delete(a));
    w.projects.delete(id);
    w.log("project.delete", p.name);
  },
  async listAssessments(pid) {
    await wait(120);
    const w = W();
    return w.getP(pid).assessments.map((id) => w.summary(w.assessments.get(id)!)).reverse();
  },
  async startAssessment(pid, archive) {
    await wait(300);
    const w = W();
    const p = w.getP(pid);
    if (archive) p.uploadLabel = `${archive.name}, ${(archive.size / 1024 / 1024).toFixed(1)} MB`;
    const running = p.assessments.map((id) => w.view(w.assessments.get(id)!)).find((a) => ["queued", "running_scans", "ai_analysing"].includes(a.state));
    if (running) throw new ApiError(409, `Assessment #${running.number} is still running. Wait for it to finish or cancel it first.`);
    const label = p.source_type === "zip" ? p.uploadLabel ?? "latest upload" : `${p.branch} @ ${Math.random().toString(16).slice(2, 9)}`;
    p.uploadLabel = undefined;
    const a = w.newAssessment(p, label);
    w.log("assessment.submit", `/api/projects/${pid}/assessments/`);
    return w.view(a);
  },
  async getAssessment(id) {
    await wait(80);
    return W().view(W().getA(id));
  },
  async cancelAssessment(id) {
    await wait();
    const w = W();
    const a = w.getA(id);
    const v = w.view(a);
    if (!["queued", "running_scans", "ai_analysing"].includes(v.state)) throw new ApiError(409, "Only queued or running assessments can be cancelled.");
    a.cancelledAt = Date.now();
    w.log("assessment.cancel", `${w.getP(a.project_id).name} #${a.number}`);
    return w.view(a);
  },
  async retryAssessment(id) {
    await wait();
    const w = W();
    const a = w.getA(id);
    if (w.view(a).state !== "failed" && w.view(a).state !== "cancelled") throw new ApiError(409, "Only failed or cancelled assessments can be retried.");
    const template = a.findings.length ? a.findings : SEED_PROJECTS.find((s) => s.id === "p-orders")!.assessments[1].findings;
    Object.assign(a, { created: Date.now(), duration: 24000, failure: undefined, cancelledAt: undefined, raw: Math.max(a.raw, template.length * 5), findings: deep(template) });
    w.log("assessment.retry", `${w.getP(a.project_id).name} #${a.number}`);
    return w.view(a);
  },
  async listFindings(aid) {
    await wait(150);
    const w = W();
    const a = w.getA(aid);
    return w.view(a).state === "completed" ? deep(a.findings) : [];
  },
  async decide(aid, fid, decision: Decision | null, comment) {
    await wait();
    const w = W();
    const f = w.getF(aid, fid);
    f.decision = decision;
    f.decided_by = decision ? "you" : null;
    f.decided_at = decision ? iso(Date.now()) : null;
    f.decision_comment = comment || null;
    const a = w.getA(aid);
    w.log("finding.decision", `${w.getP(a.project_id).name} #${a.number} ${fid}`, decision ?? "reopened");
    return deep(f);
  },
  async reclassify(aid, fid, status, comment) {
    await wait();
    const w = W();
    const f = w.getF(aid, fid);
    f.status = status;
    if (status === "false_positive") f.decision = "false_positive";
    else if (f.decision === "false_positive") f.decision = null;
    f.decided_by = "you";
    f.decided_at = iso(Date.now());
    f.decision_comment = comment || null;
    w.log("finding.reclassify", fid, status);
    return deep(f);
  },
  async patch(aid, fids) {
    await wait(120);
    const fs = W().getA(aid).findings.filter((f) => fids.includes(f.id) && f.proposed_fix);
    return joinPatches(fs.map((f) => ({ id: f.id, title: f.title, diff: f.proposed_fix!.diff })));
  },
  async sarif(aid) {
    await wait(150);
    const w = W();
    const a = w.getA(aid);
    return new Blob([JSON.stringify(toSarif(w.view(a), a.findings), null, 2)], { type: "application/sarif+json" });
  },
  async pdf() {
    return null;
  },
  async compare(baseId, headId) {
    await wait(200);
    const w = W();
    const base = w.getA(baseId);
    const head = w.getA(headId);
    const bk = new Map(base.findings.filter((f) => f.status !== "false_positive").map((f) => [findingKey(f), f]));
    const hk = new Map(head.findings.filter((f) => f.status !== "false_positive").map((f) => [findingKey(f), f]));
    return {
      base: w.summary(base),
      head: w.summary(head),
      new: [...hk].filter(([k]) => !bk.has(k)).map(([, f]) => deep(f)),
      resolved: [...bk].filter(([k]) => !hk.has(k)).map(([, f]) => deep(f)),
      unchanged: [...hk].filter(([k]) => bk.has(k)).map(([, f]) => deep(f)),
    };
  },
  async chatHistory(aid) {
    await wait(80);
    return deep(W().getA(aid).chat);
  },
  async ask(aid, question, findingId) {
    const a = W().getA(aid);
    const f = findingId ? a.findings.find((x) => x.id === findingId) : undefined;
    a.chat.push({ id: nextId("m"), role: "user", text: question, at: iso(Date.now()) });
    await wait(900);
    const reply: ChatMessage = { id: nextId("m"), role: "assistant", at: iso(Date.now()), ...answer(question, f) };
    a.chat.push(reply);
    return deep(reply);
  },
};

// ---------------------------------------------------------------- gateway API (full demo session only)
export const DEMO_TOKEN = "demo-session";

export const demoGateway: GatewayApi = {
  async login() {
    await wait();
    return { id: "demo", name: "Web browser", scope: "web", token: DEMO_TOKEN, access_token: DEMO_TOKEN, token_type: "bearer", expires_in: 43200, idle_timeout: 3600 };
  },
  async register() {
    throw new ApiError(400, "Registration is not available with sample data.");
  },
  async logout() {},
  async me() {
    return deep(W().users[0]);
  },
  async deleteAccount() {
    throw new ApiError(400, "The sample account can't be deleted. Sign out instead.");
  },
  async resendVerification() {},
  async requestPasswordReset() {},
  async confirmPasswordReset() {},
  async myAudit() {
    await wait(120);
    return deep(W().audit);
  },
  async listGitTokens() {
    await wait(120);
    return deep(W().tokens);
  },
  async addGitToken(body) {
    await wait(500);
    const t: GitToken = {
      id: nextId("t"), provider: body.provider, host: body.provider === "github" ? "github.com" : body.host || "gitlab.com",
      label: body.label ?? "", masked: `****${body.token.slice(-4)}`, created_at: iso(Date.now()),
    };
    W().tokens.push(t);
    W().log("git_token.add", `${t.provider}:${t.host}`);
    return t;
  },
  async deleteGitToken(id) {
    await wait();
    W().tokens = W().tokens.filter((t) => t.id !== id);
    W().log("git_token.remove", id);
  },
  async listUsers() {
    await wait(120);
    return deep(W().users);
  },
  async updateUser(id, body) {
    await wait();
    const u = W().users.find((x) => x.id === id);
    if (!u) throw new ApiError(404, "User not found");
    if (u.id === "u-admin" && (body.is_active === false || body.role === "user")) throw new ApiError(400, "You cannot deactivate or demote your own account");
    Object.assign(u, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
    W().log("admin.user_update", u.email, JSON.stringify(body));
    return deep(u);
  },
  async allAudit(action = "") {
    await wait(120);
    return deep(W().audit.filter((e) => !action || e.action === action)).map((e) => ({ ...e, user_id: e.user_id ?? null }));
  },
  async getSettings() {
    return { daily_assessment_limit: W().limit };
  },
  async putSettings(limit) {
    await wait();
    W().log("admin.settings_update", "daily_assessment_limit", `${W().limit}->${limit}`);
    W().limit = limit;
    return { daily_assessment_limit: limit };
  },
  async status() {
    await wait(300);
    return {
      gateway: "up",
      services: { ai: "not-configured", project: "not-configured", reporting: "not-configured", scan: "not-configured" },
      routes: { projects: "project", assessments: "project", scans: "scan", ai: "ai", reports: "reporting", findings: "reporting" },
    };
  },
};
