# opencode-image-comprehension

An [OpenCode](https://opencode.ai) plugin that enables image comprehension for **any non-vision model** using a configurable Ollama Cloud vision model.

When you paste an image in OpenCode while using a model that doesn't support vision, this plugin automatically intercepts the image, saves it as a local file, and injects instructions telling the model it can call the `comprehend_image` tool with an `image_path` and its own visual-analysis `prompt`.

## How It Works

```
1. You paste an image in OpenCode (using a non-vision model)
2. Plugin detects the model lacks vision capabilities
3. Plugin saves the image to a local temp file
4. Plugin strips the image parts from the message (the model can't handle them anyway)
5. Plugin injects the local image path and explains the `comprehend_image` tool contract
6. The LLM calls `comprehend_image` with `image_path` and a prompt it chooses
7. The tool calls the configured Ollama Cloud vision model and returns text
8. The LLM uses the tool result to answer your question
```

## Prerequisites

### Ollama Cloud API Key

```bash
export OLLAMA_CLOUD_API_KEY=...
```

The plugin also accepts `OLLAMA_API_KEY` as a fallback. No local Ollama server, local model pull, or external skill installation is required.

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

Use the unpinned package name when you want OpenCode to resolve the latest published plugin version:

```json
{
  "plugin": ["opencode-image-comprehension"]
}
```

Pin an exact version when you want reproducible installs and manual upgrades:

```json
{
  "plugin": ["opencode-image-comprehension@1.0.0"]
}
```

### Local Development

```bash
git clone https://github.com/aosama/opencode-image-comprehension.git
cd opencode-image-comprehension
npm install
npm run build
ln -sf $(pwd)/dist/index.js ~/.config/opencode/plugin/opencode-image-comprehension.js
```

### Packed Install Test

To verify the same package shape end users receive from npm, run:

```bash
npm run test:integration:docker
```

This builds the plugin, runs `npm pack`, installs the tarball in a clean Docker container, configures OpenCode with `ollama-cloud/glm-5.2`, and asserts that the installed package invokes `comprehend_image` with `image_path`.

## Configuration

Create a config file at either location (project config takes precedence):

- **Project**: `.opencode/opencode-image-comprehension.json`
- **User**: `~/.config/opencode/opencode-image-comprehension.json`

### Configuration Options

| Option           | Type       | Default                         | Description                                                                                                     |
| ---------------- | ---------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `provider`       | `string`   | `"ollama-cloud"`                | Vision provider. Only `ollama-cloud` is supported currently                                                     |
| `model`          | `string`   | `"gemma4:31b"`                  | Ollama Cloud vision model to use for image analysis                                                             |
| `apiKey`         | `string`   | _(env)_                         | API key value. Prefer `apiKeyEnv` or environment variables instead of committing this                           |
| `apiKeyEnv`      | `string`   | `"OLLAMA_CLOUD_API_KEY"`        | Environment variable to read the API key from                                                                   |
| `baseUrl`        | `string`   | `"https://ollama.com/api/chat"` | Ollama-compatible chat endpoint                                                                                 |
| `timeoutSeconds` | `number`   | `180`                           | Timeout for image download and provider request                                                                 |
| `activation`     | `string`   | `"auto"`                        | Activation mode: `auto`, `force`, `disabled`, or `patterns`                                                     |
| `models`         | `string[]` | _(unset)_                       | Model glob patterns used by `patterns` mode or as an `auto` fallback when OpenCode metadata is unavailable      |
| `promptTemplate` | `string`   | _(default prompt)_              | Custom prompt template. Must contain at least one of: `{imageList}`, `{imageCount}`, `{toolName}`, `{userText}` |

Legacy configs that use `visionModel` still work when `model` is absent, but new configs should use `model`.

### Example Config

```json
{
  "provider": "ollama-cloud",
  "model": "gemma4:31b",
  "apiKeyEnv": "OLLAMA_CLOUD_API_KEY",
  "promptTemplate": "I'm attaching {imageCount} image(s).\n\nLocal image paths:\n{imageList}\n\nUse `{toolName}` with image_path and your chosen prompt when you need visual details.\n\nMy question: {userText}"
}
```

### Explicit Model Targeting

By default, the plugin asks OpenCode for the active model's input modalities and only activates when that model does not support image input. If you want to explicitly control which models the plugin activates on, use `activation: "patterns"` with the `models` config:

```json
{
  "activation": "patterns",
  "models": ["deepseek/*", "*/codestral", "qwen/*"]
}
```

When `activation` is `patterns`, the plugin activates **only** for matching models, regardless of their capabilities.

## Recommended Vision Models

| Model              | Quality   | Best for                                                            |
| ------------------ | --------- | ------------------------------------------------------------------- |
| `gemma4:31b`       | Excellent | **Default.** Strong general image descriptions through Ollama Cloud |
| `llava:latest`     | Strong    | Broad compatibility with Ollama-style image prompts                 |
| `minicpm-v:latest` | Very good | Lightweight vision-language descriptions                            |

To switch models:

```json
{
  "model": "llava:latest"
}
```

## Transparency

The plugin is designed to keep you fully informed. On startup, it logs:

- The configured provider, endpoint, timeout, and vision model
- Whether model detection is OpenCode metadata-based or pattern-based

When processing an image:

- Which model was detected as non-vision and why
- How many images were found and where they were saved
- The image file paths and tool instructions injected to guide the model
- Tool execution progress and results
- Clear error messages when something goes wrong, with actionable steps

## Supported Image Formats

- PNG (`.png`)
- JPEG (`.jpg`, `.jpeg`)
- GIF (`.gif`)
- WebP (`.webp`)
- BMP (`.bmp`)

## How Images Are Handled

| Input                                  | How It's Handled                                                    |
| -------------------------------------- | ------------------------------------------------------------------- |
| Attached `file://` image               | Converted to a local path and shown to the LLM                      |
| Attached `data:` image                 | Base64-decoded, saved to a temp file, and shown to the LLM          |
| Tool `image_path` absolute             | Read directly from the local filesystem                             |
| Tool `image_path` relative             | Resolved relative to the current OpenCode directory                 |
| Tool `http://`, `https://`, or `data:` | Rejected; `comprehend_image` intentionally accepts local paths only |

## License

MIT
