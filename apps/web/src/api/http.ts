/**
 * The web app's only path to the network. Everything goes to the same origin; nginx (production) or the Vite dev
 * server (development) forwards /api and /auth to the API Gateway. The token is sent as a bearer header and kept
 * in sessionStorage, so it is gone when the tab closes (SEC-3).
 */

const TOKEN_KEY = "securicode.token";

export class ApiError extends Error {
  readonly status: number;
  /** true when the gateway could not reach (or has no address for) the backend service. */
  readonly serviceMissing: boolean;

  constructor(status: number, message: string, serviceMissing = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.serviceMissing = serviceMissing;
  }
}

let memoryToken: string | null = null;
const listeners = new Set<(reason: string) => void>();

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = storage()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

export function setToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) storage()?.setItem(TOKEN_KEY, token);
    else storage()?.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: keep it in memory only */
  }
}

/** Called when the gateway rejects the token (expired, idle for 60 minutes, revoked, account deactivated). */
export function onSessionEnded(fn: (reason: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Turns FastAPI error bodies into one readable sentence; never shows stack traces or internals (SRS 3.1). */
export function messageFrom(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(d.loc) ? String(d.loc[d.loc.length - 1]) : "";
        const msg = (d.msg ?? "is invalid").replace(/^Value error, /, "");
        return field && field !== "body" ? `${field.replace(/_/g, " ")}: ${msg}` : msg;
      })
      .join(". ");
  }
  if (status === 413) return "That upload is too large. The limit is 100 MB.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "The server could not complete the request. Try again in a moment.";
  return `Request failed (${status}).`;
}

function isServiceMissing(status: number, message: string): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  return status === 404 && message.startsWith("No service handles");
}

export interface RequestOptions {
  method?: string;
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  auth?: boolean;
  /** return the raw Response (downloads) */
  raw?: boolean;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  const token = getToken();
  if (opts.auth !== false && token) headers.set("Authorization", `Bearer ${token}`);

  let url = path;
  if (opts.query) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) if (v !== undefined && v !== "") q.set(k, String(v));
    const s = q.toString();
    if (s) url += (url.includes("?") ? "&" : "?") + s;
  }

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? "GET", headers, body, signal: opts.signal, credentials: "omit" });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "Securicode could not be reached. Check your connection and try again.", true);
  }

  if (res.status === 401 && opts.auth !== false && token) {
    let reason = "Your session has ended. Sign in again to continue.";
    try {
      const b = await res.clone().json();
      if (b?.detail === "Session expired due to inactivity") reason = "You were signed out after 60 minutes of inactivity.";
    } catch {
      /* ignore */
    }
    setToken(null);
    listeners.forEach((fn) => fn(reason));
    throw new ApiError(401, reason);
  }

  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      /* non-JSON error */
    }
    const message = messageFrom(res.status, parsed);
    throw new ApiError(res.status, message, isServiceMissing(res.status, message));
  }

  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? await res.json() : await res.text()) as T;
}
