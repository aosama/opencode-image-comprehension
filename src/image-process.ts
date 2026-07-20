import type { FilePart, Part } from "@opencode-ai/sdk";
import { fileURLToPath } from "node:url";
import { parseBase64DataUrl } from "./image-detection.js";
import { saveImageToTemp } from "./image-save.js";
import type { Logger, SavedImage } from "./types.js";
import { isImageFilePart } from "./image-detection.js";

function handleFileUrl(
  url: string,
  filePart: FilePart,
  log: Logger,
): SavedImage | null {
  // File URLs already point at local storage, so keep the path stable instead of
  // copying bytes into temp. This preserves useful filenames and avoids needless
  // I/O for images attached with `-f` or the UI file picker.
  try {
    const localPath = fileURLToPath(url);
    log(`Image already on disk: ${localPath}`);
    return { path: localPath, mime: filePart.mime, partId: filePart.id };
  } catch (error) {
    log(
      `Failed to parse file URL for part ${filePart.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function handleDataUrl(
  url: string,
  filePart: FilePart,
  log: Logger,
  sessionID?: string,
): Promise<SavedImage | null> {
  // Data URLs have no filesystem identity. Materializing them is what makes the
  // desired LLM experience possible: the non-vision model can name a file path in
  // a later tool call. Materialized images go into the session's own directory
  // so the sweep can clean up on session end instead of relying on wall-clock
  // TTL to purge them from a shared flat temp directory.
  const parsed = parseBase64DataUrl(url);
  if (!parsed) {
    log(`Failed to parse data URL for part ${filePart.id}`);
    return null;
  }
  try {
    const savedPath = await saveImageToTemp(
      parsed.data,
      parsed.mime,
      sessionID,
    );
    log(`Saved pasted image to temp file: ${savedPath}`);
    return {
      path: savedPath,
      mime: parsed.mime,
      partId: filePart.id,
      sessionID,
    };
  } catch (error) {
    log(
      `Failed to save image: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function processImagePart(
  filePart: FilePart,
  log: Logger,
  sessionID?: string,
): Promise<SavedImage | null> {
  // Do not pass through remote URLs here. The tool contract is explicitly local
  // image paths so the LLM has one simple mental model and all provider calls go
  // through the same local-file validation path.
  const url = filePart.url;
  if (!url) {
    log(`Skipping image part ${filePart.id}: no URL`);
    return null;
  }
  if (url.startsWith("file://")) return handleFileUrl(url, filePart, log);
  if (url.startsWith("data:"))
    return handleDataUrl(url, filePart, log, sessionID);
  log(`Unsupported URL scheme for part ${filePart.id}: ${url.slice(0, 50)}...`);
  return null;
}

export async function extractImagesFromParts(
  parts: Part[],
  log: Logger,
  sessionID?: string,
): Promise<SavedImage[]> {
  // Transform all supported images in the latest user message. If one image
  // fails to materialize, keep processing the rest so a single bad attachment
  // does not discard useful context.
  const savedImages: SavedImage[] = [];
  for (const part of parts) {
    if (!isImageFilePart(part)) continue;
    const savedImage = await processImagePart(part, log, sessionID);
    if (savedImage) savedImages.push(savedImage);
  }
  return savedImages;
}
