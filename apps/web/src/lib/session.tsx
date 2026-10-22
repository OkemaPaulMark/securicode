import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { gateway, getMode, setMode } from "../api";
import { getToken, onSessionEnded, setToken } from "../api/http";
import type { User } from "../api/types";
import { DEMO_TOKEN, resetDemo } from "../demo/store";

// ---------------------------------------------------------------- session
interface SessionValue {
  user: User | null;
  ready: boolean;
  /** shown once on the sign-in page, e.g. "You were signed out after 60 minutes of inactivity." */
  notice: string | null;
  clearNotice: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  startDemo: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionCtx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setUser(await gateway.me());
  }, []);

  useEffect(() => {
    const off = onSessionEnded((reason) => {
      setUser(null);
      setNotice(reason);
    });
    (async () => {
      if (getToken()) {
        try {
          await refresh();
        } catch {
          setToken(null);
        }
      }
      setReady(true);
    })();
    return () => {
      off();
    };
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    setMode("live");
    const t = await gateway.login(email, password);
    setToken(t.token);
    setNotice(null);
    await refresh();
  }, [refresh]);

  const startDemo = useCallback(async () => {
    setMode("demo");
    resetDemo();
    setToken(DEMO_TOKEN);
    setNotice(null);
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      if (getMode() === "live") await gateway.logout();
    } catch {
      /* already signed out on the server */
    }
    setToken(null);
    setMode("live");
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, ready, notice, clearNotice: () => setNotice(null), signIn, startDemo, signOut, refresh }),
    [user, ready, notice, signIn, startDemo, signOut, refresh],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionCtx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

// ---------------------------------------------------------------- toasts
interface Toast { id: number; text: string; kind: "ok" | "error" }
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { id, text, kind }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            <span className="grow">{t.text}</span>
            <button onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- page title + breadcrumbs
export interface Crumb { label: string; to?: string }
interface PageMeta { crumbs: Crumb[]; setCrumbs: (c: Crumb[]) => void }
const PageCtx = createContext<PageMeta>({ crumbs: [], setCrumbs: () => {} });

export function PageProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  return <PageCtx.Provider value={{ crumbs, setCrumbs }}>{children}</PageCtx.Provider>;
}

export function usePage(title: string, crumbs: Crumb[] = []) {
  const { setCrumbs } = useContext(PageCtx);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    document.title = title ? `${title} · Securicode` : "Securicode";
    setCrumbs(crumbs.length ? crumbs : [{ label: title }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, key]);
}

export const useCrumbs = () => useContext(PageCtx).crumbs;

// ---------------------------------------------------------------- theme
export type Theme = "system" | "light" | "dark";
const THEME_KEY = "securicode.theme";

export function readTheme(): Theme {
  try {
    const t = window.localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(t: Theme) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try {
    if (t === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore */
  }
}
