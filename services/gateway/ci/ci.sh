#!/usr/bin/env bash
# CI helper for the Gateway service (services/gateway).
# Runs on the CloudLab *runner* (shell executor, user gitlab-runner). Docker work happens on the
# worker over SSH, so nothing runs on the runner itself. The build context is streamed as a tar.
#   ci.sh test      lint + unit tests (docker build --target test) — fails the pipeline on any failure
#   ci.sh build     build the runtime image tagged with the commit short SHA
#   ci.sh deploy    (re)start the container, wait for HEALTHCHECK, auto-roll back if unhealthy
#   ci.sh rollback  redeploy ROLLBACK_TAG, or the previous image if unset (manual job)
#   ci.sh status    show what is running
set -euo pipefail

CMD=${1:?usage: ci.sh test|build|deploy|rollback|status}
DIR=${GW_DIR:-services/gateway}
HOST=${GW_HOST:-worker1}
IMAGE=${GW_IMAGE:-securicode/gateway}
NAME=${GW_CONTAINER:-securicode-gateway}
PORT=${GW_PORT:-8000}
TAG=${CI_COMMIT_SHORT_SHA:-$(git rev-parse --short HEAD)}
ENV_FILE=".${NAME}.env"   # lives in the SSH user's home on the worker, mode 600

rsh() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "$@"; }
context() { tar -C "$DIR" --exclude=.venv --exclude=__pycache__ --exclude='*.db' --exclude=.pytest_cache -cf - .; }

write_env_file() {
  : "${JWT_SECRET:?Set JWT_SECRET as a masked CI/CD variable (Settings > CI/CD > Variables)}"
  {
    echo "APP_ENV=production"
    echo "JWT_SECRET=${JWT_SECRET}"
    for v in ADMIN_USERNAME ADMIN_EMAIL ADMIN_PASSWORD CORS_ORIGINS TOKEN_TTL_SECONDS DATABASE_URL \
             PROJECT_SERVICE_URL SCAN_SERVICE_URL AI_SERVICE_URL REPORTING_SERVICE_URL; do
      [ -n "${!v:-}" ] && echo "${v}=${!v}"
    done
    true
  } | rsh "umask 077; cat > ~/${ENV_FILE}"
}

run_container() {  # $1 = full image ref
  rsh "docker rm -f ${NAME} >/dev/null 2>&1 || true; \
       docker run -d --name ${NAME} --restart unless-stopped -p ${PORT}:8000 \
         -v ${NAME}-data:/data --env-file ~/${ENV_FILE} --label service=${NAME} $1"
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
    echo "previous image: ${prev:-none}  ->  new image: ${IMAGE}:${TAG} on ${HOST}:${PORT}"
    write_env_file
    run_container "${IMAGE}:${TAG}"
    if wait_healthy; then
      echo "DEPLOYED ${IMAGE}:${TAG} on ${HOST}:${PORT}"
    else
      echo "Health check failed — container logs:"; rsh "docker logs --tail 50 ${NAME}" || true
      if [ -n "$prev" ] && [ "$prev" != "${IMAGE}:${TAG}" ]; then
        echo "Rolling back to ${prev}"; run_container "$prev"; wait_healthy || true
      fi
      exit 1
    fi
    ;;
  rollback)
    current=$(rsh "docker inspect -f '{{.Config.Image}}' ${NAME}" 2>/dev/null || true)
    target=${ROLLBACK_TAG:-}
    if [ -z "$target" ]; then  # newest SHA-tagged image that is not the one running now
      target=$(rsh "docker images ${IMAGE} --format '{{.Tag}}'" | grep -vE '^(latest|test-.*)$' \
               | grep -vx "${current##*:}" | head -n1 || true)
    fi
    [ -n "$target" ] || { echo "No earlier image to roll back to"; exit 1; }
    echo "Rolling back ${current:-none} -> ${IMAGE}:${target}"
    write_env_file
    run_container "${IMAGE}:${target}"
    wait_healthy
    ;;
  status)
    rsh "docker ps --filter label=service=${NAME} --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"
    ;;
  *) echo "unknown command: $CMD"; exit 2 ;;
esac
