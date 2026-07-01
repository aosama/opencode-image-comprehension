#!/usr/bin/env bash
set -euo pipefail

echo "=== Quick Smoke Test: opencode run ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_IMAGE="$SCRIPT_DIR/test-image.png"

echo "Project directory: $PROJECT_DIR"
echo "Test image: $TEST_IMAGE"

if [ ! -f "$TEST_IMAGE" ]; then
  echo "ERROR: Test image not found at $TEST_IMAGE"
  exit 1
fi

echo "Building plugin..."
cd "$PROJECT_DIR"
npm ci
npm run build

echo "Checking if dist/index.js exists..."
if [ ! -f dist/index.js ]; then
  echo "ERROR: dist/index.js not found after build"
  exit 1
fi

echo "Checking Ollama Cloud API key environment..."
if [ -z "${OLLAMA_CLOUD_API_KEY:-}" ] && [ -z "${OLLAMA_API_KEY:-}" ]; then
  echo "WARN: OLLAMA_CLOUD_API_KEY or OLLAMA_API_KEY is not set. Tool execution will fail until one is configured."
fi

echo "Configuring OpenCode..."
PLUGIN_PATH="$PROJECT_DIR/dist/index.js"

echo "Plugin path: $PLUGIN_PATH"

if [ -z "${OPENCODE_CONFIG_CONTENT:-}" ]; then
  echo "WARNING: OPENCODE_CONFIG_CONTENT is not set. OpenCode may not load the plugin correctly."
  echo "Set OPENCODE_CONFIG_CONTENT to a JSON config that includes the plugin path."
fi

echo "=== Quick smoke test complete ==="
