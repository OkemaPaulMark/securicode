import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { platform } from "../api";
import type { AssessmentSummary, Finding } from "../api/types";
import { IconCompare, IconRefresh, IconTrash } from "../components/icons";
import { UploadZipDialog } from "../components/NewAssessment";
import { Confirm, Empty, ErrorNote, Loading, SeverityBadge, SeverityCountsView, StateChip, useAsync, usePolling } from "../components/ui";
import { ago, dateTime, duration, isActive, total } from "../lib/format";
import { usePage, useToast } from "../lib/session";
import { SourceTag } from "./Dashboard";

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const project = useAsync(() => platform.getProject(projectId), [projectId]);
  const history = useAsync(() => platform.listAssessments(projectId), [projectId]);
  const [zip, setZip] = useState(false);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");

  const p = project.data;
  usePage(p?.name ?? "Project", [{ label: "Projects", to: "/" }, { label: p?.name ?? "…" }]);
  const list = history.data ?? [];
  const active = list.some((a) => isActive(a.state));
  usePolling(() => { history.reload(); }, active, 3000);
  const done = list.filter((a) => a.state === "completed");

  const run = async () => {
    if (!p) return;
    if (p.source_type === "zip") return setZip(true);
    setBusy(true);
    try {
      const a = await platform.startAssessment(p.id);
      toast(`Assessment #${a.number} started.`);
      nav(`/assessments/${a.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await platform.deleteProject(projectId);
      toast(`Deleted ${p?.name}.`);
      nav("/");
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  if (project.error) return <ErrorNote error={project.error} onRetry={project.reload} />;
  if (!p) return <Loading label="Loading project" />;

  const compareBase = base || done[1]?.id || "";
  const compareHead = head || done[0]?.id || "";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{p.name}</h1>
          <p><SourceTag p={p} /></p>
        </div>
        <div className="actions">
          <button className="btn btn-danger" onClick={() => setDel(true)}><IconTrash />Delete project</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || active} title={active ? "An assessment is already running" : undefined}>
            <IconRefresh />{p.source_type === "zip" ? "Upload new code" : "Run new assessment"}
          </button>
        </div>
      </div>

      <section className="panel" aria-labelledby="hist-h">
        <div className="panel-head"><h2 id="hist-h" style={{ fontSize: "var(--t-lg)" }}>Assessment history</h2></div>
        {history.error && <div className="panel-body"><ErrorNote error={history.error} onRetry={history.reload} /></div>}
        {!history.data && !history.error && <Loading />}
        {history.data && list.length === 0 && <Empty title="No assessments yet">Start one to see this project's security findings.</Empty>}
        {list.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Assessment</th><th scope="col">Status</th><th scope="col" className="hide-sm">Started</th><th scope="col" className="hide-sm">Took</th><th scope="col">Open findings</th></tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} data-link onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) nav(`/assessments/${a.id}`); }}>
                    <td><Link className="proj-name" to={`/assessments/${a.id}`}>#{a.number}</Link></td>
                    <td><StateChip state={a.state} /></td>
                    <td className="hide-sm" title={dateTime(a.created_at)}>{ago(a.created_at)}</td>
                    <td className="hide-sm">{duration(a.created_at, a.finished_at) || "—"}</td>
                    <td>{a.state === "completed" ? <SeverityCountsView counts={a.counts} compact /> : <span className="muted small">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {done.length >= 2 && (
        <section className="panel" aria-labelledby="cmp-h">
          <div className="panel-head"><h2 id="cmp-h" style={{ fontSize: "var(--t-lg)" }}>Compare two assessments</h2></div>
          <form className="panel-body" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}
            onSubmit={(e) => { e.preventDefault(); nav(`/projects/${p.id}/compare?base=${compareBase}&head=${compareHead}`); }}>
            <label className="field" style={{ minWidth: 180 }}><span>Earlier</span>
              <select className="select" value={compareBase} onChange={(e) => setBase(e.target.value)}>
                {done.map((a) => <option key={a.id} value={a.id}>#{a.number}, {dateTime(a.created_at)}</option>)}
              </select>
            </label>
            <label className="field" style={{ minWidth: 180 }}><span>Later</span>
              <select className="select" value={compareHead} onChange={(e) => setHead(e.target.value)}>
                {done.map((a) => <option key={a.id} value={a.id}>#{a.number}, {dateTime(a.created_at)}</option>)}
              </select>
            </label>
            <button className="btn" disabled={compareBase === compareHead}><IconCompare />Compare</button>
          </form>
        </section>
      )}

      <UploadZipDialog open={zip} onClose={() => setZip(false)} project={p} />
      <Confirm open={del} onClose={() => setDel(false)} onConfirm={remove} busy={busy} danger title={`Delete ${p.name}?`} confirmLabel="Delete project">
        <p>This permanently deletes the project, its {p.assessment_count} assessment{p.assessment_count === 1 ? "" : "s"}, all findings and your decisions on them. Your code on GitHub or GitLab is not affected.</p>
      </Confirm>
    </>
  );
}

function FindingRows({ items, aid, empty }: { items: Finding[]; aid: string; empty: string }) {
  if (!items.length) return <p className="muted small" style={{ padding: "12px 20px" }}>{empty}</p>;
  return (
    <table className="table">
      <tbody>
        {items.map((f) => (
          <tr key={f.id}>
            <td style={{ width: 110 }}><SeverityBadge level={f.severity} /></td>
            <td><Link to={`/assessments/${aid}?finding=${f.id}`}>{f.title}</Link><div className="xs muted mono">{f.file}:{f.line}</div></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ComparePage() {
  const { projectId = "" } = useParams();
  const [q] = useSearchParams();
  const base = q.get("base") ?? "";
  const head = q.get("head") ?? "";
  const project = useAsync(() => platform.getProject(projectId), [projectId]);
  const cmp = useAsync(() => platform.compare(base, head), [base, head]);
  const name = project.data?.name ?? "…";
  const c = cmp.data;
  usePage(`Compare ${name}`, [{ label: "Projects", to: "/" }, { label: name, to: `/projects/${projectId}` }, { label: "Compare" }]);

  if (cmp.error) return <ErrorNote error={cmp.error} onRetry={cmp.reload} />;
  if (!c) return <Loading label="Comparing" />;
  const label = (a: AssessmentSummary) => `#${a.number}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{label(c.base)} compared with {label(c.head)}</h1>
          <p>{c.resolved.length} resolved, {c.new.length} new and {c.unchanged.length} unchanged. Open findings went from {total(c.base.counts)} to {total(c.head.counts)}.</p>
        </div>
      </div>
      <div className="grid-2">
        <section className="panel"><div className="panel-head"><h2 style={{ fontSize: "var(--t-lg)" }}>Resolved <span className="muted">({c.resolved.length})</span></h2></div>
          <FindingRows items={c.resolved} aid={c.base.id} empty="Nothing from the earlier assessment was resolved." /></section>
        <section className="panel"><div className="panel-head"><h2 style={{ fontSize: "var(--t-lg)" }}>New <span className="muted">({c.new.length})</span></h2></div>
          <FindingRows items={c.new} aid={c.head.id} empty="No new findings. Nice." /></section>
      </div>
      <section className="panel"><div className="panel-head"><h2 style={{ fontSize: "var(--t-lg)" }}>Unchanged <span className="muted">({c.unchanged.length})</span></h2></div>
        <FindingRows items={c.unchanged} aid={c.head.id} empty="Every finding changed between these assessments." /></section>
    </>
  );
}
