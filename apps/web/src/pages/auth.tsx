import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { gateway } from "../api";
import { ApiError } from "../api/http";
import { Logo } from "../components/icons";
import { Field } from "../components/ui";
import { useSession } from "../lib/session";

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-form-side">
        <Link to="/" className="brand" style={{ marginBottom: 48 }}><Logo />Securicode</Link>
        <div className="auth-card">{children}</div>
      </div>
      <Story />
    </div>
  );
}

/** The product in one picture: a real alert, the agent's verdict, and the fix waiting for a person's approval. */
function Story() {
  const rows: [string, " " | "-" | "+", string][] = [
    ["40", " ", 'name = request.args.get("username")'],
    ["41", "-", "q = f\"SELECT * FROM users WHERE name = '{name}'\""],
    ["42", "-", "cursor.execute(q)"],
    ["41", "+", 'q = "SELECT * FROM users WHERE name = %s"'],
    ["42", "+", "cursor.execute(q, (name,))"],
  ];
  return (
    <section className="auth-story" aria-label="How Securicode works">
      <p className="story-title">Scanners raise the alerts. The agent checks them against your code. You approve every fix.</p>
      <div className="story-diff" aria-hidden="true">
        <div className="diff-head"><span>app/db/users.py</span><span>proposed fix</span></div>
        <pre>
          {rows.map(([no, mk, code], i) => (
            <div key={i} className={`ln ${mk === "-" ? "del" : mk === "+" ? "add" : "ctx"}`}>
              <span className="no">{no}</span><span className="mk">{mk}</span><span>{code}</span>
            </div>
          ))}
        </pre>
        <div className="story-verdict">
          <span className="sev sev-high">High</span>
          <span>SQL injection, CWE-89. The username comes straight from the request and is never validated. Confidence 92%.</span>
        </div>
      </div>
      <div className="story-steps">
        <span><b>40</b>scanner alerts</span>
        <span><b>16</b>confirmed by the agent</span>
        <span><b>10</b>fixes you approved</span>
      </div>
      <p className="story-sub">Semgrep, Bandit, SonarQube, pip-audit, npm audit and Gitleaks find the candidates. Securicode's agent reads the surrounding code, drops false alarms with a written reason, and explains the rest with OWASP and CWE references.</p>
    </section>
  );
}

export function SignIn() {
  const { user, signIn, startDemo, notice, clearNotice } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = "Sign in · Securicode"; }, []);
  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    clearNotice();
    try {
      await signIn(email, password);
      nav(from, { replace: true });
    } catch (err) {
      const ae = err as ApiError;
      setUnreachable(ae.status === 0 || ae.status === 502 || ae.status === 503 || ae.status === 504);
      setError(ae.message);
    } finally {
      setBusy(false);
    }
  };

  const demo = async () => {
    await startDemo();
    nav("/", { replace: true });
  };

  return (
    <AuthLayout>
      <form onSubmit={submit} className="form" noValidate={false}>
        <div>
          <h1>Sign in</h1>
          <p className="lede">Review the security of your code, find by find.</p>
        </div>
        {notice && <div className="alert alert-info" role="status">{notice}</div>}
        {error && (
          <div className="alert alert-error" role="alert">
            <div className="grow">
              {error}
              {unreachable && <> You can still <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={demo}>Explore with sample data</button></>}
            </div>
          </div>
        )}
        <Field label="E-mail">
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy && <span className="spinner" aria-hidden="true" />}Sign in</button>
        <div className="auth-alt" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <Link to="/forgot-password">Forgot your password?</Link>
          <span>New here? <Link to="/register">Create an account</Link></span>
        </div>
        <div className="auth-alt">
          No account yet and just looking? <button type="button" className="btn btn-sm btn-ghost" style={{ padding: 0, color: "var(--accent)" }} onClick={demo}>Explore with sample data</button>
        </div>
      </form>
    </AuthLayout>
  );
}

export function Register() {
  const { user, signIn } = useSession();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = "Create account · Securicode"; }, []);
  if (user) return <Navigate to="/" replace />;

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError("Use at least 10 characters for your password.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await gateway.register(name.trim(), email.trim(), password);
      await signIn(email.trim(), password);
      nav("/", { replace: true, state: { welcome: true } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form onSubmit={submit} className="form">
        <div>
          <h1>Create an account</h1>
          <p className="lede">We'll send a link to confirm your e-mail before your first assessment.</p>
        </div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <Field label="Full name">
          <input className="input" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={255} />
        </Field>
        <Field label="E-mail">
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint="At least 10 characters. A short sentence is easy to remember and hard to guess.">
          <input className="input" type="password" autoComplete="new-password" required minLength={10} maxLength={128}
            aria-invalid={tooShort} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" hint={mismatch ? "The passwords don't match yet." : undefined}>
          <input className="input" type="password" autoComplete="new-password" required aria-invalid={mismatch}
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy && <span className="spinner" aria-hidden="true" />}Create account</button>
        <p className="xs muted">We store your name, e-mail address, a hash of your password, and a log of sign-ins and decisions, so you can use Securicode and so actions on findings are traceable. You can delete your account and this data at any time under Account.</p>
        <p className="auth-alt">Already have an account? <Link to="/signin">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = "Reset password · Securicode"; }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await gateway.requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      {sent ? (
        <div className="form">
          <h1>Check your e-mail</h1>
          <p className="lede">If an account exists for <b>{email}</b>, we've sent a link to choose a new password. It works once and expires after 30 minutes.</p>
          <Link className="btn btn-block" to="/signin">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="form">
          <div>
            <h1>Reset your password</h1>
            <p className="lede">Enter the e-mail you signed up with and we'll send you a reset link.</p>
          </div>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <Field label="E-mail">
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy && <span className="spinner" aria-hidden="true" />}Send reset link</button>
          <p className="auth-alt"><Link to="/signin">Back to sign in</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}
