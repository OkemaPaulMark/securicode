import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { gateway, getMode } from "../api";
import type { AuditEntry } from "../api/types";
import { IconGithub, IconGitlab, IconTrash } from "../components/icons";
import { Confirm, Empty, ErrorNote, Field, Loading, Modal, useAsync } from "../components/ui";
import { ago, dateTime } from "../lib/format";
import { usePage, useSession, useToast } from "../lib/session";

export const ACTION_LABEL: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  "login.failed": "Failed sign-in",
  "login.locked_out": "Account locked after failed sign-ins",
  "login.blocked_locked": "Sign-in blocked while locked",
  "user.register": "Account created",
  "user.email_verified": "E-mail verified",
  "user.delete": "Account deleted",
  "password.reset_requested": "Password reset requested",
  "password.reset": "Password changed",
  "git_token.add": "Git token added",
  "git_token.remove": "Git token removed",
  "assessment.submit": "Assessment started",
  "assessment.cancel": "Assessment cancelled",
  "assessment.retry": "Assessment retried",
  "finding.decision": "Decision on a finding",
  "finding.reclassify": "Finding reclassified",
  "project.create": "Project created",
  "project.delete": "Project deleted",
  "admin.user_update": "User updated",
  "admin.settings_update": "Settings changed",
};

