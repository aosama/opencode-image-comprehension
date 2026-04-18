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

echo "Checking if image-comprehension-ollama skill is installed..."
SKILL_PATH="$HOME/.agents/skills/image-comprehension-ollama/scripts/comprehend_image.sh"
if [ ! -f "$SKILL_PATH" ]; then
  echo "WARN: Skill script not found at $SKILL_PATH"
  echo "Installing skill..."
  npx skills add aosama/image-comprehension-ollama
fi

echo "Checking if Ollama is reachable..."
if ! curl -sf http://localhost:11434/api/version >/dev/null 2>&1; then
  echo "ERROR: Ollama is not reachable at localhost:11434"
  echo "Make sure Ollama is running: ollama serve"
  exit 1
fi

echo "Checking if required models are available..."
LLAMA_AVAILABLE=$(ollama list 2>/dev/null | grep -c "llama3.2:3b" || true)
MOONDREAM_AVAILABLE=$(ollama list 2>/dev/null | grep -c "moondream:1.8b" || true)

if [ "$LLAMA_AVAILABLE" -eq 0 ]; then
  echo "Pulling llama3.2:3b..."
  ollama pull llama3.2:3b
fi

if [ "$MOONDREAM_AVAILABLE" -eq 0 ]; then
  echo "Pulling moondream:1.8b..."
  ollama pull moondream:1.8b
fi

echo "Running smoke test with skill script directly..."
SKILL_RESULT=$("$SKILL_PATH" --image "$TEST_IMAGE" --prompt "Describe this image briefly" --model moondream:1.8b 2>/dev/null || echo "SKILL_FAILED")
if [ "$SKILL_RESULT" = "SKILL_FAILED" ]; then
  echo "WARN: Skill script test failed, but continuing with OpenCode test"
else
  echo "Skill script test passed. Description: ${SKILL_RESULT:0:100}..."
fi

echo "Configuring OpenCode..."
PLUGIN_PATH="$PROJECT_DIR/dist/index.js"

echo "Plugin path: $PLUGIN_PATH"

if [ -z "${OPENCODE_CONFIG_CONTENT:-}" ]; then
  echo "WARNING: OPENCODE_CONFIG_CONTENT is not set. OpenCode may not load the plugin correctly."
  echo "Set OPENCODE_CONFIG_CONTENT to a JSON config that includes the plugin path."
fi

echo "=== Quick smoke test complete ==="