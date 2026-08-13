import { shouldActivateImageComprehension } from "./activation.js";
import { resolvePluginConfig } from "./config.js";
import { parseConfigObject } from "./config-parse.js";
import { resolveLocalImagePath } from "./image-materialization.js";
import { generateImageReferencePrompt } from "./prompt.js";
import { buildOllamaCloudRequest } from "./providers/ollama-cloud.js";
import { buildOmlxRequest } from "./providers/omlx.js";
import { buildOmlxSdkClientOptions } from "./providers/omlx.js";
import { buildOptiqRequest } from "./providers/optiq.js";
import {
  OMLX_IMAGE_SYSTEM_PROMPT,
  OMLX_THINKING_BUDGET_TOKENS,
} from "./constants.js";

export const __test = {
  buildOllamaCloudRequest,
  buildOmlxRequest,
  buildOmlxSdkClientOptions,
  buildOptiqRequest,
  OMLX_IMAGE_SYSTEM_PROMPT,
  OMLX_THINKING_BUDGET_TOKENS,
  generateImageReferencePrompt,
  resolveLocalImagePath,
  resolvePluginConfig,
  parseConfigObject,
  shouldActivateImageComprehension,
};
