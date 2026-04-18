#!/usr/bin/env bash
set -euo pipefail

echo "=== Setting up CI environment for opencode-image-comprehension ==="

echo "--- Installing Ollama ---"
if command -v ollama >/dev/null 2>&1; then
  echo "Ollama already installed: $(ollama --version 2>/dev/null || echo 'version unknown')"
else
  curl -fsSL https://ollama.com/install.sh | sh
  echo "Ollama installed successfully"
fi

echo "--- Starting Ollama server ---"
ollama serve &
OLLAMA_PID=$!

echo "--- Waiting for Ollama to be ready ---"
MAX_RETRIES=30
RETRY_COUNT=0
while ! curl -sf http://localhost:11434/api/version >/dev/null 2>&1; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "ERROR: Ollama did not become ready after ${MAX_RETRIES} retries"
    kill "$OLLAMA_PID" 2>/dev/null || true
    exit 1
  fi
  echo "Waiting for Ollama... ($RETRY_COUNT/$MAX_RETRIES)"
  sleep 2
done
echo "Ollama is ready"

echo "--- Pulling models ---"
echo "Pulling llama3.2:3b (non-vision model for chat)..."
ollama pull llama3.2:3b

echo "Pulling moondream:1.8b (vision model for image comprehension)..."
ollama pull moondream:1.8b

echo "Models pulled successfully"
ollama list

echo "--- Installing image-comprehension-ollama skill ---"
npx skills add aosama/image-comprehension-ollama

echo "=== CI environment setup complete ==="