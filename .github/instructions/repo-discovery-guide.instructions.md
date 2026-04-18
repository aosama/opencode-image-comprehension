---
description: "Internal discovery and maintenance index for coding agents: file-to-purpose map, runtime entry points, code anchors, CI reality, and update triggers for the opencode-image-comprehension repo"
applyTo: "**"
---

# Repo Discovery Guide (agent-only)

This document is an internal discovery + maintenance index for coding agents working in `opencode-image-comprehension`. It is not user-facing documentation.

Use this file like a cache.

- Prefer updating it when you discover drift (paths, scripts, CI behavior), rather than keeping it perfectly current.
- Treat the "Last verified" timestamp as the main trust signal; if you only reformat or reorganize text, do not update it.

**Last verified**: 2026-04-17 (updated: added integration test info)

## 1. High-signal docs (read-first index)

| Path | Purpose |
|------|---------|
| `AGENTS.md` | Agent guidelines, architecture overview, conventions, git workflow |
| `README.md` | User-facing docs: installation, configuration, how it works, transparency |
| `CONTRIBUTING.md` | Dev setup, local testing, code style, PR checklist |
| `.github/instructions/` | All agent instructions (this file + 5 others) |

## 2. Module map (ownership + boundaries)

| Path | Owner / Purpose | Boundary notes |
|------|-----------------|----------------|
| `src/index.ts` | **All plugin logic** — single-file architecture. Config loading, image processing, tool registration, message transform hook, Ollama/skill readiness checks | No other source files. Do not split into multiple TS files |
| `tests/integration/deep-test.ts` | **Integration test** — starts OpenCode serve, sends image, verifies tool invocation | Uses Bun runtime; no unit test framework |
| `tests/integration/quick-test.sh` | **Smoke test** — builds plugin, verifies skill and Ollama are reachable | Run manually or in CI |
| `tests/integration/setup-ci.sh` | **CI setup** — installs Ollama, pulls models, installs skill | Called by `.github/workflows/test.yml` |
| `tests/integration/test-image.png` | **Test fixture** — minimal 1x1 PNG for integration tests | 70 bytes |
| `package.json` | npm package definition, scripts, peer deps | `@opencode-ai/plugin` and `@opencode-ai/sdk` are peer deps only |
| `tsconfig.json` | TypeScript config — ES2022, Node16, strict | |
| `.github/workflows/ci.yml` | CI: format check + build on Node 18/20/22 | Must complete in under 10 min per `.github/instructions/cicd.instructions.md` |
| `.github/workflows/test.yml` | Integration test: Ollama + OpenCode + plugin end-to-end | Must complete in under 10 min; no secrets needed; all local models |

## 3. Runtime entry points

| Entry point | Trigger | What happens |
|-------------|---------|--------------|
| `dist/index.js` (exported `ImageComprehensionPlugin`) | OpenCode loads plugin from `opencode.json` config | Plugin init: load config, check skill installed, check Ollama ready, register hooks |
| `tool` hook (`comprehend_image`) | LLM calls the tool | Resolves skill script path, runs `comprehend_image.sh` via `execFile`, returns description |
| `experimental.chat.messages.transform` hook | Before each LLM call | Checks if model lacks vision → extracts images → saves to temp → injects tool-call instructions |
| `~/.agents/skills/image-comprehension-ollama/scripts/comprehend_image.sh` | Called by the tool hook | Delegates to Python script which calls Ollama API |

## 4. High-signal code anchors

| Anchor (file:line range) | What | Why it matters |
|--------------------------|------|-----------------|
| `src/index.ts:1-10` | Imports and constants | All plugin identifiers, default model, MIME types |
| `src/index.ts:46-51` | `PluginConfig` interface | Config shape: models, visionModel, promptTemplate, skillPath, autoPullModel |
| `src/index.ts:154-228` | `loadPluginConfig()` | Config precedence: project > user > defaults |
| `src/index.ts:472-484` | `modelSupportsVision()` | Auto-detection logic — checks `capabilities.input.image` |
| `src/index.ts:558-600` | `ensureSkillInstalled()` | Zero-friction: auto-installs skill via `npx skills add` |
| `src/index.ts:602-663` | `ensureOllamaAndModel()` | Zero-friction: auto-pulls vision model via `ollama pull` |
| `src/index.ts:665-876` | `ImageComprehensionPlugin` | Main plugin export — init, hooks, tool definition |

## 5. CI reality (verified)

### ci.yml — Format check + build

| Step | Command | Approx time |
|------|---------|-------------|
| Install | `npm ci` | ~5s |
| Format check | `npm run format:check` | ~2s |
| Build | `npm run build` (tsc) | ~3s |
| **Total** | | **~10s** (well under 10 min limit) |

CI matrix: Node 18, 20, 22 on `ubuntu-latest`. Timeout: 10 minutes.

### test.yml — Integration test

| Step | Command | Approx time |
|------|---------|-------------|
| Install Ollama | `curl -fsSL https://ollama.com/install.sh \| sh` | ~30s |
| Start Ollama + pull models | `ollama serve &`, `ollama pull llama3.2:3b`, `ollama pull moondream:1.8b` | ~3 min (cached: ~10s) |
| Install skill | `npx skills add aosama/image-comprehension-ollama` | ~15s |
| Build plugin | `npm ci && npm run build` | ~10s |
| Install OpenCode | `npm install -g opencode-ai` | ~15s |
| Smoke test | Skill script directly with test image | ~30s |
| Deep test | `npx tsx tests/integration/deep-test.ts` | ~60s |
| **Total** | | **~5-6 min** (well under 10 min limit) |

No API keys or secrets needed. Both models run locally on Ollama. Timeout: 10 minutes.

## 6. When to update this file

Update this guide when:
- New source files are added (currently single-file, so this would be a structural change)
- CI steps or Node versions change in `.github/workflows/ci.yml`
- Config format changes (fields added/renamed in `PluginConfig`)
- New hooks are registered or existing hooks are renamed
- Entry points change (new tool name, new hook name, new config file location)
- Integration test files are added or renamed
- CI workflow steps or models change