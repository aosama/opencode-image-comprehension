# Contributing to opencode-image-comprehension

Thank you for your interest in contributing! This guide covers the basics.

## Development Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/aosama/opencode-image-comprehension.git
   cd opencode-image-comprehension
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Build**:
   ```bash
   npm run build
   ```

## Development Workflow

1. Create a branch: `git checkout -b feature/your-feature` or `fix/your-fix`
2. Make your changes in the focused module under `src/`
3. Run format check: `npm run format:check`
4. Build: `npm run build`
5. Run unit tests: `npm run test:unit`
6. Test the packed install path: `npm run test:integration:docker`
7. Test manually by linking into OpenCode when needed

### Testing Locally

Link the built plugin into your OpenCode plugin directory:

```bash
npm run build
ln -sf $(pwd)/dist/index.js ~/.config/opencode/plugin/opencode-image-comprehension.js
```

Then restart OpenCode and paste an image while using a non-vision model.

### Prerequisites for Testing

- An Ollama Cloud API key exported as `OLLAMA_CLOUD_API_KEY` or `OLLAMA_API_KEY`
- A non-vision OpenCode chat model for manual verification
- Docker for `npm run test:integration:docker`

### Release and Updates

- Use SemVer: patch for fixes, minor for additive behavior, major for breaking config/tool contracts.
- Publish fixes to npm so users with `"plugin": ["opencode-image-comprehension"]` can receive the latest package when OpenCode refreshes plugin dependencies.
- Users who need reproducibility can pin `opencode-image-comprehension@x.y.z` and upgrade manually.

## Code Style

- TypeScript strict mode is enabled
- ESM modules (`"type": "module"`)
- Format with Prettier (`npm run format`)
- No runtime dependencies beyond OpenCode peer deps and Node built-ins
- Keep `src/index.ts` as the small plugin entry point; put behavior in focused modules
- Use `client.app.log()` for logging, never `console.log`
- All I/O wrapped in try/catch — the plugin must never crash OpenCode

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: add new feature`
- `fix: resolve issue`
- `docs: update documentation`
- `refactor: restructure code`
- `chore: update dependencies`

## Pull Request Checklist

- [ ] `npm run format:check` passes
- [ ] `npm run build` succeeds with no errors
- [ ] `npm run test:unit` passes
- [ ] `npm run test:integration:docker` passes before publishing
- [ ] No sensitive data or credentials
- [ ] Plugin entry wiring remains in `src/index.ts`; behavior changes live in focused modules
- [ ] Commit messages follow conventional commits format

## Reporting Issues

Please open an issue at [GitHub Issues](https://github.com/aosama/opencode-image-comprehension/issues) with:

1. OpenCode version (`opencode --version`)
2. Your `opencode.json` config (redact any API keys)
3. The model you were using
4. Steps to reproduce
5. Expected vs actual behavior
