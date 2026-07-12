import type { ActivationMode } from "./types.js";

// The plugin id is shorter than the npm package name because this is the service
// name users see in OpenCode logs/tool metadata.
export const PLUGIN_NAME = "image-comprehension";
export const TOOL_NAME = "comprehend_image";
export const CONFIG_FILENAME = "opencode-image-comprehension.json";
export const TEMP_DIR_NAME = "opencode-image-comprehension";

// Keep defaults in one module so config parsing, docs, tests, and provider calls
// do not drift independently.
export const DEFAULT_PROVIDER: "ollama-cloud" = "ollama-cloud";
export const DEFAULT_VISION_MODEL = "gemma4:31b";
export const DEFAULT_API_KEY_ENV = "OLLAMA_CLOUD_API_KEY";
export const DEFAULT_OLLAMA_CLOUD_URL = "https://ollama.com/api/chat";
export const DEFAULT_TIMEOUT_SECONDS = 180;
export const DEFAULT_ACTIVATION_MODE: ActivationMode = "auto";
export const DEFAULT_IMAGE_PROMPT = "Describe this image in detail";

// oMLX provider constants. Used when a project configures provider: "omlx"
// to use a local oMLX server instead of Ollama Cloud.
export const DEFAULT_OMLX_URL = "http://localhost:8000/v1/chat/completions";
export const DEFAULT_OMLX_MODEL = "Ornith-1.0-9B-8bit";
export const DEFAULT_OMLX_API_KEY_ENV = "OMLX_API_KEY";

// Supported MIME types are the plugin's public image format contract. Any format
// added here must also be accepted by local-path validation and documented.
export const SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

export const MIME_TO_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

// The LLM-facing tool accepts arbitrary local paths, so extension lookup is the
// current lightweight MIME inference mechanism for those paths.
export const EXTENSION_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

export const PROMPT_TEMPLATE_VARIABLES = [
  "{imageList}",
  "{imageCount}",
  "{toolName}",
  "{userText}",
] as const;
