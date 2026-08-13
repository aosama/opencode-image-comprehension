# opencode-image-comprehension

An [OpenCode](https://opencode.ai) plugin that enables image comprehension for **any non-vision model** using a configurable Ollama Cloud vision model.

When you paste an image in OpenCode while using a model that doesn't support vision, this plugin automatically intercepts the image, saves it as a local file, and injects instructions telling the model it can call the `comprehend_image` tool with an `image_path` and its own visual-analysis `prompt`.

## How It Works

1. You paste an image in OpenCode (using a non-vision model)
2. Plugin detects the model lacks vision capabilities
3. Plugin saves the image to a turn-scoped local temp directory using a canonical name such as `current-image.png` so retries reuse the same path instead of creating confusing duplicates
4. Plugin strips the image parts from the message (the model can't handle them anyway)
5. Plugin injects the local image path and explains the `comprehend_image` tool contract
6. The LLM calls `comprehend_image` with `image_path` and a prompt it chooses
7. The tool calls the configured Ollama Cloud vision model and returns text
8. The LLM uses the tool result to answer your question

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

### TUI enable/disable

The server plugin is paired with a small TUI plugin so its runtime state can be
controlled from OpenCode's **Plugins** dialog. Add the TUI entry to
`~/.config/opencode/tui.json`:

```json
{
  "plugin": [
    "file:///absolute/path/to/opencode-image-comprehension/dist/tui.js"
  ]
}
```

The companion appears as **Image Comprehension** in the Plugins dialog. The TUI
plugin manager persists the toggle in OpenCode's state file, and the server
plugin reads that persisted state before transforming messages, adding native
vision guidance, or executing `comprehend_image`. Disabled state takes
precedence over the activation setting. If the state is absent, the plugin is
enabled for backward compatibility.

The existing capability guard remains in force: when OpenCode reports that the
active model supports native image input, image parts are left untouched and
`comprehend_image` refuses the fallback call.

### Local Development

```bash
git clone https://github.com/aosama/opencode-image-comprehension.git
cd opencode-image-comprehension
npm install
npm run build
# Keep dist/index.js in opencode.json and dist/tui.js in ~/.config/opencode/tui.json
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
| `provider`       | `string`   | `"ollama-cloud"`                | Vision provider. `ollama-cloud` (default), `omlx` (oMLX server), or `optiq` (OptiQ server)                      |
| `model`          | `string`   | `"gemma4:31b"`                  | Vision model to use for image analysis. OptiQ defaults to `Ornith-1.0-9B-OptiQ-4bit`                            |
| `apiKey`         | `string`   | _(env)_                         | API key value. Prefer `apiKeyEnv` or environment variables instead of committing this                           |
| `apiKeyEnv`      | `string`   | `"OLLAMA_CLOUD_API_KEY"`        | Environment variable to read the API key from. Defaults to the selected local provider's key variable           |
| `baseUrl`        | `string`   | `"https://ollama.com/api/chat"` | Provider chat endpoint. Local defaults are port `8000` for oMLX and `8080` for OptiQ                            |
| `timeoutSeconds` | `number`   | `180`                           | Timeout for image download and provider request                                                                 |
| `optiqServer`    | `object`   | _(external server)_             | Optional managed OptiQ runner configuration; managed runners gracefully stop after being idle                   |
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

### Using a Local oMLX Server (Alternative Provider)

By default the plugin uses Ollama Cloud, which works for everyone with an API key. If you run a local [oMLX](https://github.com/jundot/omlx) server (an Apple Silicon MLX inference server with an OpenAI-compatible API), you can switch the vision backend to it by setting `provider: "omlx"`:

```json
{
  "provider": "omlx"
}
```

With just that one line, the plugin automatically uses oMLX-appropriate defaults for the other fields:

| Field       | oMLX default                                |
| ----------- | ------------------------------------------- |
| `model`     | `Ornith-1.0-9B-OptiQ-4bit`                  |
| `baseUrl`   | `http://localhost:8000/v1/chat/completions` |
| `apiKeyEnv` | `OMLX_API_KEY`                              |

Authentication is optional for oMLX. If your server has API key verification
disabled, no real key or environment variable is needed. Because the official
OpenAI SDK requires an API-key-shaped value, the plugin sends the harmless local
placeholder `Bearer omlx-local` when no real key is configured; oMLX ignores it
when authentication is disabled. If your server enforces authentication, set
`OMLX_API_KEY` or configure `apiKey`/`apiKeyEnv` explicitly.

The oMLX provider uses OpenAI's official JavaScript SDK (`openai`), pinned to
the current stable version, against oMLX's OpenAI-compatible
`/v1/chat/completions` endpoint. The SDK is configured with oMLX's base URL and
the plugin's timeout; retries are disabled so a provider failure is reported
once rather than issuing duplicate image requests.

For every oMLX image request, the plugin also sends a focused system message
and the oMLX `thinking_budget: 1024` extension. The 1024-token limit applies to
the vision model's reasoning phase; it is separate from the OpenCode chat
model's reasoning configuration.

Override any oMLX default the same way you would for Ollama Cloud:

```json
{
  "provider": "omlx",
  "model": "your-mlx-model",
  "baseUrl": "http://my-host:9000/v1/chat/completions",
  "apiKeyEnv": "MY_OMLX_KEY"
}
```

### Using a local OptiQ server

For OptiQ quants with vision sidecars, use the OptiQ runner instead of oMLX's
`mlx-vlm` loader. Start the server from the environment where OptiQ is
installed:

```bash
optiq serve \
  --model mlx-community/Ornith-1.0-9B-OptiQ-4bit \
  --host 127.0.0.1 \
  --port 8080
```

Then configure the plugin:

```json
{
  "provider": "optiq",
  "model": "Ornith-1.0-9B-OptiQ-4bit"
}
```

By default, OptiQ is externally managed: the plugin connects to an existing
server and never terminates it. To let this plugin own a dedicated runner,
enable managed mode. The default idle timeout is 10 seconds:

```json
{
  "provider": "optiq",
  "optiqServer": {
    "managed": true,
    "command": "optiq",
    "modelPath": "/Users/ahmedhamdy/.omlx/models/mlx-community/Ornith-1.0-9B-OptiQ-4bit",
    "host": "127.0.0.1",
    "port": 8080,
    "idleTimeoutSeconds": 10
  }
}
```

In managed mode the plugin starts `optiq serve` on the configured port when
the first image job arrives, reuses it for concurrent/nearby jobs, and sends
`SIGTERM` after the configured idle period so OptiQ can release its MLX model
and GPU buffers. A forced kill is used only if graceful shutdown does not
finish within five seconds. The plugin never terminates a server when
`managed` is false. Managed mode also refuses to start when its host and port
already respond, preventing the plugin from claiming or later terminating an
externally owned runner. When `baseUrl` is omitted, it is derived from the
managed `host` and `port`.

The OptiQ provider uses the OpenAI-compatible `/v1/chat/completions` endpoint,
sends image data as an `image_url` data URL, and does not send oMLX-specific
extensions. Authentication is optional for local development; the provider
uses `OPTIQ_API_KEY` when configured and otherwise sends the harmless
`sk-optiq-local` placeholder.

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

| Input                                  | How It's Handled                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Attached `file://` image               | Converted to a local path and shown to the LLM                                   |
| Attached `data:` image                 | Base64-decoded, saved to a turn-scoped canonical temp file, and shown to the LLM |
| Tool `image_path` absolute             | Read directly from the local filesystem                                          |
| Tool `image_path` relative             | Resolved relative to the current OpenCode directory                              |
| Tool `http://`, `https://`, or `data:` | Rejected; `comprehend_image` intentionally accepts local paths only              |

## License

MIT
