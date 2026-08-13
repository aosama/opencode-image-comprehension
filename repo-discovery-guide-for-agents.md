# Repo Discovery Guide — opencode-image-comprehension

> A cached map of non-obvious truths for coding agents working in this repository.

## Maintenance Mandate

Before every commit, update this guide if changed work affects anything it documents. At session start, spot-check 2-3 key facts before trusting the guide. After 90 days, treat `Last verified` as suspect and re-verify. With expensive gotchas, update the guide in the same change that adds, removes, renames, or discovers them. For guide-only reorganization, update `Last verified` but do not invent factual changes.

- Last verified: 2026-08-12 — Spot-checked lifecycle ownership, configuration precedence, source line counts, test suites, and CI workflows. All facts confirmed current.

## Project Overview

A TypeScript OpenCode plugin that enables image comprehension for non-vision LLM models. It intercepts pasted images, saves them as local files, strips unsupported image media from the message, and injects file-path instructions that guide the LLM to call `comprehend_image` with `image_path` and its own `prompt`; the tool calls a configurable vision provider. The default provider is `ollama-cloud` (Ollama Cloud, model `gemma4:31b`); `omlx` targets an oMLX server and `optiq` targets the OptiQ server, both using OpenAI-compatible APIs. The OptiQ default model is `Ornith-1.0-9B-OptiQ-4bit`. Provider defaults live as constants in `src/constants.ts` — change them there, not in docs or tests. Keep `src/index.ts` as entry wiring only; behavior lives in focused modules under `src/`.

## Known Gotchas

- **Unit tests run against built output** — `npm run test:unit` builds first, then runs every `tests/unit/*.test.mjs` file. The suites are split by configuration/activation, plugin hooks, message transforms, provider contracts, and image materialization.
- **Docker packed-install test is the release gate** — `npm run test:integration:docker` packs the tarball, installs it in a clean container, and runs OpenCode with `ollama-cloud/glm-5.2`.
- **`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"` in CI** — GitHub Actions deprecation workaround for `setup-node` runner.
- **Self-contained provider call** — no external skill, local Ollama server, or model pull is required.
- **`ollama-cloud` is the default provider** — the public npm package must keep working for all users. `omlx` is opt-in via project/user config.
- **OptiQ is a separate local provider** — configure `provider: "optiq"` for an already-running `optiq serve` process. It uses port 8080 by default, the OpenAI-compatible content-array image format, disables thinking through `chat_template_kwargs.enable_thinking=false` so the answer appears in `message.content`, and does not send oMLX `thinking_budget`. Set `optiqServer.managed: true` to let the plugin spawn a dedicated runner and gracefully stop it after the configurable idle timeout (10 seconds by default). Managed mode refuses an occupied endpoint instead of claiming or terminating an external server.
- **oMLX specifics** — authentication is optional; without `apiKey` or `OMLX_API_KEY`, the official `openai` JavaScript SDK sends the local placeholder `Bearer omlx-local` and talks to the OpenAI-compatible endpoint. Provider-specific defaults for model/apiKeyEnv/baseUrl apply when provider is `omlx`; the SDK uses the content-array image format, sends the focused image-only system prompt, adds oMLX's 1024-token `thinking_budget` extension, and reads `choices[0].message.content`.
- **Tool accepts local paths** — `comprehend_image` accepts absolute, `file://`, or current-directory-relative local image paths; remote/data URLs are rejected at tool time.
- **Auto activation depends on OpenCode provider metadata** — if capability lookup is unavailable and no patterns are configured, auto mode skips image transformation rather than guessing; vision-capable sessions also get a system instruction and session-scoped `comprehend_image` guard so interleaved sessions do not leak capability state.
- **The OpenAI SDK is a runtime dependency** — `openai` is pinned in `dependencies`; OpenCode packages remain peers and build/test tooling remains in `devDependencies`.
- **`deep-test.ts` uses string-matching** on stdout for tool-call and description evidence — fragile if model wording changes.
- **CI split**: `ci.yml` is offline-safe; `test.yml` skips cloud integration if the secret is absent. Both jobs are capped at 10 minutes.
- **Plugin export shape matters**: server and TUI entrypoints are separate because OpenCode rejects a module exporting both `server()` and `tui()`. The server default export is a v1 object with `id` and `server`; `dist/tui.js` exports the companion `Image Comprehension` `id`/`tui` object.
- **TUI toggle is shared state**: the companion TUI plugin is registered in `~/.config/opencode/tui.json`; OpenCode persists its enabled state under `plugin_enabled` in `$XDG_STATE_HOME/opencode/kv.json` using the `Image Comprehension` key. The server checks this state dynamically before message transforms, system guidance, and tool execution. Missing state means enabled for backward compatibility.
- **Agent guidance split**: `AGENTS.md` is intentionally principle-only; the only repo-local instruction file left is the CI/CD constraint.
- **Turn-scoped canonical temp dirs** — materialized data-URL images live in `$TMPDIR/opencode-image-comprehension/<sessionID>/<messageID>/current-image.png` (and `current-image-2.png` for additional attachments). Replaying a turn reuses these paths instead of creating timestamp duplicates. `handleFileUrl` keeps the original path (no copy). Sweep recursion cleans stale files inside session subdirs and removes empty session dirs.
- **Use `rm({ recursive: true, force: true })` for directory removal** — never `unlink()` (EPERM on directories).
- **Barrel modules preserve public API** — `image-materialization.ts`, `config.ts`, `activation.ts`, and `index.ts` are barrel files that re-export from focused sub-modules. Only originally-public symbols are re-exported from barrels; internal helpers stay in their sub-modules.
- **Pre-commit hook warns on files exceeding 500 lines** — `.husky/pre-commit` checks staged `.ts` files in `src/`. It is a warning only; it does not block commits.

