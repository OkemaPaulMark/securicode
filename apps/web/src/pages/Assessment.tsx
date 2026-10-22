import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { platform } from "../api";
import type { Assessment, Finding, Severity, ToolRun } from "../api/types";
import { SEVERITIES } from "../api/types";
import { ChatDrawer } from "../components/ChatDrawer";
import { FindingDetail, NoSelection } from "../components/FindingDetail";
import { IconChat, IconDownload, IconFile, IconRefresh, IconStop } from "../components/icons";
import { Confirm, ErrorNote, Loading, SeverityBadge, SeverityCountsView, StateChip, StatusChip, useAsync, usePolling } from "../components/ui";
import { ago, dateTime, download, duration, isActive, SEVERITY_LABEL, sortFindings } from "../lib/format";
import { usePage, useToast } from "../lib/session";

// ---------------------------------------------------------------- progress (ASMT-3, ASMT-4)
const STAGES = [
  { key: "queued", name: "Queued", sub: "Waiting for a worker" },
  { key: "running_scans", name: "Running scans", sub: "Scanners read the code" },
  { key: "ai_analysing", name: "AI analysing", sub: "The agent checks each alert" },
  { key: "completed", name: "Completed", sub: "Ready for your review" },
] as const;

function Progress({ a }: { a: Assessment }) {
  const order = STAGES.map((s) => s.key as string);
  const failed = a.state === "failed" || a.state === "cancelled";
  const reached = failed
    ? Math.max(1, a.tools.some((t) => t.state === "done") ? (a.ai.total ? 2 : 1) : a.started_at ? 1 : 0)
    : order.indexOf(a.state);
  return (
    <section className="panel" aria-labelledby="prog-h">
      <div className="panel-head">
        <h2 id="prog-h" style={{ fontSize: "var(--t-lg)" }}>{failed ? `Stopped while ${STAGES[reached].name.toLowerCase()}` : "Progress"}</h2>
        {!failed && <span className="small muted" aria-live="polite">{a.state === "ai_analysing" ? `Checked ${a.ai.analysed} of ${a.ai.total} candidate findings`
            : `${a.tools.filter((t) => t.state === "done").length} of ${a.tools.filter((t) => t.state !== "skipped").length} scanners finished`}</span>}
      </div>
      <ol className="stepper">
        {STAGES.map((s, i) => {
          const state = failed && i === reached ? "failed" : i < reached || (i === reached && a.state === "completed") ? "done" : i === reached ? "active" : "todo";
          return (
            <li key={s.key} data-state={state} aria-current={state === "active" ? "step" : undefined}>
              <span className="step-name">{s.name}</span>
              <span className="step-sub">{state === "failed" ? (a.state === "cancelled" ? "Cancelled" : "Failed") : s.sub}</span>
            </li>
          );
        })}
      </ol>
      <div className="tools" aria-label="Scanner progress">
        {a.tools.map((t) => <Tool key={t.name} t={t} />)}
      </div>
      <ModelNote a={a} />
    </section>
  );
}

const TOOL_LABEL: Record<ToolRun["state"], string> = { pending: "Waiting", running: "Running", done: "Done", failed: "Failed", timed_out: "Timed out", skipped: "Skipped" };

