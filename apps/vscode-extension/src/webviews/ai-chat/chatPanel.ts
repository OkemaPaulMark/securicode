/**
 * The AI Security Agent chat (brief Sheet 8/9) — the flagship screen. A
 * WebviewPanel rather than a sidebar view because a chat needs real
 * horizontal room (brief Sheet 23), the same reasoning VS Code's own Chat
 * view uses.
 *
 * The real AI agent now lives outside Django entirely — a standalone
 * FastAPI service at ../../../AI_agent (POST /chat, POST /agent/review) —
 * so `/api/ai/ask/` doesn't exist on the Django API at all any more. This
 * panel is wired to try it first anyway and fall back to a scripted local
 * demo that reuses the sample finding data — clearly labeled in the UI,
 * never presented as a live model response. Once Django gateways to (or
 * this extension calls directly) AI_agent's endpoints, replacing
 * `demoReply()` with a real response is the only change needed.
 */
import * as vscode from "vscode";

import { api } from "../../api-client/client";
import { ChatActivityStep, ChatMessage, Finding } from "../../api-client/types";
import { securityState } from "../../state/securityState";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `msg-${idCounter}`;
}

export class ChatPanel {
  private static current: ChatPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private liveBackend = false;

  static show(context: vscode.ExtensionContext, findingId?: string) {
    if (ChatPanel.current) {
      ChatPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      if (findingId) ChatPanel.current.seedForFinding(findingId);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "securecode.aiChat",
      "SecureCode Security Agent",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    ChatPanel.current = new ChatPanel(panel, context, findingId);
  }

  private constructor(panel: vscode.WebviewPanel, _context: vscode.ExtensionContext, findingId?: string) {
    this.panel = panel;
    this.panel.webview.html = shellHtml();
    this.panel.onDidDispose(() => (ChatPanel.current = undefined));

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === "ask") {
        await this.handleQuestion(message.text as string, message.findingId as string | undefined);
      } else if (message.command === "openFile") {
        await vscode.commands.executeCommand("securecode.openFindingLocation", message.findingId);
      } else if (message.command === "viewFinding") {
        await vscode.commands.executeCommand("securecode.openFinding", message.findingId);
      } else if (message.command === "suggestFix") {
        await vscode.commands.executeCommand("securecode.suggestFix", message.findingId);
      }
    });

    if (findingId) {
      // Give the webview a tick to finish mounting before we post to it.
      setTimeout(() => this.seedForFinding(findingId), 50);
    }
  }

  private post(message: unknown) {
    this.panel.webview.postMessage(message);
  }

  private async seedForFinding(findingId: string) {
    const finding = securityState.findFinding(findingId);
    if (!finding) return;

    this.post({ type: "setContext", project: workspaceName(), findingId });
    await this.streamActivity(investigationSteps(finding));

    const message: ChatMessage = {
      id: nextId(),
      role: "agent",
      text:
        `I found a potential **${finding.title}** vulnerability in:\n\n` +
        `${finding.file}:${finding.line}\n\n` +
        `${finding.aiAnalysis ?? finding.description}\n\n` +
        `Confidence: ${finding.confidence}%`,
      referencedFinding: finding.id,
      referencedFile: finding.file,
      confidence: finding.confidence,
      timestamp: Date.now(),
    };
    this.post({ type: "agentMessage", message, suggestedQuestions: suggestedQuestionsFor(finding) });
  }

  private async handleQuestion(text: string, findingId: string | undefined) {
    const finding = findingId ? securityState.findFinding(findingId) : undefined;

    // Try the real endpoint first; the app doesn't implement it yet, so
    // this will normally throw and we fall through to the local demo.
    try {
      const result = await api.askAgent(text, { findingId });
      this.liveBackend = true;
      this.post({
        type: "agentMessage",
        message: { id: nextId(), role: "agent", text: result.answer, timestamp: Date.now() },
      });
      return;
    } catch {
      this.liveBackend = false;
    }

    await this.streamActivity(followUpSteps(text));
    const reply = demoReply(text, finding);
    this.post({ type: "agentMessage", message: reply });
  }

  private async streamActivity(steps: ChatActivityStep[]) {
    for (let i = 0; i < steps.length; i++) {
      const snapshot = steps.map((s, idx) => ({ ...s, done: idx < i }));
      this.post({ type: "activity", steps: snapshot });
      await delay(450);
    }
    this.post({ type: "activity", steps: steps.map((s) => ({ ...s, done: true })) });
    await delay(200);
    this.post({ type: "activityDone" });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function workspaceName(): string {
  return vscode.workspace.workspaceFolders?.[0]?.name ?? "this project";
}

function investigationSteps(finding: Finding): ChatActivityStep[] {
  return [
    { label: `Read ${finding.file}`, done: false },
    { label: "Traced request/data flow", done: false },
    { label: `Retrieved ${finding.owaspCategory ?? "security"} guidance`, done: false },
    { label: "Correlating with existing findings", done: false },
  ];
}

function followUpSteps(question: string): ChatActivityStep[] {
  const q = question.toLowerCase();
  if (q.includes("exploit")) {
    return [
      { label: "Re-reading vulnerable code path", done: false },
      { label: "Checking authentication requirements", done: false },
      { label: "Assessing exploitability", done: false },
    ];
  }
  if (q.includes("fix") || q.includes("remediat")) {
    return [
      { label: "Retrieving secure coding guidance", done: false },
      { label: "Drafting remediation", done: false },
    ];
  }
  return [{ label: "Analyzing question", done: false }, { label: "Searching project context", done: false }];
}

function suggestedQuestionsFor(finding: Finding): string[] {
  const questions = ["Is this definitely exploitable?", "How can I fix this safely?"];
  if (finding.cve) questions.push(`Is ${finding.cve} actually relevant here?`);
  return questions;
}

function demoReply(question: string, finding: Finding | undefined): ChatMessage {
  const q = question.toLowerCase();
  const base: Omit<ChatMessage, "text"> = {
    id: nextId(),
    role: "agent",
    referencedFinding: finding?.id,
    referencedFile: finding?.file,
    timestamp: Date.now(),
  };

  if (!finding) {
    return {
      ...base,
      text: "I can answer questions scoped to a specific finding — open one from the Findings view and ask me from there, or select code and choose \"Ask Security Agent\".",
    };
  }

  if (q.includes("exploit")) {
    return { ...base, text: finding.impact ?? "I don't have enough evidence yet to assess exploitability with confidence." };
  }
  if (q.includes("fix") || q.includes("remediat")) {
    return {
      ...base,
      text: finding.remediation ?? "No remediation guidance is available for this finding yet.",
    };
  }
  if (finding.cve && q.includes(finding.cve.toLowerCase())) {
    return { ...base, text: `${finding.cve} — ${finding.description}` };
  }
  return {
    ...base,
    text: `Here's what static analysis found: ${finding.description} I don't have a live model connected yet, so I can only answer from the recorded finding — ask about exploitability or remediation.`,
  };
}

function shellHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" />${styles()}</head>
<body>
  <div class="header">
    <span class="shield">🛡</span>
    <div>
      <div class="title">SecureCode Security Agent</div>
      <div class="subtitle"><span id="project">—</span> · <span id="status">Ready</span></div>
    </div>
  </div>
  <div class="demo-banner" id="demoBanner">Demo mode — showing scripted responses from the last scan until the backend AI agent is connected.</div>

  <div class="messages" id="messages"></div>

  <div class="suggestions" id="suggestions"></div>

  <div class="composer">
    <input id="input" type="text" placeholder="Ask the security agent…" />
    <button id="send">➤</button>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const suggestionsEl = document.getElementById('suggestions');
  const statusEl = document.getElementById('status');
  const projectEl = document.getElementById('project');
  const input = document.getElementById('input');
  let currentFindingId = undefined;
  let activityEl = null;

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderText(text) {
    return escapeHtml(text)
      .replace(/\\n/g, '<br/>')
      .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
  }

  function addMessage(message) {
    const row = document.createElement('div');
    row.className = 'msg ' + message.role;
    let actions = '';
    if (message.role === 'agent' && message.referencedFinding) {
      actions = '<div class="msg-actions">' +
        '<button data-act="viewCode" data-finding="' + message.referencedFinding + '">View Code</button>' +
        '<button data-act="viewFinding" data-finding="' + message.referencedFinding + '">View Finding</button>' +
        '</div>';
    }
    const conf = message.confidence !== undefined ? '<div class="confidence">Confidence: ' + message.confidence + '%</div>' : '';
    row.innerHTML =
      '<div class="msg-role">' + (message.role === 'agent' ? '🤖 Agent' : 'You') + '</div>' +
      '<div class="msg-text">' + renderText(message.text) + '</div>' +
      conf + actions;
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    row.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-act');
        const findingId = btn.getAttribute('data-finding');
        if (act === 'viewCode') vscode.postMessage({ command: 'openFile', findingId });
        if (act === 'viewFinding') vscode.postMessage({ command: 'viewFinding', findingId });
      });
    });
  }

  function renderActivity(steps) {
    if (!activityEl) {
      activityEl = document.createElement('div');
      activityEl.className = 'msg agent activity';
      messagesEl.appendChild(activityEl);
    }
    const lines = steps.map((s) => (s.done ? '✓ ' : '◉ ') + s.label).join('<br/>');
    activityEl.innerHTML = '<div class="msg-role">🤖 Agent</div><div class="msg-text activity-text">' + lines + '</div>';
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderSuggestions(list) {
    suggestionsEl.innerHTML = '';
    (list || []).forEach((q) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = q;
      chip.addEventListener('click', () => sendQuestion(q));
      suggestionsEl.appendChild(chip);
    });
  }

  function sendQuestion(text) {
    if (!text) return;
    addMessage({ role: 'user', text });
    statusEl.textContent = 'Investigating…';
    renderSuggestions([]);
    vscode.postMessage({ command: 'ask', text, findingId: currentFindingId });
    input.value = '';
  }

  document.getElementById('send').addEventListener('click', () => sendQuestion(input.value.trim()));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendQuestion(input.value.trim()); });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'setContext') {
      projectEl.textContent = msg.project;
      currentFindingId = msg.findingId;
      statusEl.textContent = 'Investigating…';
    } else if (msg.type === 'activity') {
      renderActivity(msg.steps);
    } else if (msg.type === 'activityDone') {
      activityEl = null;
      statusEl.textContent = 'Ready';
    } else if (msg.type === 'agentMessage') {
      addMessage(msg.message);
      renderSuggestions(msg.suggestedQuestions);
      statusEl.textContent = 'Ready';
    }
  });