## Conventions

- **No `console.log`** — all logging via `client.app.log()` with structured objects `{ service, level, message }`.
- **Plugin must never crash OpenCode** — every I/O operation inside try/catch.
- **Config precedence**: project-level > user-level > hardcoded defaults. Missing config files are silently skipped.
- **Synthetic text parts**: replacement text parts set `synthetic: true` to mark plugin-created vs user-created.
- **Prettier**: double quotes, semicolons always, trailing commas, 80-char width, 2-space tabs. No ESLint.
- **File size**: coding files must stay under 500 lines. Barrel files re-export from focused sub-modules, and large test suites are split by behavior so each test file remains below the limit.
- **Supported formats**: PNG, JPEG, GIF, WebP, BMP.

## Structure Map

```
opencode-image-comprehension/
├── src/
│   ├── index.ts                     # Plugin entry barrel (delegates to plugin-setup, plugin-hooks)
│   ├── plugin-setup.ts              # Async plugin initialization (config, cleanup, session tracking)
│   ├── optiq-server.ts              # Opt-in managed OptiQ process lifecycle and idle shutdown
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
│   ├── tui-state.ts                 # Reads OpenCode's persisted TUI plugin-enabled state
│   ├── tui.ts                       # Companion TUI entrypoint for the Plugins dialog
│   ├── constants.ts                 # All plugin constants and defaults
│   ├── types.ts                     # TypeScript interfaces and types
│   ├── prompt.ts                    # Prompt template generation
│   ├── test-exports.ts              # Named __test export for unit tests
│   └── providers/
│       ├── ollama-cloud.ts          # Ollama Cloud request/response handling (default)
│       ├── omlx.ts                  # oMLX (local OpenAI-compatible) request/response handling
│       └── optiq.ts                 # OptiQ (local OpenAI-compatible) request/response handling
├── dist/                            # Build output (gitignored)
├── tests/
│   ├── unit/
│   │   ├── config-activation.test.mjs      # Config, activation, and OptiQ journey
│   │   ├── image-materialization.test.mjs  # Image files, paths, and cleanup
│   │   ├── message-transform.test.mjs      # Message rewriting and native vision guards
│   │   ├── plugin-hooks.test.mjs            # Plugin lifecycle, TUI state, and metadata
│   │   ├── provider-contracts.test.mjs      # Provider request/response boundaries
│   │   ├── optiq-lifecycle.test.mjs         # Managed startup, idle shutdown, and ownership safety
│   │   └── test-helpers.mjs                 # Shared filesystem cleanup helper
│   └── integration/
│       ├── deep-test.ts             # Spawns opencode, verifies stdout
│       ├── docker-packed-install-test.sh # npm pack + Docker install test
│       ├── quick-test.sh            # Smoke: build, check API key environment
│       ├── setup-ci.sh              # CI bootstrap
│       └── test-image.png           # 1x1 PNG test image
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                   # Format + build + unit, Node 22/24 matrix
│   │   └── test.yml                 # Integration test (Ollama Cloud chat + vision)
│   └── instructions/
│       └── cicd.instructions.md     # CI/CD constraints only
├── package.json                     # No "dependencies", only devDeps + peerDeps
├── tsconfig.json                    # Strict, ESNext, Node16 resolution
```

## Entry Points

- **Build**: `npm run build` (tsc only, output → `dist/`). No bundler.
- **Unit test**: `npm run test:unit` (builds first, then `node --test tests/unit/*.test.mjs`). This is a non-GPU suite; live local-runner tests are separate and may load models.
- **Packed install test**: `npm run test:integration:docker` (needs Docker and Ollama Cloud key).
- **Format**: `npm run format` (write) or `npm run format:check` (verify-only).
- **Local dev**: Build, then configure `dist/index.js` in `opencode.json` and `dist/tui.js` in `~/.config/opencode/tui.json`. Requires `OLLAMA_CLOUD_API_KEY` or `OLLAMA_API_KEY` for tool execution.
- **CI (offline-safe)**: `.github/workflows/ci.yml` — format, build, unit, shell syntax, package dry run on Node 22/24.
- **CI (optional cloud)**: `.github/workflows/test.yml` — push/PR keeps cloud failures non-blocking; manual dispatch enforces the cloud gate when a secret exists. Plugin config is separate from OpenCode provider config.

## What to Verify

1. **Versions** — Node engine >=22.0.0, CI matrix 22/24. TypeScript ^5.7.0. Peer deps `@opencode-ai/plugin` and `@opencode-ai/sdk` >=1.0.0.
2. **Paths** — Config files at `~/.config/opencode/opencode-image-comprehension.json` and `.opencode/opencode-image-comprehension.json`.
3. **Vision detection** — OpenCode `client.provider.list()` shape may expose either `modalities.input` or `capabilities.input.image`; plugin supports both.
4. **Provider config** — `provider`, `model`, `apiKeyEnv`, `baseUrl`, `timeoutSeconds`, `optiqServer`, and `activation` parse as expected. `omlx` and `optiq` providers use their local-runner defaults.
5. **Config merging** — Project > user > default precedence. Partial configs don't clobber unrelated keys.
6. **CI secrets** — `OLLAMA_CLOUD_API_KEY` or legacy `OLLAMA_CLOUD_APIKEY` valid for both chat model and image comprehension model.

## Maintenance Snapshot

- Last verified: 2026-08-12
- Snapshot: Source includes separate server/TUI entrypoints, dynamic TUI state gating, a configurable OptiQ provider, and an opt-in managed OptiQ runner with endpoint ownership checks and idle-shutdown race protection. Unit coverage is split into behavior-focused files under the 500-line repository limit. The pre-commit hook remains warning-only for oversized staged source files.
