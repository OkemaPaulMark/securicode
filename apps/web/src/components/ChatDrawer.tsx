import { useEffect, useRef, useState, type FormEvent } from "react";
import { platform } from "../api";
import type { ChatMessage, Finding } from "../api/types";
import { IconClose } from "./icons";

const SUGGESTIONS_FINDING = ["Why is this rated this severity?", "How sure are you that this is real?", "How do I test it safely?", "How do I fix it?"];
const SUGGESTIONS_GENERAL = ["Which finding should I fix first?", "What is a false positive?"];

/** Conversational assistant (CHAT-1..CHAT-5). It explains; changes only happen through approved fixes. */
export function ChatDrawer({ assessmentId, finding, onClose }: { assessmentId: string; finding?: Finding; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    platform.chatHistory(assessmentId).then(setMessages).catch(() => setMessages([]));
    input.current?.focus();
  }, [assessmentId]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages, busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setText("");
    setError(null);
    setBusy(true);
    const mine: ChatMessage = { id: `local-${Date.now()}`, role: "user", text: question, at: new Date().toISOString() };
    setMessages((m) => [...m, mine]);
    try {
      const reply = await platform.ask(assessmentId, question, finding?.id);
      setMessages((m) => [...m, reply]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); send(text); };

  return (
    <aside className="drawer" role="dialog" aria-modal="false" aria-labelledby="chat-title">
      <div className="drawer-head">
        <div>
          <h2 id="chat-title">Ask about {finding ? finding.id : "this assessment"}</h2>
          {finding && <p className="xs muted">{finding.title}</p>}
        </div>
        <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close assistant"><IconClose /></button>
      </div>
      <div className="drawer-body">
        <div className="chat" aria-live="polite">
          {messages.length === 0 && (
            <p className="small muted">Answers use this project's code, the finding's evidence and the OWASP and CWE references. The assistant explains; it can't change your files.</p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`msg msg-${m.role}`}>
              <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
              {m.text}
              {m.sources && m.sources.length > 0 && (
                <div className="msg-sources">Sources: {m.sources.map((s, i) => (
                  <span key={i}>{i > 0 && ", "}{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</span>
                ))}</div>
              )}
            </div>
          ))}
          {busy && <div className="msg msg-assistant" aria-label="Assistant is writing"><span className="spinner" aria-hidden="true" /></div>}
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div ref={end} />
        </div>
        {messages.length === 0 && (
          <div className="suggest">
            {(finding ? SUGGESTIONS_FINDING : SUGGESTIONS_GENERAL).map((s) => (
              <button key={s} className="btn btn-sm" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
      </div>
      <form className="drawer-foot chat-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-input">Your question</label>
        <textarea id="chat-input" ref={input} className="textarea" style={{ minHeight: 44 }} rows={1} value={text}
          placeholder="Ask a question" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </aside>
  );
}
