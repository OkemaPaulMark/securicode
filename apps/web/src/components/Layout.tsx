import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { gateway, getMode, onFallbackChange, recheckServices, usingSampleData } from "../api";
import { applyTheme, readTheme, useCrumbs, useSession, useToast, type Theme } from "../lib/session";
import { initials } from "../lib/format";
import { helpFor } from "./help";
import {
  IconClose, IconFolder, IconHelp, IconHome, IconLogout, IconMenu, IconMoon, IconShield, IconSun, IconUser, Logo,
} from "./icons";

export function RequireAuth() {
  const { user, ready } = useSession();
  const loc = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/signin" replace state={{ from: loc.pathname + loc.search }} />;
  return <Shell />;
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  if (user?.role !== "admin") {
    return (
      <div className="empty">
        <h3>Administrators only</h3>
        <p>Your account doesn't have access to this page. Ask an administrator if you need it.</p>
        <Link className="btn" to="/">Go to your projects</Link>
      </div>
    );
  }
  return <>{children}</>;
}

function Shell() {
  const { user, signOut } = useSession();
  const crumbs = useCrumbs();
  const loc = useLocation();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [sample, setSample] = useState(usingSampleData());
  const [sending, setSending] = useState(false);

  useEffect(() => onFallbackChange(() => setSample(usingSampleData())), []);
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "?") { e.preventDefault(); setHelp((h) => !h); }
      if (e.key === "Escape") setHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleTheme = () => {
    const dark = theme === "dark" || (theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    const next: Theme = dark ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  const resend = async () => {
    setSending(true);
    try {
      await gateway.resendVerification();
      toast(`Verification link sent to ${user!.email}.`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

  const topic = helpFor(loc.pathname);
  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="sidebar" data-open={menu} aria-label="Main navigation">
        <Link to="/" className="brand"><Logo />Securicode</Link>
        <nav className="nav">
          <NavLink to="/" end><IconHome />Projects</NavLink>
          <NavLink to="/account"><IconUser />Account</NavLink>
          {user?.role === "admin" && (
            <>
              <div className="nav-group">Administration</div>
              <NavLink to="/admin" end><IconShield />Users</NavLink>
              <NavLink to="/admin/audit"><IconFolder />Audit log</NavLink>
              <NavLink to="/admin/system"><IconHome />System</NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <div className="me">
            <span className="avatar" aria-hidden="true">{initials(user!.name)}</span>
            <div>
              <div className="me-name">{user!.name}</div>
              <div className="me-mail" title={user!.email}>{user!.email}</div>
            </div>
          </div>
          <button className="btn btn-block" onClick={signOut}><IconLogout />Sign out</button>
        </div>
      </aside>
      {menu && <div className="scrim" onClick={() => setMenu(false)} aria-hidden="true" />}

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost icon-btn menu-btn" aria-label="Open menu" aria-expanded={menu} onClick={() => setMenu(true)}><IconMenu /></button>
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 && <span className="crumb-sep" aria-hidden="true">/</span>}
                {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>}
              </span>
            ))}
          </nav>
          <span className="spacer" />
          <button className="btn btn-ghost icon-btn" onClick={toggleTheme} aria-label={isDark ? "Use light theme" : "Use dark theme"} title={isDark ? "Light theme" : "Dark theme"}>
            {isDark ? <IconSun /> : <IconMoon />}
          </button>
          <button className="btn btn-ghost" onClick={() => setHelp(true)} aria-haspopup="dialog" title="Help (?)"><IconHelp />Help</button>
        </header>

        {sample && (
          <div className="banner" role="status">
            <span className="grow">
              {getMode() === "demo"
                ? <><b>Sample data.</b> You're exploring Securicode without an account. Changes reset when you reload.</>
                : <><b>Showing sample projects.</b> The gateway is up, but the Project, Scan and Reporting services aren't reachable yet, so these screens use sample data.</>}
            </span>
            {getMode() === "live" && <button className="btn btn-sm" onClick={() => { recheckServices(); window.location.reload(); }}>Check again</button>}
          </div>
        )}
        {user && !user.email_verified && getMode() === "live" && (
          <div className="banner banner-info" role="status">
            <span className="grow">Confirm your e-mail address to start assessments. We sent a link to <b>{user.email}</b>.</span>
            <button className="btn btn-sm" onClick={resend} disabled={sending}>Send a new link</button>
          </div>
        )}

        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      {help && (
        <aside className="drawer" role="dialog" aria-modal="false" aria-labelledby="help-title">
          <div className="drawer-head">
            <h2 id="help-title">{topic.title}</h2>
            <button className="btn btn-ghost icon-btn" onClick={() => setHelp(false)} aria-label="Close help"><IconClose /></button>
          </div>
          <div className="drawer-body">{topic.body}</div>
          <div className="drawer-foot small muted">
            Press <kbd>?</kbd> anywhere to open help. API reference: <a href="/docs" target="_blank" rel="noreferrer">/docs</a>
          </div>
        </aside>
      )}
    </div>
  );
}