</script>
</body></html>`;
}

function styles(): string {
  return `<style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; display: flex; flex-direction: column; height: 100vh; }
    .header { display: flex; gap: 10px; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--vscode-widget-border); }
    .shield { font-size: 20px; }
    .title { font-weight: 600; font-size: 13px; }
    .subtitle { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .demo-banner { font-size: 11px; padding: 6px 18px; background: var(--vscode-textBlockQuote-background); color: var(--vscode-descriptionForeground); }
    .messages { flex: 1; overflow-y: auto; padding: 12px 18px; display: flex; flex-direction: column; gap: 14px; }
    .msg { max-width: 88%; }
    .msg.user { align-self: flex-end; text-align: right; }
    .msg.agent { align-self: flex-start; }
    .msg-role { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    .msg-text {
      font-size: 13px; line-height: 1.55; padding: 10px 12px; border-radius: 8px;
      background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border);
      display: inline-block; text-align: left;
    }
    .msg.user .msg-text { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
    .msg.activity .msg-text { font-family: var(--vscode-editor-font-family); font-size: 12px; color: var(--vscode-descriptionForeground); }
    .confidence { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .msg-actions { margin-top: 6px; display: flex; gap: 6px; }
    .msg-actions button {
      font-size: 11px; padding: 3px 9px; border-radius: 3px; border: 1px solid var(--vscode-widget-border);
      background: transparent; color: var(--vscode-foreground); cursor: pointer;
    }
    .msg-actions button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .suggestions { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 18px 10px; }
    .chip {
      font-size: 11.5px; padding: 5px 11px; border-radius: 14px; border: 1px solid var(--vscode-widget-border);
      background: var(--vscode-editorWidget-background); color: var(--vscode-foreground); cursor: pointer;
    }
    .chip:hover { background: var(--vscode-toolbar-hoverBackground); }
    .composer { display: flex; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--vscode-widget-border); }
    #input {
      flex: 1; padding: 8px 10px; border-radius: 4px; border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: inherit; font-size: 13px;
    }
    #send {
      padding: 0 16px; border-radius: 4px; border: none; cursor: pointer;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    }
    #send:hover { background: var(--vscode-button-hoverBackground); }
  </style>`;
}
