import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { gateway, platform } from "../api";
import type { GitToken, Project } from "../api/types";
import { bytes } from "../lib/format";
import { useToast } from "../lib/session";
import { IconUpload } from "./icons";
import { Field, Modal } from "./ui";

export const MAX_ZIP = 100 * 1024 * 1024; // CI-4, SUBM-2

export function checkArchive(file: File | null): string | null {
  if (!file) return "Choose a ZIP file to upload.";
  if (!/\.zip$/i.test(file.name)) return "Only .zip archives can be uploaded. Compress your project folder as a ZIP first.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_ZIP) return `This archive is ${bytes(file.size)}. The limit is 100 MB; leave out node_modules, virtual environments and build output.`;
  return null;
}

/** Starts the first assessment of a new project and opens it. Project creation and assessment start are separate
 *  calls so the gateway can apply e-mail verification (AUTH-2) and the daily limit (BR-5) to the start. */
async function startAndOpen(project: Project, nav: ReturnType<typeof useNavigate>, toast: ReturnType<typeof useToast>, archive?: File) {
  try {
    const a = await platform.startAssessment(project.id, archive);
    toast(`Assessment started for ${project.name}.`);
    nav(`/assessments/${a.id}`);
  } catch (e) {
    toast(`${project.name} was added, but the assessment didn't start: ${(e as Error).message}`, "error");
    nav(`/projects/${project.id}`);
  }
}

function Dropzone({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="dropzone" data-over={over} role="button" tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0] ?? null); }}
      aria-label="Choose a ZIP file">
      <IconUpload size={26} />
      {file ? (
        <>
          <strong>{file.name}</strong>
          <span className="small muted">{bytes(file.size)}. Click to choose a different file.</span>
        </>
      ) : (
        <>
          <strong>Drop a ZIP here or click to choose</strong>
          <span className="small muted">Up to 100 MB</span>
        </>
      )}
      <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </div>
  );
}

export function UploadZipDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project?: Project }) {
  const nav = useNavigate();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setFile(null); setName(project?.name ?? ""); setError(null); }
  }, [open, project]);

  const pick = (f: File | null) => {
    setFile(f);
    setError(f ? checkArchive(f) : null);
    if (f && !name && !project) setName(f.name.replace(/\.zip$/i, "").replace(/[^\w.-]+/g, "-").slice(0, 80));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = checkArchive(file) ?? (!project && !name.trim() ? "Give the project a name." : null);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      if (project) {
        await startAndOpen(project, nav, toast, file!);
      } else {
        const p = await platform.createZipProject(name.trim(), file!);
        await startAndOpen(p, nav, toast);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={project ? `Upload new code for ${project.name}` : "Upload a project"}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" form="zip-form" disabled={busy || !file}>{busy && <span className="spinner" aria-hidden="true" />}{busy ? "Uploading" : "Upload and assess"}</button>
      </>}>
      <form id="zip-form" className="form" onSubmit={submit}>
        <Dropzone file={file} onFile={pick} />
        {!project && (
          <Field label="Project name" hint="Shown on your dashboard and in reports.">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          </Field>
        )}
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <p className="small muted">The archive is checked for unsafe paths and links before it is unpacked. Your code is never run; scanners only read it. Uploaded code is stored encrypted and deleted 30 days after the project's last assessment, or when you delete the project.</p>
      </form>
    </Modal>
  );
}

function detectProvider(url: string): "github" | "gitlab" | null {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    if (host === "github.com" || host.endsWith(".github.com")) return "github";
    if (host.includes("gitlab")) return "gitlab";
  } catch {
    return null;
  }
  return null;
}

export function ConnectRepoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState<"github" | "gitlab">("github");
  const [branch, setBranch] = useState("main");
  const [name, setName] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [tokens, setTokens] = useState<GitToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl(""); setBranch("main"); setName(""); setTokenId(""); setError(null);
    gateway.listGitTokens().then(setTokens).catch(() => setTokens([]));
  }, [open]);

  const onUrl = (v: string) => {
    setUrl(v);
    const p = detectProvider(v);
    if (p) setProvider(p);
    const m = /\/([^/]+?)(?:\.git)?\/?$/.exec(v.trim());
    if (m && !name) setName(m[1]);
  };

  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const usable = tokens.filter((t) => t.provider === provider && (!host || t.host === host));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^https:\/\/[^/]+\/.+\/.+/.test(url.trim())) return setError("Enter the full HTTPS address of the repository, for example https://github.com/owner/project.");
    if (!branch.trim()) return setError("Enter the branch to assess.");
    setBusy(true);
    setError(null);
    try {
      const p = await platform.createRepoProject({
        name: name.trim() || url.trim(), source_type: provider, repo_url: url.trim().replace(/\.git$/, ""), branch: branch.trim(), git_token_id: tokenId || null,
      });
      await startAndOpen(p, nav, toast);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Connect a repository"
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" form="repo-form" disabled={busy}>{busy && <span className="spinner" aria-hidden="true" />}Connect and assess</button>
      </>}>
      <form id="repo-form" className="form" onSubmit={submit}>
        <Field label="Repository URL">
          <input className="input" type="url" inputMode="url" placeholder="https://github.com/owner/project" value={url} onChange={(e) => onUrl(e.target.value)} required autoFocus />
        </Field>
        <div className="form-row">
          <Field label="Hosted on">
            <select className="select" value={provider} onChange={(e) => setProvider(e.target.value as "github" | "gitlab")}>
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </select>
          </Field>
          <Field label="Branch">
            <input className="input" value={branch} onChange={(e) => setBranch(e.target.value)} required />
          </Field>
        </div>
        <Field label="Access token" hint={<>Needed for private repositories. <Link to="/account#tokens" onClick={onClose}>Add a token</Link></>}>
          <select className="select" value={tokenId} onChange={(e) => setTokenId(e.target.value)}>
            <option value="">None, the repository is public</option>
            {usable.map((t) => <option key={t.id} value={t.id}>{t.label || t.host} ({t.masked})</option>)}
          </select>
        </Field>
        <Field label="Project name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Taken from the URL" maxLength={120} />
        </Field>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}
