"""Gateway tests, grouped by SRS requirement."""
import re
import time
import uuid
from datetime import timedelta

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.db import ApiSession, GitToken, User, utcnow
from app.main import create_app
from app.security import hash_password, verify_password

SECRET = "x" * 40
ISS = "securicode-gateway"
KEY = "k" * 24
PW = "Correct-Horse-9"
captured: list = []


def backends(request: httpx.Request) -> httpx.Response:
    host = request.url.host
    if host == "down.local":
        raise httpx.ConnectError("refused", request=request)
    if host == "api.github.com":
        ok = request.headers.get("authorization") == "Bearer ghp_validtoken123"
        return httpx.Response(200 if ok else 401, json={})
    if host == "gitlab.cranecloud.io":
        return httpx.Response(200 if request.headers.get("private-token") == "glpat-valid-1234" else 401, json={})
    captured.append(request)
    if host == "project.local" and request.url.path == "/api/projects/":   # FastAPI-style slash redirect
        return httpx.Response(307, headers={"location": "http://project.local/api/projects"})
    if request.method == "DELETE" and "/internal/users/" in request.url.path:
        return httpx.Response(204)
    return httpx.Response(201 if request.method == "POST" else 200,
                          json={"path": request.url.path, "query": request.url.query.decode()})


@pytest.fixture
def app_client(tmp_path):
    captured.clear()
    settings = Settings(
        app_env="test", jwt_secret=SECRET, database_url=f"sqlite:///{tmp_path}/t.db",
        admin_email="admin@securicode.io", admin_password="Admin-Pass-123", internal_api_key=KEY,
        git_token_key="ab" * 32, public_base_url="http://gw", daily_assessment_limit=2, cors_origins=["*"],
        service_urls={"project": "http://project.local", "scan": "http://scan.local", "ai": "",
                      "reporting": "http://down.local"})
    app = create_app(settings, transport=httpx.MockTransport(backends))
    with TestClient(app) as c:
        yield app, c


@pytest.fixture
def client(app_client):
    return app_client[1]


def last_link_token(app, kind: str) -> str:
    mail = [m for m in app.state.outbox if kind in m["body"]][-1]
    return re.search(r"token=([\w-]+)", mail["body"]).group(1)


def register(c, email="dev@test.io", password=PW, name="Dev User"):
    r = c.post("/api/auth/register/", json={"name": name, "email": email, "password": password})
    assert r.status_code == 201, r.text
    return r.json()


def login(c, email="dev@test.io", password=PW, **extra):
    r = c.post("/api/auth/login/", json={"email": email, "password": password, **extra})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def verified_user(app, c, email="dev@test.io"):
    register(c, email)
    assert c.get("/api/auth/verify-email/", params={"token": last_link_token(app, "verify-email")}).status_code == 200
    return login(c, email)


def admin(c):
    return login(c, "admin@securicode.io", "Admin-Pass-123")


def db(app):
    return app.state.sessionmaker()


