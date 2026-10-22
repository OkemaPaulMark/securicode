/**
 * Projects, assessments, findings, reports and the assistant. These calls go through the gateway to the
 * Project, Scan, AI and Reporting services. The exact contract is documented in apps/web/API_CONTRACT.md.
 */
import { request } from "./http";
import type {
  Assessment, AssessmentSummary, ChatMessage, Comparison, Decision, Finding, NewRepoProject, Project,
} from "./types";

export interface PlatformApi {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project>;
  createZipProject(name: string, file: File): Promise<Project>;
  createRepoProject(body: NewRepoProject): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  listAssessments(projectId: string): Promise<AssessmentSummary[]>;
  /** For ZIP projects, pass a new archive to assess newer code (SUBM-6). */
  startAssessment(projectId: string, archive?: File): Promise<Assessment>;
  getAssessment(id: string): Promise<Assessment>;
  cancelAssessment(id: string): Promise<Assessment>;
  retryAssessment(id: string): Promise<Assessment>;
  listFindings(assessmentId: string): Promise<Finding[]>;
  decide(assessmentId: string, findingId: string, decision: Decision | null, comment: string): Promise<Finding>;
  reclassify(assessmentId: string, findingId: string, status: "validated" | "false_positive", comment: string): Promise<Finding>;
  patch(assessmentId: string, findingIds: string[]): Promise<string>;
  sarif(assessmentId: string): Promise<Blob>;
  /** null means the Reporting service cannot render PDFs yet; the app then opens its print view. */
  pdf(assessmentId: string): Promise<Blob | null>;
  compare(baseId: string, headId: string): Promise<Comparison>;
  chatHistory(assessmentId: string): Promise<ChatMessage[]>;
  ask(assessmentId: string, question: string, findingId?: string): Promise<ChatMessage>;
}

const id = encodeURIComponent;

async function blob(path: string): Promise<Blob> {
  const res = await request<Response>(path, { raw: true });
  return res.blob();
}

export const livePlatform: PlatformApi = {
  listProjects: () => request("/api/projects/"),
  getProject: (pid) => request(`/api/projects/${id(pid)}/`),
  createZipProject: (name, file) => {
    const form = new FormData();
    form.set("name", name);
    form.set("source_type", "zip");
    form.set("archive", file);
    return request("/api/projects/", { method: "POST", form });
  },
  createRepoProject: (body) => request("/api/projects/", { method: "POST", json: body }),
  deleteProject: (pid) => request(`/api/projects/${id(pid)}/`, { method: "DELETE" }),
  listAssessments: (pid) => request(`/api/projects/${id(pid)}/assessments/`),
  startAssessment: (pid, archive) => {
    if (!archive) return request(`/api/projects/${id(pid)}/assessments/`, { method: "POST", json: {} });
    const form = new FormData();
    form.set("archive", archive);
    return request(`/api/projects/${id(pid)}/assessments/`, { method: "POST", form });
  },
  getAssessment: (aid) => request(`/api/assessments/${id(aid)}/`),
  cancelAssessment: (aid) => request(`/api/assessments/${id(aid)}/cancel/`, { method: "POST" }),
  retryAssessment: (aid) => request(`/api/assessments/${id(aid)}/retry/`, { method: "POST" }),
  listFindings: (aid) => request(`/api/assessments/${id(aid)}/findings/`),
  decide: (aid, fid, decision, comment) =>
    request(`/api/assessments/${id(aid)}/findings/${id(fid)}/decision/`, { method: "POST", json: { decision, comment } }),
  reclassify: (aid, fid, status, comment) =>
    request(`/api/assessments/${id(aid)}/findings/${id(fid)}/classification/`, { method: "POST", json: { status, comment } }),
  patch: (aid, fids) => request(`/api/reports/${id(aid)}/patch/`, { query: { findings: fids.join(",") } }),
  sarif: (aid) => blob(`/api/reports/${id(aid)}/sarif/`),
  pdf: async (aid) => {
    try {
      return await blob(`/api/reports/${id(aid)}/pdf/`);
    } catch {
      return null;
    }
  },
  compare: (base, head) => request("/api/reports/compare/", { query: { base, head } }),
  chatHistory: (aid) => request(`/api/ai/assessments/${id(aid)}/chat/`),
  ask: (aid, question, findingId) =>
    request(`/api/ai/assessments/${id(aid)}/chat/`, { method: "POST", json: { question, finding_id: findingId ?? null } }),
};
