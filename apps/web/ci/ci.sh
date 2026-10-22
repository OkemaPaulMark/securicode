#!/usr/bin/env bash
# CI helper for the web app (apps/web). Same model as services/gateway/ci/ci.sh (Lab 1):
#   test on the runner -> build & push to the GitLab registry, tagged with the commit SHA
#   -> deploy on the worker with Docker Compose through DOCKER_HOST=ssh://gitlab-runner@<worker>.
#   ci.sh test      type check + unit tests inside `docker build --target test`; any failure stops the pipeline
#   ci.sh build     build the runtime image and push $CI_REGISTRY_IMAGE/web:<short sha>
#   ci.sh deploy    compose up the new image, wait for HEALTHCHECK + smoke test, roll back automatically on failure
#   ci.sh rollback  redeploy ROLLBACK_TAG, or the previous image on the worker if unset (manual job)
#   ci.sh status    show what is running
set -euo pipefail

CMD=${1:?usage: ci.sh test|build|deploy|rollback|status}
DIR=${WEB_DIR:-apps/web}
HOST=${WEB_HOST:-worker1}
export WEB_CONTAINER=${WEB_CONTAINER:-securicode-web}
export WEB_PORT=${WEB_PORT:-8080}
export WEB_GATEWAY_URL=${WEB_GATEWAY_URL:-http://host.docker.internal:${GW_PORT:-8000}}
TAG=${CI_COMMIT_SHORT_SHA:-$(git rev-parse --short HEAD)}
REPO="${CI_REGISTRY_IMAGE:-local}/web"
IMAGE="${REPO}:${TAG}"
COMPOSE=(docker compose -p securicode-web -f "${DIR}/deploy/compose.yml")
NAME=$WEB_CONTAINER

login()     { [ -n "${CI_REGISTRY:-}" ] && echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY" >/dev/null || true; }
on_worker() { export DOCKER_HOST="ssh://gitlab-runner@${HOST}"; }
ip_of()     { getent hosts "$1" | awk '{print $1; exit}'; }

up() {  # $1 = full image ref
  WEB_IMAGE="$1" "${COMPOSE[@]}" pull --quiet
  WEB_IMAGE="$1" "${COMPOSE[@]}" up -d --remove-orphans
}

wait_healthy() {
  for _ in $(seq 1 30); do
    st=$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo missing)
    echo "health: ${st}"
    [ "$st" = healthy ] && return 0
    [ "$st" = unhealthy ] && return 1
    sleep 2
  done
  return 1
}

smoke() {  # the SPA loads and /api reaches the gateway (401 without a token is the expected answer)
  local ip base code
  ip=$(ip_of "$HOST"); base="http://${ip:-$HOST}:${WEB_PORT}"
  if ! command -v curl >/dev/null; then echo "curl not on runner; skipping smoke test"; return 0; fi
  curl -fsS -o /dev/null "${base}/signin" || { echo "smoke: ${base}/signin did not load"; return 1; }
  code=$(curl -s -o /dev/null -w '%{http_code}' "${base}/api/auth/me/")
  echo "smoke: ${base}/api/auth/me/ -> ${code} (401 expected)"
  [ "$code" = 401 ]
}

case "$CMD" in
  test)
    docker build --target test -t "web-test:${TAG}" "$DIR"
    docker rmi "web-test:${TAG}" >/dev/null || true
    ;;
  build)
    login
    docker build --target runtime --provenance=false --sbom=false --build-arg APP_VERSION="$TAG" \
      --label org.opencontainers.image.revision="${CI_COMMIT_SHA:-$TAG}" -t "$IMAGE" "$DIR"
    docker push "$IMAGE"
    echo "pushed ${IMAGE}"
    ;;
  deploy)
    login
    on_worker
    prev=$(docker inspect -f '{{.Config.Image}}' "$NAME" 2>/dev/null || true)
    echo "previous: ${prev:-none} -> new: ${IMAGE} on ${HOST}:${WEB_PORT} (gateway ${WEB_GATEWAY_URL})"
    up "$IMAGE"
    if wait_healthy && smoke; then
      echo "DEPLOYED ${IMAGE} on ${HOST}:${WEB_PORT}"
    else
      echo "Health or smoke check failed. Container logs:"; docker logs --tail 50 "$NAME" || true
      if [ -n "$prev" ] && [ "$prev" != "$IMAGE" ]; then
        echo "Rolling back to ${prev}"; up "$prev"; wait_healthy || true
      fi
      exit 1
    fi
    ;;
  rollback)
    login
    on_worker
    current=$(docker inspect -f '{{.Config.Image}}' "$NAME" 2>/dev/null || true)
    if [ -n "${ROLLBACK_TAG:-}" ]; then
      target="${REPO}:${ROLLBACK_TAG}"
    else
      target=$(docker images "$REPO" --format '{{.Repository}}:{{.Tag}}' | grep -vx "$current" | grep -v ':<none>' | head -n1 || true)
    fi
    [ -n "$target" ] || { echo "No earlier image to roll back to"; exit 1; }
    echo "Rolling back ${current:-none} -> ${target}"
    up "$target"
    wait_healthy
    ;;
  status)
    on_worker
    docker ps --filter "name=^${NAME}$" --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
    ;;
  *) echo "unknown command: $CMD"; exit 2 ;;
esac
