#!/usr/bin/env bash

set -euo pipefail

START_SECONDS=$(date +%s)
TEMP_DIR=""

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

elapsed_seconds() {
  now=$(date +%s)
  printf '%s' "$((now - START_SECONDS))"
}

start_step() {
  STEP_NAME=$1
  STEP_START_SECONDS=$(date +%s)
  log "START ${STEP_NAME}"
}

end_step() {
  step_end_seconds=$(date +%s)
  log "END ${STEP_NAME} elapsed=$((step_end_seconds - STEP_START_SECONDS))s total_elapsed=$(elapsed_seconds)s"
}

cleanup() {
  if [ -z "${TEMP_DIR:-}" ]; then
    return
  fi

  case "${TEMP_DIR}" in
    /|.|..)
      log "ERROR refusing to remove unsafe temp dir: ${TEMP_DIR}"
      return
      ;;
  esac

  if [ -d "${TEMP_DIR}" ]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup 0

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "ERROR missing required command: $1"
    exit 1
  fi
}

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
TEST_IMAGE="${SCRIPT_DIR}/test-image.png"
DOCKERFILE="${SCRIPT_DIR}/docker-packed-install.Dockerfile"
RUNNER="${SCRIPT_DIR}/docker-packed-runner.mjs"
IMAGE_TAG="opencode-image-comprehension-packed-test:local"

start_step "validate inputs"
require_command docker
require_command npm

if [ ! -f "${TEST_IMAGE}" ]; then
  log "ERROR missing test image: ${TEST_IMAGE}"
  exit 1
fi

if [ -z "${OLLAMA_API_KEY:-}" ] && [ -z "${OLLAMA_CLOUD_API_KEY:-}" ] && [ -z "${SEARCH_WEB_OLLAMA:-}" ]; then
  log "ERROR OLLAMA_API_KEY, OLLAMA_CLOUD_API_KEY, or SEARCH_WEB_OLLAMA is required"
  exit 1
fi
end_step

start_step "build and pack plugin"
cd "${PROJECT_DIR}"
npm run build
TEMP_DIR=$(mktemp -d)
npm pack --pack-destination "${TEMP_DIR}" >/dev/null
set -- "${TEMP_DIR}"/opencode-image-comprehension-*.tgz
PLUGIN_TARBALL=$1
if [ ! -f "${PLUGIN_TARBALL}" ]; then
  log "ERROR npm pack did not create plugin tarball"
  exit 1
fi
log "packed tarball: ${PLUGIN_TARBALL}"
end_step

start_step "prepare docker context"
cp "${PLUGIN_TARBALL}" "${TEMP_DIR}/plugin.tgz"
cp "${TEST_IMAGE}" "${TEMP_DIR}/test-image.png"
cp "${RUNNER}" "${TEMP_DIR}/docker-packed-runner.mjs"
end_step

start_step "build docker image"
docker build \
  --file "${DOCKERFILE}" \
  --tag "${IMAGE_TAG}" \
  "${TEMP_DIR}"
end_step

start_step "run docker packed install test"
docker run --rm \
  --env OLLAMA_API_KEY \
  --env OLLAMA_CLOUD_API_KEY \
  --env SEARCH_WEB_OLLAMA \
  --env IMAGE_COMPREHENSION_MODEL="${IMAGE_COMPREHENSION_MODEL:-gemma4:31b}" \
  "${IMAGE_TAG}"
end_step

log "SUCCESS docker packed install test completed total_elapsed=$(elapsed_seconds)s"
