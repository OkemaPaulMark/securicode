import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { platform } from "../api";
import type { Finding } from "../api/types";
import { DiffView } from "../components/DiffView";
import { ErrorNote, Loading, SeverityBadge, SeverityCountsView, useAsync } from "../components/ui";
import { dateTime, DECISION_LABEL, duration, sortFindings } from "../lib/format";
import { usePage, useSession } from "../lib/session";

/** Printable assessment report (REPT-2). "Save as PDF" from the print dialog produces the PDF export. */
export function ReportPage() {
  const { assessmentId = "" } = useParams();
  const { user } = useSession();
  const a = useAsync(() => platform.getAssessment(assessmentId), [assessmentId]);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  useEffect(() => { platform.listFindings(assessmentId).then(setFindings).catch(() => setFindings([])); }, [assessmentId]);
  usePage(a.data ? `Report: ${a.data.project_name} #${a.data.number}` : "Report", [
    { label: "Projects", to: "/" },
    { label: a.data?.project_name ?? "…", to: a.data ? `/projects/${a.data.project_id}` : undefined },
    { label: a.data ? `#${a.data.number}` : "…", to: `/assessments/${assessmentId}` },
    { label: "Report" },
  ]);

  if (a.error) return <ErrorNote error={a.error} onRetry={a.reload} />;
  if (!a.data || !findings) return <Loading label="Preparing report" />;
  const as = a.data;
  const real = sortFindings(findings.filter((f) => f.status !== "false_positive"), "severity");
  const dismissed = findings.filter((f) => f.status === "false_positive");

  return (
    <>
      <div className="actions no-print" style={{ marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
        <Link className="btn" to={`/assessments/${assessmentId}`}>Back to findings</Link>
      </div>
      <article className="report panel">
        <header className="stack">
          <div>
            <p className="small muted">Securicode security assessment report</p>
            <h1>{as.project_name}, assessment #{as.number}</h1>
          </div>
          <dl className="facts">
            <div><dt>Source</dt><dd>{as.source_label}</dd></div>
            <div><dt>Started</dt><dd>{dateTime(as.created_at)}</dd></div>
            <div><dt>Duration</dt><dd>{duration(as.created_at, as.finished_at) || "—"}</dd></div>
            <div><dt>Prepared for</dt><dd>{user?.name}</dd></div>
          </dl>
          <div>
            <h2 style={{ fontSize: "var(--t-lg)", marginBottom: 8 }}>Summary</h2>
            <p>
              The scanners raised {as.funnel.raw} alerts, merged into {as.funnel.merged} candidate findings. The AI agent confirmed {as.funnel.validated},
              dismissed {as.status_counts.false_positive} as false alarms and marked {as.status_counts.needs_review} for human review.
              {" "}{as.funnel.approved} proposed fix{as.funnel.approved === 1 ? " was" : "es were"} approved.
            </p>
            <div style={{ marginTop: 12 }}><SeverityCountsView counts={as.counts} /></div>
          </div>
          <p className="small muted">Scanners: {as.tools.filter((t) => t.state === "done").map((t) => `${t.name} ${t.version ?? ""}`.trim()).join(", ")}.
            {as.ai.model && ` AI agent: ${as.ai.model} (${as.ai.model_location === "local" ? "local" : "hosted"}).`}</p>
        </header>

        <h2 style={{ fontSize: "var(--t-xl)", margin: "32px 0 8px" }}>Findings</h2>
        {real.length === 0 && <p className="muted">No open findings.</p>}
        {real.map((f) => (
          <section key={f.id} className="finding">
            <div className="counts"><SeverityBadge level={f.severity} /><span className="chip mono">{f.id}</span>
              {f.decision && <span className="chip">{DECISION_LABEL[f.decision]}</span>}</div>
            <h3>{f.title}</h3>
            <p className="small"><span className="mono">{f.file}:{f.line}</span>. {[f.cwe, f.owasp].filter(Boolean).join(", ")}. Confidence {Math.round(f.confidence * 100)}%.</p>
            <p>{f.explanation}</p>
            <p className="small"><b>Evidence.</b> {f.evidence}</p>
            <p className="small"><b>Remediation.</b> {f.remediation}</p>
            {f.remediation_steps && <ol className="steps-list small">{f.remediation_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
            {f.proposed_fix && <DiffView diff={f.proposed_fix.diff} />}
            {f.references.length > 0 && <p className="xs muted">References: {f.references.map((r) => r.title).join("; ")}</p>}
          </section>
        ))}

        {dismissed.length > 0 && (
          <>
            <h2 style={{ fontSize: "var(--t-xl)", margin: "32px 0 8px" }}>Dismissed as false positives</h2>
            {dismissed.map((f) => (
              <section key={f.id} className="finding">
                <h3 style={{ fontSize: "var(--t-md)" }}>{f.id}: {f.title} <span className="small mono muted">{f.file}:{f.line}</span></h3>
                <p className="small">{f.evidence}</p>
              </section>
            ))}
          </>
        )}

        <p className="disclaimer">
          This assessment combines automated scanners with an AI agent and the decisions of the people who reviewed it. It does not
          guarantee that the project is free of vulnerabilities. Findings and proposed fixes should be checked by a developer before
          they are relied on, and the project should be assessed again after changes.
        </p>
      </article>
    </>
  );
}
