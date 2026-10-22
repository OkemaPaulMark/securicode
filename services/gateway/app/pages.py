"""Server-rendered pages the gateway serves itself: VS Code sign-in (AUTH-4), password reset (AUTH-5),
e-mail verification result (AUTH-2) and the gateway home page.

They share the web app's visual language (apps/web/src/styles/tokens.css) but are self-contained: no external
fonts, scripts or stylesheets, so they render with a strict Content-Security-Policy and without JavaScript.
"""
from __future__ import annotations

import html

# One strict policy for every page here: no scripts at all, styles only from the inline <style> block.
CSP = ("default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self' vscode: vscode-insiders:; "
       "frame-ancestors 'none'; base-uri 'none'")
SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}

_LOGO = """<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0b6b57"/>
<path d="M12 9.5 7.5 16l4.5 6.5M20 9.5l4.5 6.5-4.5 6.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="m13 16.4 2.2 2.2 4-4.6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>"""

_ICONS = {
    "ok": '<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#e3f1ec"/>'
          '<path d="m12.5 20.5 5 5 10-11" fill="none" stroke="#0b6b57" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "error": '<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#fbe9e7"/>'
             '<path d="M20 11v11" stroke="#a61b1b" stroke-width="2.6" stroke-linecap="round"/><circle cx="20" cy="28" r="1.8" fill="#a61b1b"/></svg>',
    "vscode": '<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="10" fill="#e7eef7"/>'
              '<rect x="9" y="11" width="22" height="18" rx="2.5" fill="none" stroke="#2f5f96" stroke-width="2"/>'
              '<path d="m15 18-2.5 2.5L15 23m10-5 2.5 2.5L25 23m-3-6.5-4 8" fill="none" stroke="#2f5f96" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

_CSS = """
:root{--paper:#f3f5f4;--surface:#fff;--ink:#16201c;--ink2:#4a5752;--line:#d5dcd9;--line2:#b7c2be;--accent:#0b6b57;
--accent2:#095846;--on:#fff;--focus:#1d5fd6;--crit:#a61b1b;--critbg:#fbe9e7;--ok:#0b6b57;--okbg:#e3f1ec;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--paper:#0e1513;--surface:#151e1b;--ink:#e3eae7;--ink2:#a3b0ab;--line:#26332e;
--line2:#364640;--accent:#4cc2a2;--accent2:#6fd3b7;--on:#06231b;--focus:#7aa7ff;--crit:#ff8a80;--critbg:#3a1714;--okbg:#173129;color-scheme:dark}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--paper);color:var(--ink);
font:400 15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:420px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;letter-spacing:-.02em;margin:0 0 20px 4px;color:var(--ink);text-decoration:none}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:32px 28px}
.badge{margin-bottom:16px}
h1{font-size:26px;line-height:1.15;letter-spacing:-.025em;margin:0 0 8px}
.lede{color:var(--ink2);margin:0 0 24px}
p{margin:0 0 12px}
form{display:grid;gap:16px}
label{display:grid;gap:6px;font-weight:600;font-size:14px}
.hint{font-weight:400;color:var(--ink2);font-size:13px}
input{width:100%;min-height:42px;padding:8px 12px;border:1px solid var(--line2);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit}
input:focus{outline:2px solid var(--focus);outline-offset:0;border-color:transparent}
button,.btn{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:42px;padding:0 16px;border-radius:8px;
border:1px solid var(--accent);background:var(--accent);color:var(--on);font:600 14px/1 inherit;font-family:inherit;cursor:pointer;text-decoration:none}
button:hover,.btn:hover{background:var(--accent2);border-color:var(--accent2)}
.btn-quiet{background:transparent;color:var(--ink);border-color:var(--line2)}
.btn-quiet:hover{background:var(--paper);border-color:var(--line2)}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.alert{padding:12px 14px;border-radius:8px;font-size:14px;margin:0 0 16px;border:1px solid}
.err{background:var(--critbg);border-color:color-mix(in srgb,var(--crit) 35%,transparent);color:var(--ink)}
.foot{margin-top:20px;font-size:13px;color:var(--ink2);text-align:center}
.foot a,.card a{color:var(--accent)}
.meta{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:14px;margin:0 0 24px}
.meta dt{color:var(--ink2)}.meta dd{margin:0;font-weight:600;overflow-wrap:anywhere}
.links{display:grid;gap:10px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em}
"""


def e(value: object) -> str:
    return html.escape(str(value), quote=True)


def page(title: str, body: str, *, icon: str = "", lede: str = "", foot: str = "") -> str:
    badge = f'<div class="badge">{_ICONS[icon]}</div>' if icon else ""
    lede_html = f'<p class="lede">{lede}</p>' if lede else ""
    foot_html = f'<p class="foot">{foot}</p>' if foot else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark"><title>{e(title)} · Securicode</title><style>{_CSS}</style></head>
<body><main><div class="brand">{_LOGO}Securicode</div>
<div class="card">{badge}<h1>{e(title)}</h1>{lede_html}{body}</div>{foot_html}</main></body></html>"""


def error_box(message: str) -> str:
    return f'<div class="alert err" role="alert">{e(message)}</div>' if message else ""


def vscode_login(redirect_uri: str, state: str, error: str = "", email: str = "") -> str:
    body = f"""{error_box(error)}<form method="post" action="/auth/vscode">
<input type="hidden" name="redirect_uri" value="{e(redirect_uri)}"><input type="hidden" name="state" value="{e(state)}">
<label>E-mail<input type="email" name="email" value="{e(email)}" autocomplete="username" required autofocus></label>
<label>Password<input type="password" name="password" autocomplete="current-password" required></label>
<button type="submit">Sign in and return to VS Code</button></form>"""
    return page("Sign in to Securicode for VS Code", body, icon="vscode",
                lede="After you sign in, your browser hands VS Code a one-time code. Your password never reaches the editor.",
                foot="Only continue if you started this from the Securicode extension.")


def reset_form(token: str, error: str = "", min_length: int = 10) -> str:
    body = f"""{error_box(error)}<form method="post" action="/auth/reset-password">
<input type="hidden" name="token" value="{e(token)}">
<label>New password<input type="password" name="new_password" minlength="{min_length}" maxlength="128" autocomplete="new-password" required autofocus>
<span class="hint">At least {min_length} characters. A short sentence is easy to remember and hard to guess.</span></label>
<label>Repeat new password<input type="password" name="confirm" minlength="{min_length}" maxlength="128" autocomplete="new-password" required></label>
<button type="submit">Set new password</button></form>"""
    return page("Choose a new password", body, lede="This link works once and expires 30 minutes after it was sent.")


def result(title: str, message: str, *, ok: bool, action_url: str = "", action_label: str = "") -> str:
    action = f'<a class="btn" href="{e(action_url)}">{e(action_label)}</a>' if action_url else ""
    return page(title, f"<p>{e(message)}</p>{action}", icon="ok" if ok else "error")


def home(version: str, web_url: str) -> str:
    body = f"""<dl class="meta"><dt>Service</dt><dd>API Gateway and Identity</dd><dt>Version</dt><dd><code>{e(version)}</code></dd>
<dt>Status</dt><dd>Running</dd></dl>
<div class="links"><a class="btn" href="{e(web_url)}">Open Securicode</a>
<a class="btn btn-quiet" href="/docs">API reference</a></div>"""
    return page("Securicode gateway", body, lede="The single entry point for the web app, the VS Code extension and the platform services.")
