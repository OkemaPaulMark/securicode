import time
import uuid

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.security import hash_password, verify_password

SECRET = "x" * 40
ISS = "securicode-gateway"
captured: dict = {}


def fake_backends(request: httpx.Request) -> httpx.Response:
    if request.url.host == "down.local":
        raise httpx.ConnectError("refused", request=request)
    captured["request"] = request
    return httpx.Response(200, json={"path": request.url.path, "query": request.url.query.decode()})


@pytest.fixture
def client(tmp_path):
    settings = Settings(app_env="test", jwt_secret=SECRET, database_url=f"sqlite:///{tmp_path}/t.db",
                        admin_username="admin", admin_email="admin@test.io", admin_password="adminpass123",
                        cors_origins=["*"],
                        upstreams={"projects": "http://project.local", "scans": "http://scan.local",
                                   "reports": "http://down.local", "ai": ""})
    with TestClient(create_app(settings, transport=httpx.MockTransport(fake_backends))) as c:
        yield c


def register_and_login(c, username="dev", password="devpass123", scope="web"):
    r = c.post("/api/auth/register/", json={"username": username, "email": f"{username}@test.io",
                                            "password": password, "full_name": "Dev"})
    assert r.status_code == 201, r.text
    r = c.post("/api/auth/login/", json={"username": username, "password": password, "scope": scope})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_health_and_ready(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/ready").json()["status"] == "ready"


def test_password_hashing():
    h = hash_password("s3cret-pass")
    assert verify_password("s3cret-pass", h) and not verify_password("wrong", h)
    assert not verify_password("x", "garbage")


def test_vscode_login_contract(client):
    """apps/vscode-extension/src/api-client/client.ts posts {username,password,name,scope} and reads TokenIssued."""
    register_and_login(client)
    r = client.post("/api/auth/login/", json={"username": "dev", "password": "devpass123",
                                               "name": "VS Code", "scope": "vscode"})
    body = r.json()
    assert r.status_code == 200
    assert body["name"] == "VS Code" and body["scope"] == "vscode" and body["id"] and body["token"]
    assert jwt.decode(body["token"], SECRET, algorithms=["HS256"], issuer=ISS)["scope"] == "vscode"


def test_login_by_email_and_me(client):
    register_and_login(client)
    r = client.post("/api/auth/login/", json={"username": "DEV@test.io", "password": "devpass123"})
    auth = {"Authorization": f"Bearer {r.json()['token']}"}
    me = client.get("/api/auth/me/", headers=auth).json()
    assert me["username"] == "dev" and me["role"] == "developer" and "password_hash" not in me


def test_duplicate_and_validation(client):
    register_and_login(client)
    dup = {"username": "dev", "email": "other@test.io", "password": "another123"}
    assert client.post("/api/auth/register/", json=dup).status_code == 409
    bad_email = {"username": "x1x", "email": "bad", "password": "another123"}
    assert client.post("/api/auth/register/", json=bad_email).status_code == 422
    short_pw = {"username": "x2x", "email": "a@b.io", "password": "short"}
    assert client.post("/api/auth/register/", json=short_pw).status_code == 422


def test_wrong_password(client):
    register_and_login(client)
    r = client.post("/api/auth/login/", json={"username": "dev", "password": "nope-nope"})
    assert r.status_code == 401


def test_token_required_and_validated(client):
    assert client.get("/api/scans/1/").status_code == 401
    assert client.get("/api/auth/me/", headers={"Authorization": "Bearer not.a.jwt"}).status_code == 401
    base = {"sub": "x", "iss": ISS, "jti": str(uuid.uuid4())}
    expired = jwt.encode({**base, "exp": int(time.time()) - 10}, SECRET, "HS256")
    r = client.get("/api/auth/me/", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401 and r.json()["detail"] == "Token expired"
    forged = jwt.encode({**base, "exp": int(time.time()) + 60}, "other" * 10, "HS256")
    assert client.get("/api/auth/me/", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_logout_revokes_token(client):
    auth = register_and_login(client)
    assert client.post("/api/auth/logout/", headers=auth).status_code == 204
    r = client.get("/api/auth/me/", headers=auth)
    assert r.status_code == 401 and r.json()["detail"] == "Token revoked"


def test_proxy_forwards_path_injects_identity_strips_spoofing(client):
    auth = register_and_login(client)
    me = client.get("/api/auth/me/", headers=auth).json()
    r = client.get("/api/scans/42/findings/?severity=high", headers={**auth, "X-User-Role": "admin"})
    assert r.status_code == 200
    assert r.json() == {"path": "/api/scans/42/findings/", "query": "severity=high"}
    sent = captured["request"]
    assert sent.url.host == "scan.local"
    assert sent.headers["x-user-id"] == me["id"] and sent.headers["x-user-role"] == "developer"
    assert "authorization" not in sent.headers
    assert r.headers["x-request-id"] == sent.headers["x-request-id"]

    client.post("/api/projects/", headers=auth, json={"name": "demo"})
    assert captured["request"].url.host == "project.local"
    assert captured["request"].content == b'{"name":"demo"}'


def test_proxy_errors(client):
    auth = register_and_login(client)
    assert client.get("/api/unknown/x/", headers=auth).status_code == 404
    assert client.post("/api/ai/ask/", headers=auth, json={}).status_code == 503
    assert client.get("/api/reports/1/", headers=auth).status_code == 502


def test_gateway_routes_and_status(client):
    assert client.get("/gateway/routes/").json()["ai"] == {"configured": False}
    assert client.get("/gateway/status/").json() == {
        "projects": "up", "scans": "up", "reports": "down", "ai": "not-configured"}


def test_admin_rbac(client):
    dev = register_and_login(client)
    assert client.get("/api/auth/users/", headers=dev).status_code == 403
    tok = client.post("/api/auth/login/", json={"username": "admin", "password": "adminpass123"}).json()["token"]
    admin = {"Authorization": f"Bearer {tok}"}
    users = client.get("/api/auth/users/", headers=admin).json()
    assert {u["username"] for u in users} == {"admin", "dev"}
    dev_id = next(u["id"] for u in users if u["username"] == "dev")
    url = f"/api/auth/users/{dev_id}/role/"
    assert client.patch(url, headers=admin, json={"role": "root"}).status_code == 422
    assert client.patch(url, headers=admin, json={"role": "admin"}).json()["role"] == "admin"


def test_production_rejects_weak_secret():
    with pytest.raises(RuntimeError):
        Settings(app_env="production", jwt_secret="short").validate()
