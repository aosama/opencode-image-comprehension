# Repo Discovery Guide — opencode-image-comprehension

> A cached map of non-obvious truths for coding agents working in this repository.

## Maintenance Mandate

1. **Before every commit**, update this guide if changed work affects anything it documents.
2. **At session start**, spot-check 2-3 key facts before trusting the guide.
3. **After 90 days**, treat `Last verified` as suspect and re-verify before relying on it.
4. **With expensive gotchas**, update the guide in the same change that adds, removes, renames, or discovers them.
5. **For guide-only reorganization**, update `Last verified` but do not invent factual changes.

- Last verified: 2026-07-12 — Docker packed-install test, multi-provider (ollama-cloud default + opt-in omlx), and 10-minute CI job caps are current.

## Project Overview

A TypeScript OpenCode plugin that enables image comprehension for non-vision LLM models. It intercepts pasted images, saves them as local files, strips unsupported image media from the message, and injects file-path instructions that guide the LLM to call `comprehend_image` with `image_path` and its own `prompt`; the tool calls a configurable vision provider. The default provider is `ollama-cloud` (Ollama Cloud, model `gemma4:31b`); an opt-in `omlx` provider targets a local oMLX server (OpenAI-compatible API, model `Ornith-1.0-9B-8bit`). Keep `src/index.ts` as entry wiring only; behavior lives in focused modules under `src/`.

## Known Gotchas

- **Unit tests run against built output** — `npm run test:unit` builds first, then runs `node --test tests/unit/index.test.mjs`.
- **Docker packed-install test is the release gate** — `npm run test:integration:docker` packs the tarball, installs it in a clean container, and runs OpenCode with `ollama-cloud/glm-5.2`.
- **`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"` in CI** — GitHub Actions deprecation workaround for `setup-node` runner.
- **Self-contained provider call** — no external skill, local Ollama server, or model pull is required.
- **`ollama-cloud` is the default provider** — the public npm package must keep working for all users. `omlx` is opt-in via project/user config.
- **oMLX specifics** — API key falls back to `1234` (oMLX skips verification; fixes tmux where `~/.env_exports` is not sourced). Uses OpenAI-compatible wire format (content array with `text` + `image_url` data URL; response from `choices[0].message.content`). Provider-specific defaults for model/apiKeyEnv/baseUrl applied in `resolvePluginConfig` when provider is `omlx`.
- **Tool accepts local paths** — `comprehend_image` accepts absolute, `file://`, or current-directory-relative local image paths; remote/data URLs are rejected at tool time.
- **Auto activation depends on OpenCode provider metadata** — if capability lookup is unavailable and no patterns are configured, auto mode skips image transformation rather than guessing.
- **`package.json` has no `dependencies`** — only `devDependencies` + `peerDependencies`. Relies on host (OpenCode) to provide peer packages.
- **`deep-test.ts` uses string-matching** on stdout for tool-call and description evidence — fragile if model wording changes.
- **CI split**: `ci.yml` is offline-safe; `test.yml` skips cloud integration if the secret is absent. Both jobs are capped at 10 minutes.
- **Plugin export shape matters**: default export is a v1 object with `id` and `server`; named `__test` exports would break legacy loading if default were just a function.
- **Agent guidance split**: `AGENTS.md` is intentionally principle-only; the only repo-local instruction file left is the CI/CD constraint.

## Conventions

- **No `console.log`** — all logging via `client.app.log()` with structured objects `{ service, level, message }`.
- **Plugin must never crash OpenCode** — every I/O operation inside try/catch.
- **Config precedence**: project-level > user-level > hardcoded defaults. Missing config files are silently skipped.
- **Synthetic text parts**: replacement text parts set `synthetic: true` to mark plugin-created vs user-created.
- **Prettier**: double quotes, semicolons always, trailing commas, 80-char width, 2-space tabs. No ESLint.
- **Supported formats**: PNG, JPEG, GIF, WebP, BMP.

## Structure Map

```
opencode-image-comprehension/
├── src/
│   ├── index.ts                     # Plugin entry wiring
│   ├── config.ts                    # Config parsing and precedence
│   ├── activation.ts                # Model capability/pattern checks
│   ├── image-materialization.ts     # Attached image saving and local path validation
│   ├── message-transform.ts         # Non-vision message rewrite
│   ├── comprehend-tool.ts           # comprehend_image tool definition; dispatches by provider
│   └── providers/
│       ├── ollama-cloud.ts          # Ollama Cloud request/response handling (default)
│       └── omlx.ts                  # oMLX (local OpenAI-compatible) request/response handling
├── dist/                            # Build output (gitignored)
├── tests/
│   ├── unit/
│   │   └── index.test.mjs           # Node test runner against dist/index.js
│   └── integration/
│       ├── deep-test.ts             # Spawns opencode, verifies stdout
│       ├── docker-packed-install-test.sh # npm pack + Docker install test
│       ├── quick-test.sh            # Smoke: build, check API key environment
│       ├── setup-ci.sh              # CI bootstrap
│       └── test-image.png           # 1x1 PNG test image
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                   # Format + build + unit, Node 20/22/24 matrix
│   │   └── test.yml                 # Integration test (Ollama Cloud chat + vision)
│   └── instructions/
│       └── cicd.instructions.md     # CI/CD constraints only
├── package.json                     # No "dependencies", only devDeps + peerDeps
├── tsconfig.json                    # Strict, ESNext, Node16 resolution
```

## Entry Points

- **Build**: `npm run build` (tsc only, output → `dist/`). No bundler.
- **Unit test**: `npm run test:unit` (builds first, then `node --test`).
- **Packed install test**: `npm run test:integration:docker` (needs Docker and Ollama Cloud key).
- **Format**: `npm run format` (write) or `npm run format:check` (verify-only).
- **Local dev**: Build, then symlink: `ln -sf $(pwd)/dist/index.js ~/.config/opencode/plugin/opencode-image-comprehension.js`. Requires `OLLAMA_CLOUD_API_KEY` or `OLLAMA_API_KEY` for tool execution.
- **CI (offline-safe)**: `.github/workflows/ci.yml` — format, build, unit, shell syntax, package dry run on Node 20/22/24.
- **CI (optional cloud)**: `.github/workflows/test.yml` — push/PR keeps cloud failures non-blocking; manual dispatch enforces the cloud gate when a secret exists. Plugin config is separate from OpenCode provider config.

## What to Verify

1. **Versions** — Node engine >=18.0.0, CI matrix 20/22/24. TypeScript ^5.7.0. Peer deps `@opencode-ai/plugin` and `@opencode-ai/sdk` >=1.0.0.
2. **Paths** — Config files at `~/.config/opencode/opencode-image-comprehension.json` and `.opencode/opencode-image-comprehension.json`.
3. **Vision detection** — OpenCode `client.provider.list()` shape may expose either `modalities.input` or `capabilities.input.image`; plugin supports both.
4. **Provider config** — `provider`, `model`, `apiKeyEnv`, `baseUrl`, `timeoutSeconds`, and `activation` parse as expected. `omlx` provider uses oMLX-specific defaults.
5. **Config merging** — Project > user > default precedence. Partial configs don't clobber unrelated keys.
6. **CI secrets** — `OLLAMA_CLOUD_API_KEY` or legacy `OLLAMA_CLOUD_APIKEY` valid for both chat model and image comprehension model.

## Maintenance Snapshot

- Last verified: 2026-07-12
- Snapshot: added opt-in `omlx` provider (local oMLX server) alongside the default `ollama-cloud` provider; provider-specific defaults applied in `resolvePluginConfig`; Docker packed-install test and 10-minute CI job caps remain current.