function Tool({ t }: { t: ToolRun }) {
  const cls = t.state === "done" ? "chip-ok" : t.state === "running" ? "chip-info" : t.state === "failed" || t.state === "timed_out" ? "chip-bad" : "";
  return (
    <div className="tool" title={t.reason}>
      <div><b>{t.name}</b>{t.version && <div className="xs muted">{t.version}</div>}</div>
      <span className={`chip ${cls}`}>
        {t.state === "running" && <span className="dot dot-pulse" aria-hidden="true" />}
        {t.state === "done" && t.alerts !== undefined ? `${t.alerts} alerts` : TOOL_LABEL[t.state]}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- funnel: the assessment's story in four numbers
function Funnel({ a }: { a: Assessment }) {
  const { raw, merged, validated, approved } = a.funnel;
  const max = Math.max(raw, 1);
  const rows = [
    { label: "Scanner alerts", sub: `from ${a.tools.filter((t) => t.state === "done").length} tools`, n: raw },
    { label: "After merging duplicates", sub: "same line, same weakness", n: merged },
    { label: "Confirmed by the agent", sub: `${a.status_counts.false_positive} dismissed, ${a.status_counts.needs_review} need review`, n: validated },
    { label: "Fixes you approved", sub: "applied only with your approval", n: approved },
  ];
  return (
    <section className="panel" aria-labelledby="funnel-h">
      <div className="panel-head">
        <h2 id="funnel-h" style={{ fontSize: "var(--t-lg)" }}>From alerts to approved fixes</h2>
        <SeverityCountsView counts={a.counts} compact />
      </div>
      <div className="funnel">
        {rows.map((r) => (
          <div className="funnel-row" key={r.label}>
            <div className="funnel-label">{r.label}<small>{r.sub}</small></div>
            <div className="funnel-track" aria-hidden="true"><div className="funnel-fill" style={{ width: `${Math.max(r.n ? 2 : 0, (r.n / max) * 100)}%` }} /></div>
            <div className="funnel-num">{r.n}</div>
          </div>
        ))}
      </div>
      <ModelNote a={a} />
    </section>
  );
}

/** SEC-7: say which model was used and where it runs. */
function ModelNote({ a }: { a: Assessment }) {
  if (!a.ai.model) return null;
  return (
    <p className="xs muted" style={{ padding: "0 20px 16px" }}>
      AI agent: {a.ai.model}, {a.ai.model_location === "local" ? "running on Securicode's own server. No code leaves it." : "a hosted service. Only the lines needed to check each finding are sent to it."}
    </p>
  );
}

// ---------------------------------------------------------------- findings list
type Tab = "review" | "dismissed" | "decided";
type Sort = "severity" | "confidence" | "file" | "status";

function FindingList({ items, selected, onSelect, grouped }: { items: Finding[]; selected?: string; onSelect: (id: string) => void; grouped: boolean }) {
  const groups: [Severity | "all", Finding[]][] = grouped
    ? SEVERITIES.map((s) => [s, items.filter((f) => f.severity === s)] as [Severity, Finding[]]).filter(([, l]) => l.length)
    : [["all", items]];
  return (
    <ul className="flist" aria-label="Findings">
      {groups.map(([g, list]) => (
        <li key={g}>
          {g !== "all" && <div className="fgroup"><span>{SEVERITY_LABEL[g]}</span><span>{list.length}</span></div>}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {list.map((f) => (
              <li key={f.id}>
                <button className="fitem" aria-current={selected === f.id} onClick={() => onSelect(f.id)} id={`fi-${f.id}`}>
                  <div className="fitem-title">{f.title}</div>
                  <div className="fitem-meta">
                    <SeverityBadge level={f.severity} />
                    <span>{Math.round(f.confidence * 100)}%</span>
                    <span className="mono">{f.file}:{f.line}</span>
                    <StatusChip finding={f} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- page
export function AssessmentPage() {
  const { assessmentId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const assessment = useAsync(() => platform.getAssessment(assessmentId), [assessmentId]);
  const a = assessment.data;
  const active = !!a && isActive(a.state);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  const [sort, setSort] = useState<Sort>("severity");
  const [sev, setSev] = useState<Severity | "">("");
  const [q, setQ] = useState("");
  const [chat, setChat] = useState<{ open: boolean; finding?: Finding }>({ open: false });
  const [cancel, setCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  usePage(a ? `${a.project_name} #${a.number}` : "Assessment", [
    { label: "Projects", to: "/" },
    { label: a?.project_name ?? "…", to: a ? `/projects/${a.project_id}` : undefined },
    { label: a ? `Assessment #${a.number}` : "Assessment" },
  ]);

  usePolling(() => { assessment.reload(); }, active, 2000);

  const completed = a?.state === "completed";
  useEffect(() => {
    if (!completed) return;
    platform.listFindings(assessmentId).then(setFindings).catch((e) => toast((e as Error).message, "error"));
  }, [assessmentId, completed, toast]);

  const all = useMemo(() => findings ?? [], [findings]);
  const buckets = useMemo(() => ({
    review: all.filter((f) => f.status !== "false_positive" && !f.decision),
    decided: all.filter((f) => f.status !== "false_positive" && f.decision),
    dismissed: all.filter((f) => f.status === "false_positive"),
  }), [all]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = buckets[tab].filter((f) => (!sev || f.severity === sev) &&
      (!needle || `${f.title} ${f.file} ${f.cwe ?? ""} ${f.id}`.toLowerCase().includes(needle)));
    return sortFindings(list, sort);
  }, [buckets, tab, sev, q, sort]);

  const selectedId = params.get("finding") ?? undefined;
  const selected = all.find((f) => f.id === selectedId);

  // keep the selection in the visible tab; pick the first finding when nothing is selected (desktop)
  useEffect(() => {
    if (!findings) return;
    if (selected) {
      const where: Tab = selected.status === "false_positive" ? "dismissed" : selected.decision ? "decided" : "review";
      if (where !== tab && !buckets[tab].some((f) => f.id === selected.id)) setTab(where);
    } else if (visible[0] && window.matchMedia?.("(min-width: 1101px)").matches) {
      setParams((p) => { p.set("finding", visible[0].id); return p; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findings, selectedId]);

  const select = useCallback((id: string) => {
    setParams((p) => { p.set("finding", id); return p; }, { replace: true });
    document.getElementById(`fi-${id}`)?.scrollIntoView({ block: "nearest" });
  }, [setParams]);

  // j / k to move through the list
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, dialog, .drawer")) return;
      if (e.key !== "j" && e.key !== "k") return;
      const i = visible.findIndex((f) => f.id === selectedId);
      const next = visible[e.key === "j" ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1)];
      if (next) select(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, select]);

  const update = (f: Finding) => {
    setFindings((xs) => xs?.map((x) => (x.id === f.id ? f : x)) ?? null);
    assessment.reload();
  };

  const doCancel = async () => {
    setBusy(true);
    try {
      await platform.cancelAssessment(assessmentId);
      toast("Assessment cancelled.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setCancel(false);
      assessment.reload();
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      await platform.retryAssessment(assessmentId);
      setFindings(null);
      toast("Assessment restarted.");
      await assessment.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const exportSarif = async () => {
    try {
      download(`${a!.project_name}-assessment-${a!.number}.sarif`, await platform.sarif(assessmentId));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const exportPdf = async () => {
    const pdf = await platform.pdf(assessmentId);
    if (pdf) download(`${a!.project_name}-assessment-${a!.number}.pdf`, pdf);
    else nav(`/assessments/${assessmentId}/report`);
  };

  const exportPatch = async () => {
    const ids = all.filter((f) => f.decision === "approved" && f.proposed_fix).map((f) => f.id);
    if (!ids.length) return toast("Approve at least one fix first.", "error");
    try {
      download(`${a!.project_name}-assessment-${a!.number}-approved.patch`, await platform.patch(assessmentId, ids), "text/x-diff");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (assessment.error && !a) return <ErrorNote error={assessment.error} onRetry={assessment.reload} />;
  if (!a) return <Loading label="Loading assessment" />;

  const approvedCount = all.filter((f) => f.decision === "approved" && f.proposed_fix).length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="counts" style={{ marginBottom: 8 }}><StateChip state={a.state} /></div>
          <h1>{a.project_name}, assessment #{a.number}</h1>
          <p>
            {a.source_label}. Started {ago(a.created_at)}
            {a.finished_at ? `, took ${duration(a.created_at, a.finished_at)}` : ""}.
            <span className="sr-only"> {dateTime(a.created_at)}</span>
          </p>
        </div>
        <div className="actions">
          {active && <button className="btn btn-danger" onClick={() => setCancel(true)}><IconStop />Cancel</button>}
          {(a.state === "failed" || a.state === "cancelled") && <button className="btn btn-primary" onClick={retry} disabled={busy}><IconRefresh />Retry</button>}
          {completed && (
            <>
              <button className="btn" onClick={() => setChat({ open: true })}><IconChat />Ask</button>
              <button className="btn" onClick={exportSarif} title="SARIF 2.1.0, for GitHub code scanning and other tools"><IconDownload />SARIF</button>
              <button className="btn" onClick={exportPatch} disabled={!approvedCount} title={approvedCount ? `${approvedCount} approved fix${approvedCount === 1 ? "" : "es"} in one patch` : "Approve a fix first"}><IconDownload />Approved fixes</button>
              <button className="btn btn-primary" onClick={exportPdf}><IconFile />Report</button>
            </>
          )}
        </div>
      </div>

      <div className="stack">
        {a.state === "failed" && (
          <div className="alert alert-error" role="alert">
            <div className="grow"><strong>This assessment failed</strong>{a.failure_reason ?? "One of the stages stopped unexpectedly."}</div>
          </div>
        )}
        {completed && !a.ai.available && (
          <div className="alert alert-warn" role="status">
            <div className="grow"><strong>AI validation was unavailable</strong>These are the scanners' results without the agent's checks, so expect some false alarms. Run the assessment again later for validated results.</div>
          </div>
        )}

        {!completed ? <Progress a={a} /> : <Funnel a={a} />}

        {completed && (
          <section aria-label="Findings">
            <div className="tabs" role="tablist">
              {([
                ["review", "To review"],
                ["decided", "Decided"],
                ["dismissed", "Dismissed"],
              ] as [Tab, string][]).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                  {label}<span className="count">{buckets[k].length}</span>
                </button>
              ))}
            </div>

            {!findings ? <Loading label="Loading findings" /> : (
              <div className="workspace">
                <div className="panel">
                  <div className="toolbar">
                    <label className="sr-only" htmlFor="f-search">Search findings</label>
                    <input id="f-search" className="input" type="search" placeholder="Search title, file or CWE" value={q} onChange={(e) => setQ(e.target.value)} />
                    <label className="sr-only" htmlFor="f-sev">Severity</label>
                    <select id="f-sev" className="select" value={sev} onChange={(e) => setSev(e.target.value as Severity | "")}>
                      <option value="">All severities</option>
                      {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
                    </select>
                    <label className="sr-only" htmlFor="f-sort">Sort by</label>
                    <select id="f-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                      <option value="severity">Sort: severity</option>
                      <option value="confidence">Sort: confidence</option>
                      <option value="file">Sort: file</option>
                      <option value="status">Sort: status</option>
                    </select>
                  </div>
                  {tab === "dismissed" && <p className="xs muted" style={{ padding: "10px 16px 0" }}>Alerts the agent judged to be false alarms, with its reasoning. They stay here so you can overrule it.</p>}
                  {visible.length ? (
                    <FindingList items={visible} selected={selectedId} onSelect={select} grouped={sort === "severity"} />
                  ) : (
                    <p className="small muted" style={{ padding: 16 }}>
                      {buckets[tab].length ? "No findings match these filters." : tab === "review" ? "You've reviewed every finding. Run a new assessment after applying fixes to confirm they worked." : tab === "dismissed" ? "The agent didn't dismiss any alerts." : "No decisions yet."}
                    </p>
                  )}
                </div>
                {selected ? (
                  <FindingDetail key={selected.id} assessmentId={assessmentId} finding={selected} all={all} onChange={update}
                    onAsk={() => setChat({ open: true, finding: selected })} onSelect={select} />
                ) : <NoSelection hasFindings={visible.length > 0} />}
              </div>
            )}
          </section>
        )}

        {a.state !== "completed" && a.project_id && (
          <p className="small muted">You can leave this page; the assessment keeps running. <Link to={`/projects/${a.project_id}`}>Back to {a.project_name}</Link></p>
        )}
      </div>

      {chat.open && <ChatDrawer assessmentId={assessmentId} finding={chat.finding} onClose={() => setChat({ open: false })} />}
      <Confirm open={cancel} onClose={() => setCancel(false)} onConfirm={doCancel} busy={busy} danger title="Cancel this assessment?" confirmLabel="Cancel assessment">
        <p>Scanners that are still running will be stopped and no findings will be produced. You can retry it later; it counts toward your daily limit again.</p>
      </Confirm>
    </>
  );
}
