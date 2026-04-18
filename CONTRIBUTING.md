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
2. Make your changes in `src/index.ts` (single-file architecture)
3. Run format check: `npm run format:check`
4. Build: `npm run build`
5. Test manually by linking into OpenCode

### Testing Locally

Link the built plugin into your OpenCode plugin directory:

```bash
npm run build
ln -sf $(pwd)/dist/index.js ~/.config/opencode/plugin/opencode-image-comprehension.js
```

Then restart OpenCode and paste an image while using a non-vision model.

### Prerequisites for Testing

- [Ollama](https://ollama.com) installed and running
- A vision model pulled (e.g., `ollama pull moondream:1.8b`)
- The `image-comprehension-ollama` skill installed:
  ```bash
  npx skills add aosama/image-comprehension-ollama
  ```

## Code Style

- TypeScript strict mode is enabled
- ESM modules (`"type": "module"`)
- Format with Prettier (`npm run format`)
- No runtime dependencies beyond OpenCode peer deps and Node built-ins
- All plugin logic in `src/index.ts`
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
- [ ] No sensitive data or credentials
- [ ] Changes are in `src/index.ts` only (single-file architecture)
- [ ] Commit messages follow conventional commits format

## Reporting Issues

Please open an issue at [GitHub Issues](https://github.com/aosama/opencode-image-comprehension/issues) with:

1. OpenCode version (`opencode --version`)
2. Your `opencode.json` config (redact any API keys)
3. The model you were using
4. Steps to reproduce
5. Expected vs actual behavior