export function AuditTable({ rows, showActor = false }: { rows: AuditEntry[]; showActor?: boolean }) {
  if (!rows.length) return <Empty title="No activity yet" />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th scope="col">When</th>{showActor && <th scope="col">Who</th>}<th scope="col">What</th><th scope="col">Target</th><th scope="col">IP address</th></tr></thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={i}>
              <td title={dateTime(e.at)} style={{ whiteSpace: "nowrap" }}>{ago(e.at)}</td>
              {showActor && <td>{e.actor || "—"}</td>}
              <td>
                <span className={e.action.includes("failed") || e.action.includes("locked") ? "chip chip-bad" : ""}>{ACTION_LABEL[e.action] ?? e.action}</span>
                {e.detail && <div className="xs muted">{e.detail}</div>}
              </td>
              <td className="small" style={{ overflowWrap: "anywhere" }}>{e.target || "—"}</td>
              <td className="small mono">{e.ip || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GitTokens() {
  const toast = useToast();
  const tokens = useAsync(() => gateway.listGitTokens(), []);
  const [adding, setAdding] = useState(false);
  const [remove, setRemove] = useState<string | null>(null);
  const [form, setForm] = useState({ provider: "github" as "github" | "gitlab", token: "", label: "", host: "gitlab.com" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await gateway.addGitToken({ provider: form.provider, token: form.token.trim(), label: form.label.trim(), host: form.provider === "gitlab" ? form.host.trim() : "" });
      toast("Token checked with the provider and saved.");
      setAdding(false);
      setForm((f) => ({ ...f, token: "", label: "" }));
      tokens.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!remove) return;
    setBusy(true);
    try {
      await gateway.deleteGitToken(remove);
      toast("Token removed.");
      tokens.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setRemove(null);
    }
  };

  return (
    <section className="panel" id="tokens" aria-labelledby="tok-h">
      <div className="panel-head">
        <div>
          <h2 id="tok-h" style={{ fontSize: "var(--t-lg)" }}>Git access tokens</h2>
          <p className="small muted">Used to read private repositories. Stored encrypted; you won't see the full token again.</p>
        </div>
        <button className="btn" onClick={() => { setError(null); setAdding(true); }}>Add token</button>
      </div>
      {tokens.error && <div className="panel-body"><ErrorNote error={tokens.error} onRetry={tokens.reload} /></div>}
      {!tokens.data && !tokens.error && <Loading />}
      {tokens.data?.length === 0 && <Empty title="No tokens yet">Public repositories work without one.</Empty>}
      {!!tokens.data?.length && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Provider</th><th scope="col">Label</th><th scope="col">Token</th><th scope="col">Added</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {tokens.data.map((t) => (
                <tr key={t.id}>
                  <td><span className="source">{t.provider === "github" ? <IconGithub /> : <IconGitlab />}{t.host}</span></td>
                  <td>{t.label || <span className="muted">—</span>}</td>
                  <td className="mono">{t.masked}</td>
                  <td>{ago(t.created_at)}</td>
                  <td className="num"><button className="btn btn-sm btn-danger" onClick={() => setRemove(t.id)}><IconTrash size={14} />Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a Git access token"
        footer={<><button className="btn" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" form="tok-form" disabled={busy || form.token.length < 8}>{busy && <span className="spinner" aria-hidden="true" />}Check and save</button></>}>
        <form id="tok-form" className="form" onSubmit={add}>
          <div className="form-row">
            <Field label="Provider">
              <select className="select" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as "github" | "gitlab" })}>
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
              </select>
            </Field>
            {form.provider === "gitlab" ? (
              <Field label="GitLab host">
                <input className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="gitlab.com" />
              </Field>
            ) : <div />}
          </div>
          <Field label="Token" hint={form.provider === "github" ? "A fine-grained token with Contents: read is enough." : "A personal access token with the read_repository scope is enough."}>
            <input className="input mono" type="password" autoComplete="off" spellCheck={false} value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} required minLength={8} />
          </Field>
          <Field label="Label (optional)">
            <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="For example: university projects" maxLength={100} />
          </Field>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
        </form>
      </Modal>
      <Confirm open={!!remove} onClose={() => setRemove(null)} onConfirm={del} busy={busy} danger title="Remove this token?" confirmLabel="Remove token">
        <p>Projects that use it won't be able to fetch new code until you add another token. Revoke it on the provider's site too if you no longer need it.</p>
      </Confirm>
    </section>
  );
}

export function AccountPage() {
  const { user, signOut } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  usePage("Account");
  const audit = useAsync(() => gateway.myAudit(50), []);
  const [del, setDel] = useState(false);
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView();
  }, [loc.hash]);

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      await gateway.deleteAccount(pwd);
      await signOut();
      toast("Your account and its data were deleted.");
      nav("/signin");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    try {
      await gateway.requestPasswordReset(user!.email);
      toast(`We sent a link to ${user!.email} to choose a new password.`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <div className="page-head"><div><h1>Account</h1><p>Your profile, Git access and recent activity.</p></div></div>
      <div className="stack">
        <section className="panel" aria-labelledby="prof-h">
          <div className="panel-head"><h2 id="prof-h" style={{ fontSize: "var(--t-lg)" }}>Profile</h2>
            {getMode() === "live" && <button className="btn" onClick={resetPassword}>Change password</button>}</div>
          <dl className="facts panel-body">
            <div><dt>Name</dt><dd>{user!.name}</dd></div>
            <div><dt>E-mail</dt><dd>{user!.email} {user!.email_verified ? <span className="chip chip-ok">Verified</span> : <span className="chip chip-warn">Not verified</span>}</dd></div>
            <div><dt>Role</dt><dd>{user!.role === "admin" ? "Administrator" : "User"}</dd></div>
            <div><dt>Member since</dt><dd>{dateTime(user!.created_at)}</dd></div>
          </dl>
        </section>

        <GitTokens />

        <section className="panel" aria-labelledby="act-h">
          <div className="panel-head"><h2 id="act-h" style={{ fontSize: "var(--t-lg)" }}>Recent activity</h2></div>
          {audit.error && <div className="panel-body"><ErrorNote error={audit.error} onRetry={audit.reload} /></div>}
          {!audit.data && !audit.error && <Loading />}
          {audit.data && <AuditTable rows={audit.data} />}
        </section>

        <section className="panel" aria-labelledby="del-h" style={{ borderColor: "color-mix(in srgb, var(--crit) 35%, var(--line))" }}>
          <div className="panel-head">
            <div>
              <h2 id="del-h" style={{ fontSize: "var(--t-lg)" }}>Delete account</h2>
              <p className="small muted">Deletes your account, projects, uploaded code, assessments and Git tokens. This can't be undone.</p>
            </div>
            <button className="btn btn-danger" onClick={() => { setPwd(""); setError(null); setDel(true); }}>Delete account</button>
          </div>
        </section>
      </div>

      <Confirm open={del} onClose={() => setDel(false)} onConfirm={deleteAccount} busy={busy} danger title="Delete your account?" confirmLabel="Delete everything">
        <p>Everything linked to <b>{user!.email}</b> is removed from every Securicode service. Enter your password to confirm.</p>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
        </Field>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
      </Confirm>
    </>
  );
}
