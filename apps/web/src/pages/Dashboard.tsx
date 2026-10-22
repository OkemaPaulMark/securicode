import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { platform } from "../api";
import { IconBranch, IconGithub, IconGitlab, IconUpload } from "../components/icons";
import { ConnectRepoDialog, UploadZipDialog } from "../components/NewAssessment";
import { Empty, ErrorNote, Loading, SeverityBar, SeverityCountsView, StateChip, useAsync, usePolling } from "../components/ui";
import type { Project } from "../api/types";
import { ago, isActive, SOURCE_LABEL, total } from "../lib/format";
import { usePage, useSession } from "../lib/session";

export function SourceTag({ p }: { p: Pick<Project, "source_type" | "repo_url" | "branch"> }) {
  const icon = p.source_type === "github" ? <IconGithub /> : p.source_type === "gitlab" ? <IconGitlab /> : <IconUpload size={14} />;
  const where = p.repo_url ? p.repo_url.replace(/^https:\/\/(www\.)?/, "") : SOURCE_LABEL[p.source_type];
  return (
    <span className="source">
      {icon}
      <span>{where}</span>
      {p.branch && <><IconBranch size={13} /><span>{p.branch}</span></>}
    </span>
  );
}

export function Dashboard() {
  const { user } = useSession();
  usePage("Projects");
  const nav = useNavigate();
  const [zip, setZip] = useState(false);
  const [repo, setRepo] = useState(false);
  const projects = useAsync(() => platform.listProjects(), []);
  const list = projects.data ?? [];
  const running = list.filter((p) => p.latest_assessment && isActive(p.latest_assessment.state)).length;
  usePolling(projects.reload, running > 0, 4000);

  const open = list.reduce((n, p) => n + (p.latest_assessment ? total(p.latest_assessment.counts) : 0), 0);
  const urgent = list.reduce((n, p) => n + (p.latest_assessment ? p.latest_assessment.counts.critical + p.latest_assessment.counts.high : 0), 0);
  const first = user?.name.split(" ")[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{first ? `Hello, ${first}` : "Projects"}</h1>
          <p>Each project keeps its full history of assessments. Start with a ZIP of your code or a link to its repository.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setRepo(true)}><IconBranch />Connect repository</button>
          <button className="btn btn-primary" onClick={() => setZip(true)}><IconUpload />Upload ZIP</button>
        </div>
      </div>

      {projects.error && !projects.data && <ErrorNote error={projects.error} onRetry={projects.reload} />}
      {projects.loading && !projects.data && <Loading label="Loading projects" />}

      {projects.data && list.length > 0 && (
        <>
          <dl className="overview">
            <div><dt>Projects</dt><dd>{list.length}</dd></div>
            <div><dt>Open findings</dt><dd>{open}</dd></div>
            <div><dt>Critical or high</dt><dd style={{ color: urgent ? "var(--crit)" : undefined }}>{urgent}</dd></div>
            <div><dt>Running now</dt><dd>{running}</dd></div>
          </dl>

          <section className="panel" aria-labelledby="projects-h">
            <div className="panel-head"><h2 id="projects-h" style={{ fontSize: "var(--t-lg)" }}>Your projects</h2></div>
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Latest assessment</th>
                    <th scope="col">Open findings in latest</th>
                    <th scope="col" className="num hide-sm">Assessments</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const a = p.latest_assessment;
                    return (
                      <tr key={p.id} data-link onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) nav(`/projects/${p.id}`); }}>
                        <td>
                          <Link className="proj-name" to={`/projects/${p.id}`}>{p.name}</Link>
                          <div><SourceTag p={p} /></div>
                        </td>
                        <td>
                          {a ? (
                            <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
                              <Link to={`/assessments/${a.id}`} onClick={(e) => e.stopPropagation()} style={{ textDecoration: "none" }}><StateChip state={a.state} /></Link>
                              <span className="xs muted">#{a.number}, {ago(a.finished_at ?? a.created_at)}</span>
                            </div>
                          ) : <span className="muted small">Not assessed yet</span>}
                        </td>
                        <td>
                          {a?.state === "completed" ? (
                            <div style={{ display: "grid", gap: 6 }}>
                              <SeverityCountsView counts={a.counts} compact />
                              {total(a.counts) > 0 && <SeverityBar counts={a.counts} />}
                            </div>
                          ) : <span className="muted small">{a && isActive(a.state) ? "In progress" : "None"}</span>}
                        </td>
                        <td className="num hide-sm">{p.assessment_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {projects.data && list.length === 0 && (
        <section className="panel">
          <Empty title="Assess your first project"
            action={<div className="actions"><button className="btn btn-primary" onClick={() => setZip(true)}><IconUpload />Upload ZIP</button><button className="btn" onClick={() => setRepo(true)}><IconBranch />Connect repository</button></div>}>
            Upload a ZIP of your source code or connect a GitHub or GitLab repository. Securicode scans it, checks each alert against your code and explains what it finds. Nothing in your code changes until you approve a fix.
          </Empty>
        </section>
      )}

      <UploadZipDialog open={zip} onClose={() => setZip(false)} />
      <ConnectRepoDialog open={repo} onClose={() => setRepo(false)} />
    </>
  );
}
