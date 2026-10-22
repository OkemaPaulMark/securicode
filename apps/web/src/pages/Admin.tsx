import { useState, type FormEvent } from "react";
import { gateway } from "../api";
import type { User } from "../api/types";
import { RequireAdmin } from "../components/Layout";
import { Confirm, ErrorNote, Field, Loading, useAsync } from "../components/ui";
import { ago, dateTime } from "../lib/format";
import { usePage, useSession, useToast } from "../lib/session";
import { ACTION_LABEL, AuditTable } from "./Account";

function Users() {
  const { user: me } = useSession();
  const toast = useToast();
  const users = useAsync(() => gateway.listUsers(), []);
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<{ u: User; change: { role?: "user" | "admin"; is_active?: boolean }; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const updated = await gateway.updateUser(pending.u.id, pending.change);
      users.setData((xs) => xs?.map((x) => (x.id === updated.id ? updated : x)));
      toast(`${updated.name} updated.`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const needle = q.trim().toLowerCase();
  const list = (users.data ?? []).filter((u) => !needle || `${u.name} ${u.email}`.toLowerCase().includes(needle));

  return (
    <section className="panel">
      <div className="toolbar">
        <label className="sr-only" htmlFor="u-search">Search users</label>
        <input id="u-search" className="input" type="search" placeholder="Search by name or e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {users.error && <div className="panel-body"><ErrorNote error={users.error} onRetry={users.reload} /></div>}
      {!users.data && !users.error && <Loading />}
      {users.data && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Joined</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {list.map((u) => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id}>
                    <td><b>{u.name}</b>{self && <span className="chip" style={{ marginLeft: 8 }}>You</span>}<div className="xs muted">{u.email}</div></td>
                    <td>{u.role === "admin" ? "Administrator" : "User"}</td>
                    <td>
                      <div className="counts">
                        {u.is_active ? <span className="chip chip-ok">Active</span> : <span className="chip chip-bad">Deactivated</span>}
                        {!u.email_verified && <span className="chip chip-warn">E-mail not verified</span>}
                      </div>
                    </td>
                    <td title={dateTime(u.created_at)}>{ago(u.created_at)}</td>
                    <td>
                      <div className="actions" style={{ justifyContent: "flex-end" }}>
                        <button className="btn btn-sm" disabled={self}
                          onClick={() => setPending({ u, change: { role: u.role === "admin" ? "user" : "admin" }, text: u.role === "admin" ? `Remove administrator rights from ${u.name}?` : `Make ${u.name} an administrator?` })}>
                          {u.role === "admin" ? "Make user" : "Make admin"}
                        </button>
                        <button className={`btn btn-sm ${u.is_active ? "btn-danger" : ""}`} disabled={self}
                          onClick={() => setPending({ u, change: { is_active: !u.is_active }, text: u.is_active ? `Deactivate ${u.name}? They are signed out everywhere immediately.` : `Reactivate ${u.name}?` })}>
                          {u.is_active ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Confirm open={!!pending} onClose={() => setPending(null)} onConfirm={apply} busy={busy} danger={pending?.change.is_active === false}
        title="Change this account?" confirmLabel="Confirm">
        <p>{pending?.text}</p>
        <p className="small muted">The change is recorded in the audit log with your name.</p>
      </Confirm>
    </section>
  );
}

export function AdminUsersPage() {
  usePage("Users", [{ label: "Administration" }, { label: "Users" }]);
  return (
    <RequireAdmin>
      <div className="page-head"><div><h1>Users</h1><p>Change roles and deactivate accounts. You can't change your own account here.</p></div></div>
      <Users />
    </RequireAdmin>
  );
}

export function AdminAuditPage() {
  usePage("Audit log", [{ label: "Administration" }, { label: "Audit log" }]);
  const [action, setAction] = useState("");
  const audit = useAsync(() => gateway.allAudit(action, 300), [action]);
  return (
    <RequireAdmin>
      <div className="page-head"><div><h1>Audit log</h1><p>Every sign-in, decision and configuration change. Entries can't be edited or deleted.</p></div></div>
      <section className="panel">
        <div className="toolbar">
          <label className="sr-only" htmlFor="a-filter">Filter by action</label>
          <select id="a-filter" className="select" value={action} onChange={(e) => setAction(e.target.value)} style={{ maxWidth: 320 }}>
            <option value="">All actions</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {audit.error && <div className="panel-body"><ErrorNote error={audit.error} onRetry={audit.reload} /></div>}
        {!audit.data && !audit.error && <Loading />}
        {audit.data && <AuditTable rows={audit.data} showActor />}
      </section>
    </RequireAdmin>
  );
}

function LimitForm() {
  const toast = useToast();
  const s = useAsync(() => gateway.getSettings(), []);
  const [value, setValue] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const current = s.data?.daily_assessment_limit;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 10000) return toast("Enter a whole number between 0 and 10000.", "error");
    setBusy(true);
    try {
      const r = await gateway.putSettings(n);
      s.setData(() => r);
      setValue("");
      toast(`Daily limit set to ${r.daily_assessment_limit}.`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="lim-h">
      <div className="panel-head"><h2 id="lim-h" style={{ fontSize: "var(--t-lg)" }}>Daily assessment limit</h2></div>
      <form className="panel-body" onSubmit={save} style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Field label="Assessments per user per day" hint="Administrators are not limited. 0 stops new assessments for everyone else.">
          <input className="input" type="number" min={0} max={10000} placeholder={current !== undefined ? String(current) : ""} value={value} onChange={(e) => setValue(e.target.value)} style={{ maxWidth: 200 }} />
        </Field>
        <button className="btn btn-primary" style={{ marginTop: 27 }} disabled={busy || value === ""}>Save limit</button>
      </form>
    </section>
  );
}

const SERVICE_NAME: Record<string, string> = { ai: "AI", project: "Project", scan: "Scan", reporting: "Reporting" };

const STATUS_TEXT: Record<string, [string, string]> = {
  up: ["Reachable", "chip-ok"],
  down: ["Unreachable", "chip-bad"],
  "not-configured": ["No address set", "chip-warn"],
};

export function AdminSystemPage() {
  usePage("System", [{ label: "Administration" }, { label: "System" }]);
  const st = useAsync(() => gateway.status(), []);
  return (
    <RequireAdmin>
      <div className="page-head">
        <div><h1>System</h1><p>Whether the gateway can reach each service, and platform settings.</p></div>
        <button className="btn" onClick={st.reload}>Check again</button>
      </div>
      <div className="stack">
        <section className="panel" aria-labelledby="svc-h">
          <div className="panel-head"><h2 id="svc-h" style={{ fontSize: "var(--t-lg)" }}>Services</h2></div>
          {st.error && <div className="panel-body"><ErrorNote error={st.error} onRetry={st.reload} /></div>}
          {!st.data && !st.error && <Loading />}
          {st.data && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Service</th><th scope="col">Status</th><th scope="col">Handles</th></tr></thead>
                <tbody>
                  <tr><td><b>Gateway</b></td><td><span className="chip chip-ok">Reachable</span></td><td className="small mono">/api/auth, /api/admin</td></tr>
                  {Object.entries(st.data.services).map(([name, s]) => {
                    const [label, cls] = STATUS_TEXT[s] ?? [s.replace("error-", "Error "), "chip-bad"];
                    const prefixes = Object.entries(st.data!.routes).filter(([, svc]) => svc === name).map(([p]) => `/api/${p}`);
                    return (
                      <tr key={name}>
                        <td><b>{SERVICE_NAME[name] ?? name}</b></td>
                        <td><span className={`chip ${cls}`}>{label}</span></td>
                        <td className="small mono">{prefixes.join(", ") || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <LimitForm />
      </div>
    </RequireAdmin>
  );
}
