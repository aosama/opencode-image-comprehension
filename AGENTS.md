# AGENTS.md

Guidelines for AI agents working in this repository.

## Your Instructions

- In addition to this file, you are to read each and every file under `.github/instructions` and follow each and every directive in them to the letter.

## Repository Overview

This repository contains **opencode-image-comprehension** — an OpenCode plugin that enables image comprehension for non-vision models using local Ollama vision models.

- **Name**: opencode-image-comprehension
- **GitHub**: [aosama/opencode-image-comprehension](https://github.com/aosama/opencode-image-comprehension)
- **License**: MIT

## Repository Discovery Guide

- the file `.github/instructions/repo-discovery-guide.instructions.md` is intended to help coding agents. you are to keep it updated at all times and before each commit with the latest high value entry points into this repo. the intent is to help coding agents contribute and understand the layout of this repository.

## Architecture

- **Single-file architecture**: All plugin logic lives in `src/index.ts`.
- **Plugin type**: Uses OpenCode's `Plugin` type from `@opencode-ai/plugin`.
- **Two hooks**:
  - `tool`: Registers a custom `comprehend_image` tool that the LLM can call.
  - `experimental.chat.messages.transform`: Intercepts chat messages before they reach the LLM. When a non-vision model receives images, the hook strips them out and replaces them with text instructions pointing to the `comprehend_image` tool.
- **Delegation**: The `comprehend_image` tool invokes the `image-comprehension-ollama` skill's shell script under the hood, which handles Ollama server management, model availability, and image analysis.

## Conventions

- **TypeScript strict mode**: Enabled. All code must pass strict type checking.
- **ESM modules**: The project uses `"type": "module"`.
- **No runtime dependencies**: Only `@opencode-ai/plugin` and `@opencode-ai/sdk` as peer dependencies, plus Node.js built-ins.
- **Error handling**: All I/O must be try/caught. The plugin must never crash OpenCode.
- **Logging**: Use `client.app.log()` for structured logging, never `console.log`.
- **Naming**: Use descriptive names. The plugin name constant is `PLUGIN_NAME = "image-comprehension"` and the tool name is `TOOL_NAME = "comprehend_image"`.
- **Config**: User config at `~/.config/opencode/opencode-image-comprehension.json`, project config at `.opencode/opencode-image-comprehension.json`. Project config takes precedence over user config, which takes precedence over defaults.

## Git Workflow

### Branch Naming

- Features: `feature/description`
- Fixes: `fix/description`
- Documentation: `docs/description`

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: add new feature`
- `fix: resolve issue`
- `docs: update documentation`

### Testing

- **Unit tests**: None (single-file architecture, no test framework configured)
- **Integration tests**: `tests/integration/` — full end-to-end tests using OpenCode + Ollama
  - `setup-ci.sh`: Installs Ollama, pulls models, installs the skill
  - `quick-test.sh`: Smoke test — builds plugin, verifies skill and Ollama are reachable
  - `deep-test.ts`: Integration test — runs `opencode run --format json` with image attachment, verifies tool invocation
  - `test-image.png`: Minimal 1x1 test PNG for integration tests
- **CI workflows**:
  - `.github/workflows/ci.yml`: Format check + build (runs on Node 20/22/24, timeout: 10 min)
  - `.github/workflows/test.yml`: Integration test with Ollama Cloud + local vision model (timeout: 15 min)
- **Integration test architecture**: Uses Ollama Cloud (`qwen3.5:cloud`) for the non-vision LLM (fast, no CPU inference) and local Ollama (`moondream:1.8b`) for vision comprehension. Requires `OLLAMA_CLOUD_APIKEY` GitHub secret. The test uses `opencode run --format json --dangerously-skip-permissions` for simple, reliable end-to-end verification.

### Pull Request Checklist

- [ ] `npm run format:check` passes
- [ ] `npm run build` succeeds with no errors
- [ ] No sensitive data or credentials in code
- [ ] Plugin logic remains in a single file (`src/index.ts`)
