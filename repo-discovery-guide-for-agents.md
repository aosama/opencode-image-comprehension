# Repo Discovery Guide — opencode-image-comprehension

> A cached map of non-obvious truths for coding agents working in this repository.

## Maintenance Mandate

1. **Before every commit**, ask: did I change anything this guide documents? If yes, update the guide in the same commit. No exceptions.
2. **At session start**, spot-check 2-3 key facts against the actual codebase (paths, versions, script names). If anything drifted, update immediately.
3. **Quarterly minimum**, re-verify if the repo hasn't been touched. Stale guidance is worse than no guidance.

- Last verified: 2026-04-30
- Changes since last verify: initial creation

## Project Overview

A TypeScript single-file OpenCode plugin that enables image comprehension for non-vision LLM models. It intercepts pasted images, saves them to temp files, strips them from the message, and injects text instructions that guide the LLM to call a `comprehend_image` tool — which shells out to a local Ollama vision model (default: `moondream:1.8b`). The single most important architectural fact: **all ~910 lines of plugin logic reside in a single file (`src/index.ts`) with zero runtime dependencies** — only `@opencode-ai/plugin` and `@opencode-ai/sdk` as peer deps plus Node.js built-ins. No unit tests exist, only integration tests.

## Known Gotchas

- **No unit tests, no test framework** — by design ("single-file architecture, no test framework configured"). Only integration tests under `tests/integration/`.
- **`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"` in CI** — GitHub Actions deprecation workaround for `setup-node` runner.
- **`VISION_MODEL_PATTERNS` is hardcoded** (kimi, claude, gpt-4, etc.) — new vision models not matching patterns will be incorrectly treated as non-vision.
- **`resolveSkillScriptPath()` returns path even when file doesn't exist** — logs warning but returns path. Error only surfaces at tool invocation time, not startup.
- **`ensureSkillInstalled()` has 120-second timeout** on `npx skills add`. Slow network means plugin starts with skill not-ready.
- **Integration test uses `--dangerously-skip-permissions`** — would not work in production setup.
- **`package.json` has no `dependencies`** — only `devDependencies` + `peerDependencies`. Relies on host (OpenCode) to provide peer packages.
- **`deep-test.ts` uses string-matching** on stdout for verification — fragile, may break if model changes descriptive style.
- **CI matrix**: `ci.yml` tests Node 20/22/24, `test.yml` pins Node 22 only. Could mask issues on other versions.
- **Naming constant mismatch**: `PLUGIN_NAME = "image-comprehension"` differs from npm package name (`opencode-image-comprehension`). No single source of truth.

## Conventions

- **No `console.log`** — all logging via `client.app.log()` with structured objects `{ service, level, message }`.
- **Plugin must never crash OpenCode** — every I/O operation inside try/catch.
- **Config precedence**: project-level > user-level > hardcoded defaults. Missing config files are silently skipped.
- **Synthetic text parts**: replacement text parts set `synthetic: true` to mark plugin-created vs user-created.
- **Prettier**: double quotes, semicolons always, trailing commas, 80-char width, 2-space tabs. No ESLint.
- **Conventional Commits**: `feat:`, `fix:`, `docs:`. Branch: `feature/*`, `fix/*`, `docs/*`.
- **Supported formats**: PNG, JPEG, GIF, WebP, BMP.

## Structure Map

```
opencode-image-comprehension/
├── src/
│   └── index.ts                     # THE ENTIRE PLUGIN (~910 lines)
├── dist/                            # Build output (gitignored)
├── tests/
│   └── integration/
│       ├── deep-test.ts             # Spawns opencode, verifies stdout
│       ├── quick-test.sh            # Smoke: build, check skill, check Ollama
│       ├── setup-ci.sh              # CI bootstrap
│       └── test-image.png           # 1x1 PNG test image
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                   # Format + build, Node 20/22/24 matrix
│   │   └── test.yml                 # Integration test (Ollama Cloud + local vision)
│   └── instructions/                # Agent instruction files
├── package.json                     # No "dependencies", only devDeps + peerDeps
├── tsconfig.json                    # Strict, ESNext, Node16 resolution
├── .prettierrc.json
├── AGENTS.md                        # Agent instructions + architecture
├── README.md
└── LICENSE                          # MIT
```

## Entry Points

- **Build**: `npm run build` (tsc only, output → `dist/`). No bundler.
- **Format**: `npm run format` (write) or `npm run format:check` (verify-only).
- **Local dev**: Build, then symlink: `ln -sf $(pwd)/dist/index.js ~/.config/opencode/plugin/opencode-image-comprehension.js`. Requires Ollama running, vision model pulled, skill installed.
- **CI (format+build)**: `.github/workflows/ci.yml` — push/PR to main. Node 20/22/24.
- **CI (integration)**: `.github/workflows/test.yml` — needs `OLLAMA_CLOUD_APIKEY` secret. Installs Ollama, pulls model, installs skill, runs deep-test.
- **Gotcha**: `npx skills add aosama/image-comprehension-ollama` is required once before first use.

## What to Verify

1. **Versions** — Node engine >=18.0.0, CI matrix 20/22/24. TypeScript ^5.7.0. Peer deps `@opencode-ai/plugin` and `@opencode-ai/sdk` >=1.0.0.
2. **Paths** — Config files at `~/.config/opencode/opencode-image-comprehension.json` and `.opencode/opencode-image-comprehension.json`. Skill script at `~/.agents/skills/image-comprehension-ollama/scripts/comprehend_image.sh`.
3. **Vision detection** — `VISION_MODEL_PATTERNS` list current. New vision models may not match.
4. **Skill auto-install** — `npx skills add` repo still accessible. 120s timeout sufficient.
5. **Config merging** — Project > user > default precedence. Partial configs don't clobber unrelated keys.
6. **CI secrets** — `OLLAMA_CLOUD_APIKEY` valid. Model cache key may need bump if model changes.
7. **Supported formats** — `SUPPORTED_MIME_TYPES` covers all formats OpenCode may pass through.

## Maintenance Snapshot

- Last verified: 2026-04-30
- Changes since last verify: initial creation
