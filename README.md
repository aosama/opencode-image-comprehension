# opencode-image-comprehension

An [OpenCode](https://opencode.ai) plugin that enables image comprehension for **any non-vision model** using a local Ollama vision model.

When you paste an image in OpenCode while using a model that doesn't support vision, this plugin automatically intercepts the image, saves it, and injects instructions telling the model to call the `comprehend_image` tool — which runs a local Ollama vision model to describe the image.

## How It Works

```
1. You paste an image in OpenCode (using a non-vision model)
2. Plugin detects the model lacks vision capabilities
3. Plugin saves the image to a temp file (or passes the URL through)
4. Plugin strips the image parts from the message (the model can't handle them anyway)
5. Plugin injects text: "The user has shared an image. Use the comprehend_image tool to analyze it."
6. The LLM calls the comprehend_image tool with the file path
7. The tool runs Ollama's vision model locally and returns a detailed description
8. The LLM uses the description to answer your question
```

## Prerequisites

### 1. Ollama

Install from [ollama.com](https://ollama.com). The plugin auto-starts Ollama if it's not running (on macOS it uses the app bundle, on Linux it runs `ollama serve`).

### 2. Vision Model

The default model is **moondream:1.8b** (~1.6 GB, works on CPU). The plugin will auto-pull it on first use if it's not installed. You can also pre-install:

```bash
ollama pull moondream:1.8b
```

### 3. image-comprehension-ollama Skill

The plugin relies on the [image-comprehension-ollama](https://github.com/aosama/image-comprehension-ollama) skill for the actual image analysis. The plugin will attempt to auto-install it via `npx skills add` if it's not found.

You can also install it manually:

```bash
npx skills add aosama/image-comprehension-ollama
```

## Installation

### Via npm (recommended)

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-image-comprehension"]
}
```

OpenCode will automatically install the npm package on startup.

### Local Development

```bash
git clone https://github.com/aosama/opencode-image-comprehension.git
cd opencode-image-comprehension
npm install
npm run build
ln -sf $(pwd)/dist/index.js ~/.config/opencode/plugin/opencode-image-comprehension.js
```

## Configuration

Create a config file at either location (project config takes precedence):

- **Project**: `.opencode/opencode-image-comprehension.json`
- **User**: `~/.config/opencode/opencode-image-comprehension.json`

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `models` | `string[]` | _(auto-detect)_ | Model glob patterns to activate on. If omitted, the plugin auto-detects non-vision models. Supports wildcards: `anthropic/*`, `*/codestral`, `*deepseek*`, `*` |
| `visionModel` | `string` | `"moondream:1.8b"` | Ollama vision model to use for image analysis |
| `promptTemplate` | `string` | _(default prompt)_ | Custom prompt template. Must contain at least one of: `{imageList}`, `{imageCount}`, `{toolName}`, `{userText}` |
| `skillPath` | `string` | _(auto-resolve)_ | Absolute path to the `comprehend_image.sh` script. If omitted, searches default locations |
| `autoPullModel` | `boolean` | `true` | Whether to auto-pull the Ollama vision model if it's not installed |

### Example Config

```json
{
  "visionModel": "llava:7b",
  "autoPullModel": true,
  "promptTemplate": "I'm attaching {imageCount} image(s) for you to analyze.\n\nImages:\n{imageList}\n\nUse the `{toolName}` tool on each one.\n\nMy question: {userText}"
}
```

### Explicit Model Targeting

By default, the plugin auto-detects whether a model supports vision by checking the model's capabilities. If you want to explicitly control which models the plugin activates on, use the `models` config:

```json
{
  "models": ["deepseek/*", "*/codestral", "qwen/*"]
}
```

When `models` is set, the plugin activates **only** for matching models, regardless of their capabilities.

## Recommended Vision Models

| Model | Size | Quality | Best for |
|-------|------|---------|----------|
| `moondream:1.8b` | ~1.6 GB | Good | **Default.** Tiny, works on CPU, fast downloads |
| `minicpm-v:2.6` | ~2.5 GB | Very good | Better accuracy, still lightweight |
| `llava:7b` | ~4.7 GB | Strong | High-quality descriptions, needs GPU for speed |
| `gemma4:e2b` | ~7.2 GB | Excellent | Best quality, needs disk space and GPU |

To switch models:

```json
{
  "visionModel": "llava:7b"
}
```

Or set the environment variable:
```bash
export OLLAMA_VISION_MODEL=llava:7b
```

## Transparency

The plugin is designed to keep you fully informed. On startup, it logs:

- Whether the `image-comprehension-ollama` skill is installed (and auto-installs it if not)
- Whether Ollama is running and the vision model is available (and auto-pulls it if missing, when `autoPullModel` is true)
- The vision model being used and its configuration source
- Whether model detection is auto-detect or pattern-based

When processing an image:

- Which model was detected as non-vision and why
- How many images were found and where they were saved
- The prompt being injected to guide the model
- Tool execution progress and results
- Clear error messages when something goes wrong, with actionable steps

## Supported Image Formats

- PNG (`.png`)
- JPEG (`.jpg`, `.jpeg`)
- GIF (`.gif`)
- WebP (`.webp`)
- BMP (`.bmp`)

## How Images Are Handled

| URL Scheme | How It's Handled |
|-----------|-----------------|
| `file://` | Stripped to local path, passed to tool directly |
| `data:` (clipboard paste) | Base64-decoded and saved to temp file |
| `http://` / `https://` | URL passed through, tool fetches it directly |

## License

MIT