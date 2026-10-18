#!/usr/bin/env bash
# Post-deploy smoke test, run by the CI job gw:verify on the runner (as gitlab-runner).
set -uo pipefail
HOST=${GW_HOST:-worker1}; PORT=${GW_PORT:-8000}; NAME=${GW_CONTAINER:-securicode-gateway}
URL="http://${HOST}:${PORT}"
J='Content-Type: application/json'
rsh() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$@"; }

echo "===== Exercise 08 Q3: Docker version on each worker"
for h in worker1 worker2; do echo -n "$h: "; rsh "$h" docker info --format '{{.ServerVersion}}'; done

echo "===== Exercise 08 Q4: containers on each worker"
for h in worker1 worker2; do echo "--- $h"; rsh "$h" "docker ps --format '{{.Names}}  {{.Image}}  {{.Ports}}'"; done

echo "===== Gateway health ($URL)"
curl -sS "$URL/health"; echo

EMAIL="smoke-$(date +%s)@securicode.io"; PW="Smoke-Pass-2026"
echo "===== Register $EMAIL"
curl -sS -X POST "$URL/api/auth/register/" -H "$J" -d "{\"name\":\"CI Smoke\",\"email\":\"$EMAIL\",\"password\":\"$PW\"}"; echo
VT=$(rsh "$HOST" "docker logs $NAME 2>&1" | grep -o 'verify-email/?token=[A-Za-z0-9_-]*' | tail -1 | cut -d= -f2)
echo "===== Verify e-mail"
curl -sS "$URL/api/auth/verify-email/?token=$VT" | grep -o 'E-mail verified'
echo "===== Login and /me"
JWT=$(curl -sS -X POST "$URL/api/auth/login/" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -sS "$URL/api/auth/me/" -H "Authorization: Bearer $JWT"; echo
echo "===== Lockout (expect: 401 401 401 401 401 429)"
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code} " -X POST "$URL/api/auth/login/" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}"
done; echo
