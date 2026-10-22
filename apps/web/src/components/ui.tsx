import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AssessmentState, Finding, Severity, SeverityCounts } from "../api/types";
import { SEVERITIES } from "../api/types";
import { DECISION_LABEL, SEVERITY_LABEL, STATE_LABEL, STATUS_LABEL, isActive, total } from "../lib/format";
import { IconClose, SeverityShape } from "./icons";

// ---------------------------------------------------------------- data loading
export interface Async<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (fn: (d: T | undefined) => T | undefined) => void;
}

/** Runs fn on mount and whenever deps change. Keeps the previous data while reloading (no flicker when polling). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [data, set] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const live = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (live.current) {
        set(d);
        setError(undefined);
      }
    } catch (e) {
      if (live.current) setError(e as Error);
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    reload();
    return () => {
      live.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, setData: (f) => set((d) => f(d)) };
}

/** Polls while `active` is true (CI-2). */
export function usePolling(cb: () => void, active: boolean, ms = 2000): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") ref.current();
    }, ms);
    return () => window.clearInterval(t);
  }, [active, ms]);
}

// ---------------------------------------------------------------- labels
export function SeverityBadge({ level }: { level: Severity }) {
  return (
    <span className={`sev sev-${level}`}>
      <SeverityShape level={level} />
      {SEVERITY_LABEL[level]}
    </span>
  );
}

export function StateChip({ state }: { state: AssessmentState }) {
  const cls = state === "completed" ? "chip-ok" : state === "failed" ? "chip-bad" : state === "cancelled" ? "" : "chip-info";
  return (
    <span className={`chip ${cls}`}>
      <span className={`dot ${isActive(state) ? "dot-pulse" : ""}`} aria-hidden="true" />
      {STATE_LABEL[state]}
    </span>
  );
}

export function StatusChip({ finding }: { finding: Finding }) {
  if (finding.decision) {
    const cls = finding.decision === "approved" ? "chip-ok" : finding.decision === "rejected" ? "chip-bad" : "";
    return <span className={`chip ${cls}`}>{DECISION_LABEL[finding.decision]}</span>;
  }
  const cls = finding.status === "needs_review" ? "chip-warn" : finding.status === "unvalidated" ? "chip-info" : "";
  return finding.status === "validated" ? null : <span className={`chip ${cls}`}>{STATUS_LABEL[finding.status]}</span>;
}

export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="confbar" title="How sure the AI agent is that this issue is real">
      <span className="track" aria-hidden="true"><span className="fill" style={{ width: `${pct}%` }} /></span>
      <span>{pct}%</span>
      <span className="sr-only"> confidence</span>
    </span>
  );
}

export function SeverityCountsView({ counts, compact = false }: { counts: SeverityCounts; compact?: boolean }) {
  const t = total(counts);
  if (!t) return <span className="muted small">No open findings</span>;
  return (
    <div className="counts">
      {SEVERITIES.filter((s) => counts[s] > 0 || !compact).map((s) => (
        <span key={s} className={`sev sev-${s}`} title={`${counts[s]} ${SEVERITY_LABEL[s]}`}>
          <SeverityShape level={s} />
          {counts[s]}
          <span className={compact ? "sr-only" : ""}> {SEVERITY_LABEL[s]}</span>
        </span>
      ))}
    </div>
  );
}

export function SeverityBar({ counts }: { counts: SeverityCounts }) {
  const t = total(counts) || 1;
  return (
    <div className="sevbar" role="img" aria-label={SEVERITIES.map((s) => `${counts[s]} ${SEVERITY_LABEL[s]}`).join(", ")}>
      <span className="c" style={{ width: `${(counts.critical / t) * 100}%` }} />
      <span className="h" style={{ width: `${(counts.high / t) * 100}%` }} />
      <span className="m" style={{ width: `${(counts.medium / t) * 100}%` }} />
      <span className="l" style={{ width: `${(counts.low / t) * 100}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- states
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}…
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="alert alert-error" role="alert">
      <div className="grow">
        <strong>That didn't load</strong>
        {error.message}
      </div>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- dialogs
export function Modal({ open, onClose, title, children, footer, wide = false }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);
  return (
    <dialog ref={ref} className={`modal ${wide ? "modal-wide" : ""}`} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <>
          <div className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** Confirmation for destructive or code-modifying actions (SRS 3.1). */
export function Confirm({ open, title, children, confirmLabel, danger = false, busy = false, onConfirm, onClose }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}{confirmLabel}
        </button>
      </>}>
      {children}
    </Modal>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
