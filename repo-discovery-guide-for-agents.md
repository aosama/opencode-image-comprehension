# Repo Discovery Guide — opencode-image-comprehension

> A cached map of non-obvious truths for coding agents working in this repository.

## Maintenance Mandate

Before every commit, update this guide if changed work affects anything it documents. At session start, spot-check 2-3 key facts before trusting the guide. After 90 days, treat `Last verified` as suspect and re-verify. With expensive gotchas, update the guide in the same change that adds, removes, renames, or discovers them. For guide-only reorganization, update `Last verified` but do not invent factual changes.

- Last verified: 2026-07-20 — Decomposed image-materialization, config, activation, and index into barrel + sub-modules. All source files now under 180 lines. Pre-commit hook warns on files exceeding 500 lines. All 36 unit tests pass.

## Project Overview

A TypeScript OpenCode plugin that enables image comprehension for non-vision LLM models. It intercepts pasted images, saves them as local files, strips unsupported image media from the message, and injects file-path instructions that guide the LLM to call `comprehend_image` with `image_path` and its own `prompt`; the tool calls a configurable vision provider. The default provider is `ollama-cloud` (Ollama Cloud, model `gemma4:31b`); an opt-in `omlx` provider targets a local oMLX server (OpenAI-compatible API, model `Ornith-1.0-9B-6bit`). The model name lives as a single constant (`DEFAULT_OMLX_MODEL`) in `src/constants.ts` — change it there, not in docs or tests. Keep `src/index.ts` as entry wiring only; behavior lives in focused modules under `src/`.

## Known Gotchas

- **Unit tests run against built output** — `npm run test:unit` builds first, then runs `node --test tests/unit/index.test.mjs`.
- **Docker packed-install test is the release gate** — `npm run test:integration:docker` packs the tarball, installs it in a clean container, and runs OpenCode with `ollama-cloud/glm-5.2`.
- **`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"` in CI** — GitHub Actions deprecation workaround for `setup-node` runner.
- **Self-contained provider call** — no external skill, local Ollama server, or model pull is required.
- **`ollama-cloud` is the default provider** — the public npm package must keep working for all users. `omlx` is opt-in via project/user config.
- **oMLX specifics** — authentication is optional; without `apiKey` or `OMLX_API_KEY`, the plugin omits `Authorization`. Uses OpenAI-compatible wire format (content array with `text` + `image_url` data URL; response from `choices[0].message.content`). Provider-specific defaults for model/apiKeyEnv/baseUrl apply when provider is `omlx`.
- **Tool accepts local paths** — `comprehend_image` accepts absolute, `file://`, or current-directory-relative local image paths; remote/data URLs are rejected at tool time.
- **Auto activation depends on OpenCode provider metadata** — if capability lookup is unavailable and no patterns are configured, auto mode skips image transformation rather than guessing; vision-capable sessions also get a system instruction and session-scoped `comprehend_image` guard so interleaved sessions do not leak capability state.
- **`package.json` has no `dependencies`** — only `devDependencies` + `peerDependencies`. Relies on host (OpenCode) to provide peer packages.
- **`deep-test.ts` uses string-matching** on stdout for tool-call and description evidence — fragile if model wording changes.
- **CI split**: `ci.yml` is offline-safe; `test.yml` skips cloud integration if the secret is absent. Both jobs are capped at 10 minutes.
- **Plugin export shape matters**: default export is a v1 object with `id` and `server`; named `__test` exports would break legacy loading if default were just a function.
- **Agent guidance split**: `AGENTS.md` is intentionally principle-only; the only repo-local instruction file left is the CI/CD constraint.
- **Session-scoped temp dirs** — materialized images live in `$TMPDIR/opencode-image-comprehension/<sessionID>/`. `SavedImage.sessionID` is optional. `handleDataUrl` copies to the session dir; `handleFileUrl` keeps the original path (no copy). Sweep recursion cleans stale files inside session subdirs and removes empty session dirs.
- **Use `rm({ recursive: true, force: true })` for directory removal** — never `unlink()` (EPERM on directories).
- **Barrel modules preserve public API** — `image-materialization.ts`, `config.ts`, `activation.ts`, and `index.ts` are barrel files that re-export from focused sub-modules. Only originally-public symbols are re-exported from barrels; internal helpers stay in their sub-modules.
- **Pre-commit hook warns on files exceeding 500 lines** — `.git/hooks/pre-commit` checks staged `.ts` files in `src/`. It is a warning only; it does not block commits.

## Conventions

- **No `console.log`** — all logging via `client.app.log()` with structured objects `{ service, level, message }`.
- **Plugin must never crash OpenCode** — every I/O operation inside try/catch.
- **Config precedence**: project-level > user-level > hardcoded defaults. Missing config files are silently skipped.
- **Synthetic text parts**: replacement text parts set `synthetic: true` to mark plugin-created vs user-created.
- **Prettier**: double quotes, semicolons always, trailing commas, 80-char width, 2-space tabs. No ESLint.
- **File size**: source files should stay under 180 lines. Barrel files re-export from focused sub-modules. If a file grows past 200 lines, consider decomposition.
- **Supported formats**: PNG, JPEG, GIF, WebP, BMP.

## Structure Map

```
opencode-image-comprehension/
├── src/
│   ├── index.ts                     # Plugin entry barrel (delegates to plugin-setup, plugin-hooks)
│   ├── plugin-setup.ts              # Async plugin initialization (config, cleanup, session tracking)
│   ├── plugin-hooks.ts              # Chat messages transform, system transform, tool creation
│   ├── config.ts                    # Barrel: re-exports from config-paths, config-parse, config-resolve
│   ├── config-paths.ts              # getUserConfigPath, getProjectConfigPath
│   ├── config-parse.ts              # parseConfigObject and all parse* functions
│   ├── config-resolve.ts            # selectWithPrecedence, resolvePluginConfig, loadPluginConfig
│   ├── activation.ts                # Barrel: re-exports from activation-patterns, -decide, -resolve
│   ├── activation-patterns.ts       # Wildcard/pattern matching for model activation
│   ├── activation-decide.ts         # shouldActivateImageComprehension decision logic
│   ├── activation-resolve.ts        # Model capability detection, provider metadata lookup
│   ├── image-materialization.ts     # Barrel: re-exports from image-detection, -save, -process, -sweep, -validate
│   ├── image-detection.ts           # isImageFilePart, parseBase64DataUrl
│   ├── image-save.ts                # ensureTempDir, saveImageToTemp, buildImageFilename
│   ├── image-process.ts             # processImagePart, extractImagesFromParts, handleFile/DataUrl
│   ├── image-sweep.ts              # sweepStaleTempImages, isMaterializedImageFilename
│   ├── image-validate.ts            # resolveLocalImagePath, readLocalImage, readLocalImageAsBase64
│   ├── message-transform.ts         # Non-vision message rewrite
│   ├── comprehend-tool.ts           # comprehend_image tool definition; dispatches by provider
│   ├── constants.ts                 # All plugin constants and defaults
│   ├── types.ts                     # TypeScript interfaces and types
│   ├── prompt.ts                    # Prompt template generation
│   ├── test-exports.ts              # Named __test export for unit tests
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

- Last verified: 2026-07-20
- Snapshot: Decomposed image-materialization (was 395 lines → barrel + 5 sub-modules), config (was 282 → barrel + 3), activation (was 149 → barrel + 3), index (was 171 → barrel + 2). All source files now under 180 lines. Pre-commit hook (`.git/hooks/pre-commit`) warns on files exceeding 500 lines. Barrel files preserve public API — `test-exports.ts` imports unchanged. All 36 unit tests pass.
