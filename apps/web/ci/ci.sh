#!/usr/bin/env bash
# CI helper for the web app (apps/web). Same model as services/gateway/ci/ci.sh:
# runs on the CloudLab runner (shell executor); Docker work happens on the worker over SSH, the build context is
# streamed as a tar, so nothing is built on the runner itself.
#   ci.sh test      type check + unit tests (docker build --target test); fails the pipeline on any failure
#   ci.sh build     build the runtime image tagged with the commit short SHA
#   ci.sh deploy    (re)start the container, wait for HEALTHCHECK, auto-roll back if unhealthy
#   ci.sh rollback  redeploy ROLLBACK_TAG, or the previous image if unset (manual job)
#   ci.sh status    show what is running
set -euo pipefail

CMD=${1:?usage: ci.sh test|build|deploy|rollback|status}
DIR=${WEB_DIR:-apps/web}
HOST=${WEB_HOST:-worker1}
IMAGE=${WEB_IMAGE:-securicode/web}
NAME=${WEB_CONTAINER:-securicode-web}
PORT=${WEB_PORT:-8080}
# The gateway runs on the same worker (gw:deploy publishes :8000), reached through the Docker host gateway.
GATEWAY=${WEB_GATEWAY_URL:-http://host.docker.internal:8000}
TAG=${CI_COMMIT_SHORT_SHA:-$(git rev-parse --short HEAD)}

rsh() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "$@"; }
context() { tar -C "$DIR" --exclude=node_modules --exclude=dist --exclude=.vite --exclude=coverage -cf - .; }

run_container() {  # $1 = full image ref
  rsh "docker rm -f ${NAME} >/dev/null 2>&1 || true; \
       docker run -d --name ${NAME} --restart unless-stopped -p ${PORT}:8080 \
         --add-host=host.docker.internal:host-gateway -e GATEWAY_URL=${GATEWAY} \
         --label service=${NAME} $1"
}

wait_healthy() {
  for _ in $(seq 1 30); do
    st=$(rsh "docker inspect -f '{{.State.Health.Status}}' ${NAME}" 2>/dev/null || echo missing)
    echo "health: ${st}"
    [ "$st" = healthy ] && return 0
    [ "$st" = unhealthy ] && return 1
    sleep 2
  done
  return 1
}

smoke() {  # the SPA is served and /api reaches the gateway (401 without a token is the expected answer)
  rsh "curl -fsS -o /dev/null http://127.0.0.1:${PORT}/signin && \
       test \$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT}/api/auth/me/) = 401"
}

case "$CMD" in
  test)
    context | rsh "docker build --target test -t ${IMAGE}:test-${TAG} - && docker rmi ${IMAGE}:test-${TAG} >/dev/null"
    ;;
  build)
    context | rsh "docker build --target runtime --build-arg APP_VERSION=${TAG} \
      --label org.opencontainers.image.revision=${CI_COMMIT_SHA:-$TAG} -t ${IMAGE}:${TAG} -t ${IMAGE}:latest -"
    rsh "docker image inspect ${IMAGE}:${TAG} --format 'built {{.RepoTags}} {{.Id}}'"
    ;;
  deploy)
    prev=$(rsh "docker inspect -f '{{.Config.Image}}' ${NAME}" 2>/dev/null || true)
    echo "previous image: ${prev:-none}  ->  new image: ${IMAGE}:${TAG} on ${HOST}:${PORT} (gateway ${GATEWAY})"
    run_container "${IMAGE}:${TAG}"
    if wait_healthy && smoke; then
      echo "DEPLOYED ${IMAGE}:${TAG} on ${HOST}:${PORT}"
    else
      echo "Health or smoke check failed — container logs:"; rsh "docker logs --tail 50 ${NAME}" || true
      if [ -n "$prev" ] && [ "$prev" != "${IMAGE}:${TAG}" ]; then
        echo "Rolling back to ${prev}"; run_container "$prev"; wait_healthy || true
      fi
      exit 1
    fi
    ;;
  rollback)
    current=$(rsh "docker inspect -f '{{.Config.Image}}' ${NAME}" 2>/dev/null || true)
    target=${ROLLBACK_TAG:-}
    if [ -z "$target" ]; then
      target=$(rsh "docker images ${IMAGE} --format '{{.Tag}}'" | grep -vE '^(latest|test-.*)$' \
               | grep -vx "${current##*:}" | head -n1 || true)
    fi
    [ -n "$target" ] || { echo "No earlier image to roll back to"; exit 1; }
    echo "Rolling back ${current:-none} -> ${IMAGE}:${target}"
    run_container "${IMAGE}:${target}"
    wait_healthy
    ;;
  status)
    rsh "docker ps --filter label=service=${NAME} --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"
    ;;
  *) echo "unknown command: $CMD"; exit 2 ;;
esac
