#!/usr/bin/env bash
# CI helper for the Gateway service. Follows Lab 1 (docs/lab1.md):
#   test on the runner -> build & push to the GitLab registry, tagged with the commit SHA
#   -> deploy on the worker with Docker Compose through DOCKER_HOST=ssh://gitlab-runner@<worker>.
#   ci.sh test      lint + unit tests inside `docker build --target test`; any failure stops the pipeline
#   ci.sh build     build the runtime image and push $CI_REGISTRY_IMAGE/gateway:<short sha>
#   ci.sh deploy    compose up the new image, wait for HEALTHCHECK, roll back automatically if unhealthy
#   ci.sh rollback  redeploy ROLLBACK_TAG, or the previous image on the worker if unset (manual job)
#   ci.sh status    show what is running
set -euo pipefail

CMD=${1:?usage: ci.sh test|build|deploy|rollback|status}
DIR=${GW_DIR:-services/gateway}
HOST=${GW_HOST:-worker1}
NAME=${GW_CONTAINER:-securicode-gateway}
export GW_PORT=${GW_PORT:-8000}
COMPOSE_FILE_PATH=${GW_COMPOSE_FILE:-deploy/compose.${HOST}.yml}
TAG=${CI_COMMIT_SHORT_SHA:-$(git rev-parse --short HEAD)}
REPO="${CI_REGISTRY_IMAGE:-local}/gateway"
IMAGE="${REPO}:${TAG}"
ENV_FILE=""

login()     { echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY" >/dev/null; }
on_worker() { export DOCKER_HOST="ssh://gitlab-runner@${HOST}"; }
ip_of()     { getent hosts "$1" | awk '{print $1; exit}'; }

make_env_file() {  # read by the compose client on the runner; never written to the worker's disk
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
             IDLE_TIMEOUT_SECONDS DAILY_ASSESSMENT_LIMIT GATEWAY_ROUTES GATEWAY_STRIP_API_PREFIX \
             PROJECT_SERVICE_URL SCAN_SERVICE_URL AI_SERVICE_URL REPORTING_SERVICE_URL; do
      [ -n "${!v:-}" ] && echo "${v}=${!v}"
    done
    true
  } > "$ENV_FILE"
}

run_container() {  # $1 = full image ref; deploys only the gateway entry of the host's compose file
  docker compose version >/dev/null 2>&1 || { echo "docker compose plugin is not installed on the runner"; exit 1; }
  # one-time migration: a gateway container started earlier with plain `docker run` blocks the name
  if docker inspect "$NAME" >/dev/null 2>&1 && \
     [ -z "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$NAME")" ]; then
    echo "removing pre-compose container ${NAME}"; docker rm -f "$NAME" >/dev/null
  fi
  GATEWAY_IMAGE="$1" GATEWAY_ENV_FILE="$ENV_FILE" WORKER1_IP="$(ip_of worker1)" WORKER2_IP="$(ip_of worker2)" \
    docker compose -f "$COMPOSE_FILE_PATH" up -d --no-deps gateway
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
    echo "previous image: ${prev:-none}  ->  new image: ${IMAGE} on ${HOST}:${GW_PORT} (compose: ${COMPOSE_FILE_PATH})"
    make_env_file
    run_container "$IMAGE"
    if wait_healthy; then
      echo "DEPLOYED ${IMAGE} on ${HOST}:${GW_PORT}"
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
