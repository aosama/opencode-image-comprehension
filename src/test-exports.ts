import { shouldActivateImageComprehension } from "./activation.js";
import { resolvePluginConfig } from "./config.js";
import { resolveLocalImagePath } from "./image-materialization.js";
import { generateImageReferencePrompt } from "./prompt.js";
import { buildOllamaCloudRequest } from "./providers/ollama-cloud.js";

export const __test = {
  buildOllamaCloudRequest,
  generateImageReferencePrompt,
  resolveLocalImagePath,
  resolvePluginConfig,
  shouldActivateImageComprehension,
};
