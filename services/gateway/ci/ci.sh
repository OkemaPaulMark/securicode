#!/usr/bin/env bash
# CI helper for the Gateway service. Follows the Lab 1 pattern (docs/lab1.md §6):
#   test on the runner -> build & push to the GitLab registry, tagged with the commit SHA
#   -> deploy on worker1 through DOCKER_HOST=ssh://gitlab-runner@worker1 (docker pull + run).
#   ci.sh test      lint + unit tests inside `docker build --target test`; any failure stops the pipeline
#   ci.sh build     build the runtime image and push $CI_REGISTRY_IMAGE/gateway:<short sha>
#   ci.sh deploy    pull + run on worker1, wait for HEALTHCHECK, roll back automatically if unhealthy
#   ci.sh rollback  redeploy ROLLBACK_TAG, or the previous image on worker1 if unset (manual job)
#   ci.sh status    show what is running
set -euo pipefail

CMD=${1:?usage: ci.sh test|build|deploy|rollback|status}
DIR=${GW_DIR:-services/gateway}
HOST=${GW_HOST:-worker1}
NAME=${GW_CONTAINER:-securicode-gateway}
PORT=${GW_PORT:-8000}
TAG=${CI_COMMIT_SHORT_SHA:-$(git rev-parse --short HEAD)}
REPO="${CI_REGISTRY_IMAGE:-local}/gateway"
IMAGE="${REPO}:${TAG}"
ENV_FILE=""

login()     { echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY" >/dev/null; }
on_worker() { export DOCKER_HOST="ssh://gitlab-runner@${HOST}"; }

make_env_file() {  # read by the docker client on the runner; never written to the worker's disk
  : "${JWT_SECRET:?Set JWT_SECRET as a CI/CD variable (Settings > CI/CD > Variables)}"
  : "${GIT_TOKEN_KEY:?Set GIT_TOKEN_KEY (openssl rand -hex 32) as a CI/CD variable}"
  : "${INTERNAL_API_KEY:?Set INTERNAL_API_KEY (openssl rand -hex 24) as a CI/CD variable}"
  ENV_FILE=$(mktemp)
  chmod 600 "$ENV_FILE"
  trap 'rm -f "$ENV_FILE"' EXIT
  {
    echo "APP_ENV=production"
    for v in JWT_SECRET GIT_TOKEN_KEY INTERNAL_API_KEY ADMIN_EMAIL ADMIN_PASSWORD DATABASE_URL CORS_ORIGINS \
             PUBLIC_BASE_URL SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM REQUIRE_EMAIL_VERIFICATION \
             IDLE_TIMEOUT_SECONDS DAILY_ASSESSMENT_LIMIT GATEWAY_ROUTES \
             PROJECT_SERVICE_URL SCAN_SERVICE_URL AI_SERVICE_URL REPORTING_SERVICE_URL; do
      [ -n "${!v:-}" ] && echo "${v}=${!v}"
    done
    true
  } > "$ENV_FILE"
}

run_container() {  # $1 = full image ref
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --restart unless-stopped -p "${PORT}:8000" -v "${NAME}-data:/data" \
    --env-file "$ENV_FILE" --label "service=${NAME}" $(host_args) "$1" >/dev/null
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

host_args() {  # containers cannot resolve worker1/worker2, so pass the runner's view of them in
  for h in worker1 worker2; do
    ip=$(getent hosts "$h" | awk '{print $1; exit}')
    [ -n "$ip" ] && printf -- '--add-host=%s:%s ' "$h" "$ip"
  done
  true
}

case "$CMD" in
  test)
    docker build --target test -t "gateway-test:${TAG}" "$DIR"
    docker rmi "gateway-test:${TAG}" >/dev/null 2>&1 || true
    ;;
  build)
    login
    docker build --target runtime --provenance=false --sbom=false --build-arg "APP_VERSION=${TAG}" \
      --label "org.opencontainers.image.revision=${CI_COMMIT_SHA:-$TAG}" -t "$IMAGE" "$DIR"
    docker push "$IMAGE"
    echo "PUSHED ${IMAGE}"
    ;;
  deploy)
    on_worker
    login
    docker pull "$IMAGE"
    prev=$(docker inspect -f '{{.Config.Image}}' "$NAME" 2>/dev/null || true)
    echo "previous image: ${prev:-none}  ->  new image: ${IMAGE} on ${HOST}:${PORT}"
    make_env_file
    run_container "$IMAGE"
    if wait_healthy; then
      echo "DEPLOYED ${IMAGE} on ${HOST}:${PORT}"
    else
      echo "Health check failed - container logs:"; docker logs --tail 50 "$NAME" || true
      if [ -n "$prev" ] && [ "$prev" != "$IMAGE" ]; then
        echo "Rolling back to ${prev}"; run_container "$prev"; wait_healthy || true
      fi
      exit 1
    fi
    ;;
  rollback)
    on_worker
    login
    current=$(docker inspect -f '{{.Config.Image}}' "$NAME" 2>/dev/null || true)
    target=${ROLLBACK_TAG:-}
    if [ -z "$target" ]; then  # newest gateway image on the worker that is not the one running now
      target=$(docker images "$REPO" --format '{{.Tag}}' | grep -v '^latest$' | grep -vx "${current##*:}" | head -n1 || true)
    fi
    [ -n "$target" ] || { echo "No earlier image to roll back to"; exit 1; }
    echo "Rolling back ${current:-none} -> ${REPO}:${target}"
    docker pull "${REPO}:${target}" || true
    make_env_file
    run_container "${REPO}:${target}"
    wait_healthy
    ;;
  status)
    on_worker
    docker ps --filter "label=service=${NAME}" --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
    ;;
  *) echo "unknown command: $CMD"; exit 2 ;;
esac
