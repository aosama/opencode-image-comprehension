import type { Message, Part, TextPart } from "@opencode-ai/sdk";
import { randomUUID } from "node:crypto";
import { TOOL_NAME } from "./constants.js";
import { shouldActivateImageComprehension } from "./activation.js";
import {
  extractImagesFromParts,
  isImageFilePart,
} from "./image-materialization.js";
import { generateImageReferencePrompt } from "./prompt.js";
import type { Logger, ModelInfo, PluginConfig } from "./types.js";

function isTextPart(part: Part): part is TextPart {
  return part.type === "text";
}

function findLastUserMessage(
  messages: Array<{ info: Message; parts: Part[] }>,
): { message: { info: Message; parts: Part[] }; index: number } | null {
  // OpenCode replays all prior turns into this hook. The current user turn is
  // the only place where raw image parts should be replaced; older turns are
  // already part of history and should remain stable.
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    if (messages[messageIndex].info.role === "user")
      return { message: messages[messageIndex], index: messageIndex };
  }
  return null;
}

function removeProcessedImageParts(
  parts: Part[],
  processedIds: Set<string>,
): Part[] {
  // Non-vision providers cannot handle image media. Once an image is represented
  // as a local path in text, drop the raw file part so OpenCode does not pass
  // unsupported media into the provider request.
  return parts.filter(
    (part) => !(part.type === "file" && processedIds.has(part.id)),
  );
}

function updateOrCreateTextPart(
  message: { info: Message; parts: Part[] },
  newText: string,
): void {
  // Prefer updating the user's existing text part so their original request and
  // the injected image-path instructions remain in a single coherent user
  // message. If the user sent only an image, create a synthetic text part.
  const textPartIndex = message.parts.findIndex(isTextPart);
  if (textPartIndex !== -1) {
    (message.parts[textPartIndex] as TextPart).text = newText;
    return;
  }

  message.parts.unshift({
    id: `transformed-${randomUUID()}`,
    sessionID: message.info.sessionID,
    messageID: message.info.id,
    type: "text",
    text: newText,
    synthetic: true,
  });
}

export async function transformMessagesForImageComprehension(input: {
  messages: Array<{ info: Message; parts: Part[] }>;
  config: PluginConfig;
  configuredModels: readonly string[] | undefined;
  model: ModelInfo | undefined;
  log: Logger;
  sessionID?: string;
}): Promise<void> {
  // High-level transform contract:
  // 1. Only operate on the latest user message.
  // 2. Only activate for models that should not receive raw image media.
  // 3. Materialize images into local paths.
  // 4. Replace raw image parts with instructions that let the LLM call the tool
  //    using its own prompt.
  const result = findLastUserMessage(input.messages);
  if (!result) return;

  const { message: lastUserMessage, index: lastUserIndex } = result;
  if (!lastUserMessage.parts.some(isImageFilePart)) return;

  if (
    !shouldActivateImageComprehension({
      activation: input.config.activation,
      model: input.model,
      configuredPatterns: input.configuredModels,
    })
  ) {
    // For native vision models, doing nothing is the feature: OpenCode should
    // pass the original image media through to the model unchanged.
    input.log("Image comprehension not activated for this model");
    return;
  }

  input.log("Non-vision model detected; processing image parts...");
  const savedImages = await extractImagesFromParts(
    lastUserMessage.parts,
    input.log,
    input.sessionID,
  );
  if (savedImages.length === 0) {
    input.log("No images were successfully saved");
    return;
  }

  const existingTextPart = lastUserMessage.parts.find(isTextPart);
  const userText = existingTextPart?.text ?? "";
  // The prompt does not describe the image. It advertises the local image paths
  // and the comprehend_image contract so the LLM decides what visual question to
  // ask based on the user's actual task.
  const transformedText = generateImageReferencePrompt(
    savedImages,
    userText,
    TOOL_NAME,
    input.config.promptTemplate,
  );

  lastUserMessage.parts = removeProcessedImageParts(
    lastUserMessage.parts,
    new Set(savedImages.map((savedImage) => savedImage.partId)),
  );
  updateOrCreateTextPart(lastUserMessage, transformedText);
  input.messages[lastUserIndex] = lastUserMessage;
  input.log(
    "Successfully injected image file references and image comprehension instructions",
  );
}