# ---------------------------------------------------------------- ops
def test_health_ready_and_openapi(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/ready").json()["status"] == "ready"
    assert client.get("/openapi.json").json()["openapi"].startswith("3.")


# ---------------------------------------------------------------- AUTH-1, SEC-1
def test_register_validation_and_argon2id(app_client):
    app, c = app_client
    short = {"name": "A", "email": "a@test.io", "password": "short-9"}
    assert c.post("/api/auth/register/", json=short).status_code == 422          # < 10 chars
    assert c.post("/api/auth/register/", json={**short, "email": "bad", "password": PW}).status_code == 422
    user = register(c)
    assert user["role"] == "user" and user["email_verified"] is False and "password_hash" not in user
    assert c.post("/api/auth/register/", json={"name": "B", "email": "DEV@test.io", "password": PW}).status_code == 409
    stored = db(app).scalar(select(User).where(User.email == "dev@test.io")).password_hash
    assert stored.startswith("$argon2id$")
    assert verify_password(PW, stored) and not verify_password("wrong", stored)
    assert not verify_password("x", "not-a-hash")


# ---------------------------------------------------------------- AUTH-2
def test_email_verification(app_client):
    app, c = app_client
    register(c)
    token = last_link_token(app, "verify-email")
    assert app.state.outbox[-1]["to"] == "dev@test.io"
    assert c.get("/api/auth/verify-email/", params={"token": token}).status_code == 200
    assert c.get("/api/auth/verify-email/", params={"token": token}).status_code == 400   # single use
    assert c.get("/api/auth/me/", headers=login(c)).json()["email_verified"] is True


# ---------------------------------------------------------------- AUTH-3, SEC-2
def test_login_generic_error_and_vscode_contract(client):
    register(client)
    for creds in ({"email": "dev@test.io", "password": "Wrong-pass-1"}, {"email": "no@test.io", "password": PW}):
        r = client.post("/api/auth/login/", json=creds)
        assert r.status_code == 401 and r.json()["detail"] == "Invalid e-mail or password"
    # apps/vscode-extension/src/api-client/client.ts sends {username, password, name, scope}
    r = client.post("/api/auth/login/", json={"username": "dev@test.io", "password": PW,
                                               "name": "VS Code", "scope": "vscode"})
    body = r.json()
    assert r.status_code == 200 and body["name"] == "VS Code" and body["scope"] == "vscode" and body["id"]
    assert jwt.decode(body["token"], SECRET, algorithms=["HS256"], issuer=ISS)["jti"] == body["id"]


def test_lockout_after_five_failures(app_client):
    app, c = app_client
    register(c)
    for _ in range(5):
        assert c.post("/api/auth/login/", json={"email": "dev@test.io", "password": "Wrong-pass-1"}).status_code == 401
    assert c.post("/api/auth/login/", json={"email": "dev@test.io", "password": PW}).status_code == 429
    with db(app) as s:
        user = s.scalar(select(User).where(User.email == "dev@test.io"))
        assert (user.locked_until - utcnow()) > timedelta(minutes=14)
        user.locked_until = utcnow() - timedelta(seconds=1)
        s.commit()
    login(c)


# ---------------------------------------------------------------- SEC-3
def test_token_validation(client):
    assert client.get("/api/auth/me/").status_code == 401
    assert client.get("/api/auth/me/", headers={"Authorization": "Bearer not.a.jwt"}).status_code == 401
    base = {"sub": "x", "iss": ISS, "jti": str(uuid.uuid4())}
    expired = jwt.encode({**base, "exp": int(time.time()) - 10}, SECRET, "HS256")
    r = client.get("/api/auth/me/", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401 and r.json()["detail"] == "Token expired"
    forged = jwt.encode({**base, "exp": int(time.time()) + 60}, "other" * 10, "HS256")
    assert client.get("/api/auth/me/", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    unknown_session = jwt.encode({**base, "exp": int(time.time()) + 60}, SECRET, "HS256")
    assert client.get("/api/auth/me/", headers={"Authorization": f"Bearer {unknown_session}"}).status_code == 401


def test_session_expires_after_60_minutes_inactivity(app_client):
    app, c = app_client
    register(c)
    auth = login(c)
    assert c.get("/api/auth/me/", headers=auth).status_code == 200
    with db(app) as s:
        for sess in s.scalars(select(ApiSession)):
            sess.last_seen_at = utcnow() - timedelta(minutes=61)
        s.commit()
    r = c.get("/api/auth/me/", headers=auth)
    assert r.status_code == 401 and "inactivity" in r.json()["detail"]


def test_logout_revokes(client):
    register(client)
    auth = login(client)
    assert client.post("/api/auth/logout/", headers=auth).status_code == 204
    assert client.get("/api/auth/me/", headers=auth).json()["detail"] == "Session revoked"


# ---------------------------------------------------------------- AUTH-5
def test_password_reset(app_client):
    app, c = app_client
    register(c)
    old_session = login(c)
    n = len(app.state.outbox)
    assert c.post("/api/auth/password-reset/", json={"email": "nobody@test.io"}).status_code == 202
    assert len(app.state.outbox) == n                       # no mail, same response: no account enumeration
    assert c.post("/api/auth/password-reset/", json={"email": "dev@test.io"}).status_code == 202
    token = last_link_token(app, "reset-password")
    assert c.get("/auth/reset-password", params={"token": token}).status_code == 200
    weak = {"token": token, "new_password": "short"}
    assert c.post("/api/auth/password-reset/confirm/", json=weak).status_code == 422
    assert c.post("/api/auth/password-reset/confirm/",
                  json={"token": token, "new_password": "Brand-New-Pass-7"}).status_code == 204
    assert c.post("/api/auth/password-reset/confirm/",
                  json={"token": token, "new_password": "Another-Pass-77"}).status_code == 400   # single use
    assert c.get("/api/auth/me/", headers=old_session).status_code == 401                     # sessions revoked
    assert c.post("/api/auth/login/", json={"email": "dev@test.io", "password": PW}).status_code == 401
    login(c, password="Brand-New-Pass-7")


def test_reset_link_expires_after_30_minutes(app_client):
    app, c = app_client
    register(c)
    c.post("/api/auth/password-reset/", json={"email": "dev@test.io"})
    token = last_link_token(app, "reset-password")
    from app.db import OneTimeToken
    from app.security import sha256
    with db(app) as s:
        s.get(OneTimeToken, sha256(token)).expires_at = utcnow() - timedelta(seconds=1)
        s.commit()
    r = c.post("/api/auth/password-reset/confirm/", json={"token": token, "new_password": "Brand-New-Pass-7"})
    assert r.status_code == 400


# ---------------------------------------------------------------- AUTH-4
def test_vscode_browser_sign_in(client):
    register(client)
    assert client.get("/auth/vscode", params={"redirect_uri": "https://evil.example/cb"}).status_code == 400
    ok_uri = "vscode://securicode.securecode/auth"
    page = client.get("/auth/vscode", params={"redirect_uri": ok_uri, "state": "s1"})
    assert page.status_code == 200 and "Sign in" in page.text
    bad = client.post("/auth/vscode", data={"email": "dev@test.io", "password": "nope-nope-1",
                                            "redirect_uri": ok_uri, "state": "s1"})
    assert bad.status_code == 401 and "Invalid e-mail or password" in bad.text
    r = client.post("/auth/vscode", data={"email": "dev@test.io", "password": PW, "redirect_uri": ok_uri,
                                          "state": "s1"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith(ok_uri + "?code=")
    assert "state=s1" in r.headers["location"]
    code = re.search(r"code=([\w-]+)", r.headers["location"]).group(1)
    issued = client.post("/api/auth/vscode/exchange/", json={"code": code})
    assert issued.status_code == 200 and issued.json()["scope"] == "vscode"
    assert client.post("/api/auth/vscode/exchange/", json={"code": code}).status_code == 400   # single use


# ---------------------------------------------------------------- AUTH-6, SEC-5
def test_git_tokens_encrypted_masked_and_internal_fetch(app_client):
    app, c = app_client
    register(c)
    auth = login(c)
    bad = c.post("/api/auth/git-tokens/", headers=auth, json={"provider": "github", "token": "ghp_wrongtoken"})
    assert bad.status_code == 400
    r = c.post("/api/auth/git-tokens/", headers=auth,
               json={"provider": "github", "token": "ghp_validtoken123", "label": "personal"})
    assert r.status_code == 201 and r.json()["masked"] == "****n123"
    gl = c.post("/api/auth/git-tokens/", headers=auth,
                json={"provider": "gitlab", "token": "glpat-valid-1234", "host": "gitlab.cranecloud.io"})
    assert gl.status_code == 201 and gl.json()["host"] == "gitlab.cranecloud.io"
    listed = c.get("/api/auth/git-tokens/", headers=auth).json()
    assert len(listed) == 2 and "ghp_validtoken123" not in str(listed)
    with db(app) as s:
        row = s.get(GitToken, r.json()["id"])
        assert "ghp_validtoken123" not in row.ciphertext
        owner = row.user_id
    url = f"/internal/git-tokens/{r.json()['id']}/"
    assert c.get(url, headers={"X-Internal-Key": "wrong", "X-User-Id": owner}).status_code == 401
    assert c.get(url, headers={"X-Internal-Key": KEY, "X-User-Id": "someone-else"}).status_code == 404
    got = c.get(url, headers={"X-Internal-Key": KEY, "X-User-Id": owner}).json()
    assert got == {"provider": "github", "host": "github.com", "token": "ghp_validtoken123"}
    assert c.delete(f"/api/auth/git-tokens/{r.json()['id']}/", headers=auth).status_code == 204
    assert len(c.get("/api/auth/git-tokens/", headers=auth).json()) == 1


# ---------------------------------------------------------------- routing
def test_proxy_forwards_and_protects_identity_headers(app_client):
    app, c = app_client
    auth = verified_user(app, c)
    me = c.get("/api/auth/me/", headers=auth).json()
    r = c.get("/api/scans/42/findings/?severity=high",
              headers={**auth, "X-User-Role": "admin", "X-Internal-Key": "forged"})
    assert r.status_code == 200 and r.json() == {"path": "/api/scans/42/findings/", "query": "severity=high"}
    sent = captured[-1]
    assert sent.url.host == "scan.local"
    assert sent.headers["x-user-id"] == me["id"] and sent.headers["x-user-role"] == "user"
    assert sent.headers["x-user-verified"] == "true" and sent.headers["x-internal-key"] == KEY
    assert "authorization" not in sent.headers
    assert r.headers["x-request-id"] == sent.headers["x-request-id"]
    c.get("/api/assessments/57/findings/", headers=auth)
    assert captured[-1].url.host == "project.local"


def test_proxy_errors(app_client):
    app, c = app_client
    auth = verified_user(app, c)
    assert c.get("/api/scans/1/").status_code == 401
    assert c.get("/api/unknown/x/", headers=auth).status_code == 404
    assert c.post("/api/ai/ask/", headers=auth, json={}).status_code == 503
    assert c.get("/api/reports/1/", headers=auth).status_code == 502


# ---------------------------------------------------------------- AUTH-2 enforcement, BR-5
def test_assessment_needs_verified_email_and_daily_limit(app_client):
    app, c = app_client
    register(c, "unverified@test.io")
    r = c.post("/api/assessments/", headers=login(c, "unverified@test.io"), json={"project": "p1"})
    assert r.status_code == 403 and "Verify" in r.json()["detail"]

    auth = verified_user(app, c)
    assert c.post("/api/assessments/", headers=auth, json={}).status_code == 201
    assert c.post("/api/projects/p1/scans/", headers=auth, json={}).status_code == 201
    assert c.get("/api/assessments/", headers=auth).status_code == 200            # reads are not counted
    r = c.post("/api/assessments/", headers=auth, json={})
    assert r.status_code == 429 and "Daily limit of 2" in r.json()["detail"]

    adm = admin(c)
    for _ in range(3):                                                              # administrators exempt
        assert c.post("/api/assessments/", headers=adm, json={}).status_code == 201
    assert c.put("/api/admin/settings/", headers=adm, json={"daily_assessment_limit": 5}).status_code == 200
    assert c.post("/api/assessments/", headers=auth, json={}).status_code == 201


# ---------------------------------------------------------------- AUTH-7, AUTH-8, AUDT-1..4, BR-3
def test_admin_functions(app_client):
    app, c = app_client
    register(c)
    user_auth = login(c)
    c.post("/api/auth/login/", json={"email": "dev@test.io", "password": "Wrong-pass-1"})
    assert c.get("/api/admin/users/", headers=user_auth).status_code == 403
    assert c.put("/api/admin/settings/", headers=user_auth, json={"daily_assessment_limit": 99}).status_code == 403

    adm = admin(c)
    users = c.get("/api/admin/users/", headers=adm).json()
    dev = next(u for u in users if u["email"] == "dev@test.io")
    admin_id = next(u["id"] for u in users if u["role"] == "admin")
    assert c.patch(f"/api/admin/users/{admin_id}/", headers=adm, json={"is_active": False}).status_code == 400

    off = c.patch(f"/api/admin/users/{dev['id']}/", headers=adm, json={"is_active": False})
    assert off.json()["is_active"] is False
    assert c.get("/api/auth/me/", headers=user_auth).status_code == 401              # existing session ended
    assert c.post("/api/auth/login/", json={"email": "dev@test.io", "password": PW}).status_code == 403
    c.patch(f"/api/admin/users/{dev['id']}/", headers=adm, json={"is_active": True})
    assert c.patch(f"/api/admin/users/{dev['id']}/", headers=adm, json={"role": "root"}).status_code == 422
    assert c.patch(f"/api/admin/users/{dev['id']}/", headers=adm, json={"role": "admin"}).json()["role"] == "admin"

    actions = {e["action"] for e in c.get("/api/admin/audit/", headers=adm).json()}
    assert {"user.register", "login", "login.failed", "admin.user_update"} <= actions
    own = c.get("/api/auth/audit/", headers=login(c)).json()
    assert own and all(e["actor"] == "dev@test.io" for e in own if e["action"].startswith("login"))
    status_ = c.get("/api/admin/status/", headers=adm).json()
    assert status_["services"] == {"ai": "not-configured", "project": "up", "reporting": "down", "scan": "up"}


# ---------------------------------------------------------------- AUTH-9
def test_delete_account(app_client):
    app, c = app_client
    register(c)
    auth = login(c)
    assert c.request("DELETE", "/api/auth/me/", headers=auth, json={"password": "Wrong-pass-1"}).status_code == 403
    assert c.request("DELETE", "/api/auth/me/", headers=auth, json={"password": PW}).status_code == 204
    deletes = [r for r in captured if r.method == "DELETE"]
    assert {r.url.host for r in deletes} == {"project.local", "scan.local"}
    assert all(r.headers["x-internal-key"] == KEY for r in deletes)
    assert c.post("/api/auth/login/", json={"email": "dev@test.io", "password": PW}).status_code == 401
    assert "user.delete" in {e["action"] for e in c.get("/api/admin/audit/", headers=admin(c)).json()}


# ---------------------------------------------------------------- configuration
def test_production_requires_real_secrets():
    with pytest.raises(RuntimeError):
        Settings(app_env="production", jwt_secret="short").validate()
    Settings(app_env="production", jwt_secret="s" * 40, git_token_key="ab" * 32,
             internal_api_key="i" * 20).validate()
    assert hash_password("a") != hash_password("a")   # salted


# ---------------------------------------------------------------- backend quirks hidden by the gateway
def test_trailing_slash_redirect_is_followed_and_no_slash_route(app_client):
    app, c = app_client
    auth = verified_user(app, c)
    r = c.get("/api/projects/", headers=auth)
    assert r.status_code == 200 and r.json()["path"] == "/api/projects"
    assert "location" not in r.headers
    r = c.get("/api/projects?page=1", headers=auth, follow_redirects=False)
    assert r.status_code == 200 and r.json() == {"path": "/api/projects", "query": "page=1"}


def test_strip_api_prefix_for_selected_services(app_client):
    app, c = app_client
    app.state.settings.strip_api_prefix_for = ["scan"]
    auth = verified_user(app, c)
    assert c.get("/api/scans/7/findings", headers=auth).json()["path"] == "/scans/7/findings"
    assert c.get("/api/projects/9", headers=auth).json()["path"] == "/api/projects/9"


# ---------------------------------------------------------------- gateway pages (AUTH-2, AUTH-4, AUTH-5)
def test_pages_are_branded_and_locked_down(client):
    home = client.get("/")
    assert home.status_code == 200 and "Securicode gateway" in home.text and 'href="/docs"' in home.text
    csp = home.headers["content-security-policy"]
    assert "default-src 'none'" in csp and "script" not in csp       # no JavaScript allowed on gateway pages
    assert home.headers["x-frame-options"] == "DENY"
    page = client.get("/auth/vscode", params={"redirect_uri": "vscode://securicode.ext/auth", "state": '"><script>'})
    assert "<script>" not in page.text and "&quot;&gt;&lt;script&gt;" in page.text   # state is escaped
    assert client.get("/auth/reset-password").status_code == 400                     # missing token


def test_verify_email_page_links_to_web_app(app_client):
    app, c = app_client
    app.state.settings.web_app_url = "https://securicode.example"
    register(c)
    ok = c.get("/api/auth/verify-email/", params={"token": last_link_token(app, "verify-email")})
    assert ok.status_code == 200 and "E-mail verified" in ok.text and 'href="https://securicode.example"' in ok.text
    bad = c.get("/api/auth/verify-email/", params={"token": "nope"})
    assert bad.status_code == 400 and "no longer works" in bad.text


def test_password_reset_html_form_without_javascript(app_client):
    app, c = app_client
    register(c)
    c.post("/api/auth/password-reset/", json={"email": "dev@test.io"})
    token = last_link_token(app, "reset-password")
    form = c.get("/auth/reset-password", params={"token": token})
    assert 'method="post"' in form.text and "<script" not in form.text
    mismatch = c.post("/auth/reset-password", data={"token": token, "new_password": "Brand-New-Pass-7", "confirm": "x"})
    assert mismatch.status_code == 422 and "don&#x27;t match" in mismatch.text
    weak = c.post("/auth/reset-password", data={"token": token, "new_password": "short", "confirm": "short"})
    assert weak.status_code == 422 and "at least 10" in weak.text
    done = c.post("/auth/reset-password",
                  data={"token": token, "new_password": "Brand-New-Pass-7", "confirm": "Brand-New-Pass-7"})
    assert done.status_code == 200 and "Password changed" in done.text
    again = c.post("/auth/reset-password",
                   data={"token": token, "new_password": "Another-Pass-77", "confirm": "Another-Pass-77"})
    assert again.status_code == 400                                                   # single use
    login(c, password="Brand-New-Pass-7")
