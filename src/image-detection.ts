import type { FilePart, Part } from "@opencode-ai/sdk";
import { SUPPORTED_MIME_TYPES } from "./constants.js";

export function isImageFilePart(part: Part): part is FilePart {
  // Only transform image file parts that the plugin knows how to hand to the
  // vision provider. Other file parts must remain available to OpenCode's normal
  // prompt/file handling pipeline.
  if (part.type !== "file") return false;
  const mime = (part as FilePart).mime?.toLowerCase() ?? "";
  return SUPPORTED_MIME_TYPES.has(mime);
}

export function parseBase64DataUrl(
  dataUrl: string,
): { mime: string; data: Buffer } | null {
  // Pasted/dragged images often arrive as data URLs. Decode them immediately so
  // the LLM receives a stable local path rather than a huge base64 blob.
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  try {
    return { mime: match[1], data: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}
