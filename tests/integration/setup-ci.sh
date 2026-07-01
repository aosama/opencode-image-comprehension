#!/usr/bin/env bash
set -euo pipefail

echo "=== Setting up CI environment for opencode-image-comprehension ==="

echo "--- Checking Ollama Cloud API key ---"
if [ -z "${OLLAMA_CLOUD_API_KEY:-}" ] && [ -z "${OLLAMA_API_KEY:-}" ]; then
  echo "ERROR: OLLAMA_CLOUD_API_KEY or OLLAMA_API_KEY is required for integration tests"
  exit 1
fi

echo "Ollama Cloud API key is configured"

echo "=== CI environment setup complete ==="
