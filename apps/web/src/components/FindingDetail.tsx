import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platform } from "../api";
import type { Decision, Finding } from "../api/types";
import { dateTime, DECISION_LABEL, download, STATUS_LABEL } from "../lib/format";
import { useToast } from "../lib/session";
import { DiffView } from "./DiffView";
import { IconAlert, IconChat, IconCheck, IconDownload, IconExternal, IconX } from "./icons";
import { Confidence, Confirm, SeverityBadge, StatusChip } from "./ui";

interface Props {
  assessmentId: string;
  finding: Finding;
  all: Finding[];
  onChange: (f: Finding) => void;
  onAsk: () => void;
  onSelect: (id: string) => void;
}

export function FindingDetail({ assessmentId, finding: f, all, onChange, onAsk, onSelect }: Props) {
  const toast = useToast();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  useEffect(() => { setComment(f.decision_comment ?? ""); }, [f.id, f.decision_comment]);

  const act = async (key: string, fn: () => Promise<Finding>, done: string) => {
    setBusy(key);
    try {
      const updated = await fn();
      onChange(updated);
      toast(done);
      return updated;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const decide = (d: Decision | null, done: string) => act(d ?? "reopen", () => platform.decide(assessmentId, f.id, d, comment.trim()), done);

  const approve = async () => {
    const updated = await decide("approved", `Fix approved for ${f.id}. The patch file is downloading.`);
    setConfirmApprove(false);
    if (updated) await downloadPatch();
  };

  const downloadPatch = async () => {
    try {
      const text = await platform.patch(assessmentId, [f.id]);
      download(`${f.id}.patch`, text, "text/x-diff");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const dismissed = f.status === "false_positive";
  const related = (f.related ?? []).map((id) => all.find((x) => x.id === id)).filter(Boolean) as Finding[];

  return (
    <article className="panel" aria-labelledby={`f-${f.id}`}>
      <header className="detail-head">
        <div className="counts">
          <SeverityBadge level={f.severity} />
          <StatusChip finding={f} />
          {f.manipulation_attempt && <span className="chip chip-bad"><IconAlert size={13} />Manipulation attempt</span>}
          <span className="chip mono">{f.id}</span>
        </div>
        <h2 id={`f-${f.id}`}>{f.title}</h2>
        <dl className="facts">
          <div><dt>Location</dt><dd className="mono">{f.file}:{f.line}{f.end_line && f.end_line !== f.line ? `–${f.end_line}` : ""}</dd></div>
          <div><dt>Weakness</dt><dd>{f.cwe ? <a href={`https://cwe.mitre.org/data/definitions/${f.cwe.replace("CWE-", "")}.html`} target="_blank" rel="noreferrer">{f.cwe}</a> : "—"}</dd></div>
          <div><dt>OWASP category</dt><dd>{f.owasp ?? "—"}</dd></div>
          <div><dt>Detected by</dt><dd>{f.detected_by.join(", ")}</dd></div>
          <div><dt>Confidence</dt><dd><Confidence value={f.confidence} /></dd></div>
          <div><dt>Agent verdict</dt><dd>{STATUS_LABEL[f.status]}</dd></div>
        </dl>
      </header>

      {f.status === "unvalidated" && (
        <div className="section"><div className="alert alert-info">This is a raw scanner result. The AI agent wasn't available during this assessment, so it hasn't been checked against your code.</div></div>
      )}

      {f.manipulation_attempt && (
        <div className="section">
          <div className="alert alert-error">
            <IconAlert />
            <div className="grow"><strong>Someone wrote instructions for an AI reviewer in this code.</strong>Securicode treats code as data, so the text had no effect on this assessment. The finding is reported so a person can look at who added it and why.</div>
          </div>
        </div>
      )}

      <section className="section">
        <h3>{dismissed ? "Why it was dismissed" : "What could happen"}</h3>
        <div className="prose"><p>{dismissed ? f.evidence : f.explanation}</p></div>
      </section>

      <section className="section">
        <h3>{dismissed ? "Original alert" : "Evidence"}</h3>
        {!dismissed && <p className="evidence prose">{f.evidence}</p>}
        {dismissed && <p className="prose muted">{f.explanation}</p>}
        {f.evidence_lines && f.evidence_lines.length > 0 && (
          <pre className="codeblock" aria-label="Lines the agent quoted as evidence">
            {f.evidence_lines.map((l, i) => <div key={i}><span className="muted">{l.file}:{l.line}</span>{"  "}{l.code}</div>)}
          </pre>
        )}
        {f.code && !f.evidence_lines?.length && <pre className="codeblock"><span className="muted">{f.file}:{f.line}</span>{"  "}{f.code}</pre>}
      </section>

      {!dismissed && (
        <section className="section">
          <h3>{f.proposed_fix ? "Proposed fix" : "How to fix it"}</h3>
          <p className="prose">{f.remediation}</p>
          {f.remediation_steps && f.remediation_steps.length > 0 && (
            <ol className="steps-list prose">{f.remediation_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          )}
          {f.proposed_fix && <DiffView diff={f.proposed_fix.diff} />}
        </section>
      )}

      {f.references.length > 0 && (
        <section className="section">
          <h3>References</h3>
          <ul className="refs">
            {f.references.map((r, i) => (
              <li key={i}>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title} <IconExternal /></a> : r.title}</li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section className="section">
          <h3>Related findings</h3>
          <ul className="refs">
            {related.map((r) => <li key={r.id}><button className="btn btn-sm btn-ghost" style={{ padding: 0, color: "var(--accent)" }} onClick={() => onSelect(r.id)}>{r.id}: {r.title}</button></li>)}
          </ul>
        </section>
      )}

      <footer className="decision-bar" aria-label="Your decision">
        {f.decision ? (
          <div className="decided">
            <span className={`chip ${f.decision === "approved" ? "chip-ok" : f.decision === "rejected" ? "chip-bad" : ""}`}>
              {f.decision === "approved" ? <IconCheck size={14} /> : <IconX size={14} />}{DECISION_LABEL[f.decision]}
            </span>
            <span className="small muted">by {f.decided_by ?? "you"}{f.decided_at ? `, ${dateTime(f.decided_at)}` : ""}</span>
            {f.decision_comment && <span className="small">“{f.decision_comment}”</span>}
            <span style={{ flex: 1 }} />
            {f.decision === "approved" && f.proposed_fix && <button className="btn btn-sm" onClick={downloadPatch}><IconDownload />Download patch</button>}
            {dismissed
              ? <button className="btn btn-sm" disabled={!!busy} onClick={() => act("restore", () => platform.reclassify(assessmentId, f.id, "validated", comment.trim()), `${f.id} is back in the review list.`)}>Treat as real issue</button>
              : <button className="btn btn-sm" disabled={!!busy} onClick={() => decide(null, `Decision on ${f.id} cleared.`)}>Change decision</button>}
            <button className="btn btn-sm" onClick={onAsk}><IconChat />Ask about this</button>
          </div>
        ) : (
          <>
            <label className="field">
              <span>Comment <span className="muted" style={{ fontWeight: 400 }}>(optional, saved with your decision)</span></span>
              <textarea className="textarea" style={{ minHeight: 60 }} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000}
                placeholder={dismissed ? "Why you think this is a real issue" : "For example: input is already validated in middleware"} />
            </label>
            <div className="actions">
              {dismissed ? (
                <button className="btn btn-primary" disabled={!!busy} onClick={() => act("restore", () => platform.reclassify(assessmentId, f.id, "validated", comment.trim()), `${f.id} is back in the review list.`)}>Treat as real issue</button>
              ) : (
                <>
                  {f.proposed_fix && <button className="btn btn-primary" disabled={!!busy} onClick={() => setConfirmApprove(true)}><IconCheck />Approve fix</button>}
                  {f.status === "needs_review" && (
                    <button className="btn" disabled={!!busy} onClick={() => act("confirm", () => platform.reclassify(assessmentId, f.id, "validated", comment.trim()), `${f.id} confirmed as a real issue.`)}>Confirm it's real</button>
                  )}
                  {f.proposed_fix && <button className="btn" disabled={!!busy} onClick={() => decide("rejected", `Fix rejected for ${f.id}.`)}>Reject fix</button>}
                  <button className="btn" disabled={!!busy} onClick={() => act("fp", () => platform.reclassify(assessmentId, f.id, "false_positive", comment.trim()), `${f.id} moved to Dismissed.`)}>Mark false positive</button>
                </>
              )}
              <span style={{ flex: 1 }} />
              <button className="btn btn-ghost" onClick={onAsk}><IconChat />Ask about this</button>
            </div>
          </>
        )}
      </footer>

      <Confirm open={confirmApprove} onClose={() => setConfirmApprove(false)} onConfirm={approve} busy={busy === "approved"}
        title={`Approve the fix for ${f.id}?`} confirmLabel="Approve and download patch">
        <p>Your approval is recorded with your name and the time. Securicode doesn't change your repository; you get <code>{f.id}.patch</code> to apply yourself:</p>
        <pre className="codeblock">git apply {f.id}.patch</pre>
        <p className="small muted">Check that the project still builds and its tests pass, then run a new assessment to confirm the issue is resolved.</p>
      </Confirm>
    </article>
  );
}

export function NoSelection({ hasFindings }: { hasFindings: boolean }) {
  return (
    <div className="panel">
      <div className="empty">
        <h3>{hasFindings ? "Select a finding" : "Nothing to review here"}</h3>
        <p>{hasFindings ? "Choose a finding from the list to see the evidence, the explanation and the proposed fix." : "No findings match. Change the filters, or open the Dismissed tab to see alerts the agent ruled out."}</p>
        {!hasFindings && <Link className="btn btn-sm" to="?">Clear filters</Link>}
      </div>
    </div>
  );
}
