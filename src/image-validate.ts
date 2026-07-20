import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_TO_MIME, SUPPORTED_MIME_TYPES } from "./constants.js";
import type { ResolvedLocalImage } from "./types.js";

function mimeFromPath(imagePath: string): string | undefined {
  // Self-review note: this is extension-based validation, not byte-sniffing. It
  // is sufficient for the current OpenCode/tool UX, but a future hardening pass
  // should inspect magic bytes before sending user-selected files to a provider.
  return EXTENSION_TO_MIME[extname(imagePath).toLowerCase()];
}

function resolveCandidatePath(imagePath: string, directory: string): string {
  // Accept relative paths because the LLM commonly receives project-relative
  // paths from OpenCode tools and user prompts. Resolve them against the tool
  // context directory, which is OpenCode's current project/session directory.
  if (imagePath.startsWith("file://")) return fileURLToPath(imagePath);
  if (
    imagePath.startsWith("http://") ||
    imagePath.startsWith("https://") ||
    imagePath.startsWith("data:")
  ) {
    throw new Error("comprehend_image only accepts local image paths");
  }
  return isAbsolute(imagePath) ? imagePath : resolve(directory, imagePath);
}

export async function resolveLocalImagePath(input: {
  imagePath: string;
  directory: string;
}): Promise<ResolvedLocalImage> {
  // This is the main safety gate for the LLM-facing tool. The model may provide
  // any local path, so validate existence, file-ness, and supported image type
  // before reading bytes or calling the external vision provider.
  const trimmedPath = input.imagePath.trim();
  if (!trimmedPath) throw new Error("image_path is required");

  const absolutePath = resolveCandidatePath(trimmedPath, input.directory);
  if (!existsSync(absolutePath))
    throw new Error(`Image file not found: ${absolutePath}`);

  const fileStats = await stat(absolutePath);
  if (!fileStats.isFile())
    throw new Error(`Image path is not a regular file: ${absolutePath}`);

  const mime = mimeFromPath(absolutePath);
  if (!mime || !SUPPORTED_MIME_TYPES.has(mime)) {
    throw new Error(`Unsupported image type for path: ${absolutePath}`);
  }

  return { absolutePath, mime };
}

export async function readLocalImageAsBase64(input: {
  imagePath: string;
  directory: string;
}): Promise<string> {
  // Keep file reading behind resolveLocalImagePath so every provider receives
  // bytes only after the same validation policy has run.
  const resolvedImage = await resolveLocalImagePath(input);
  const bytes = await readFile(resolvedImage.absolutePath);
  return bytes.toString("base64");
}

export async function readLocalImage(input: {
  imagePath: string;
  directory: string;
}): Promise<{ base64: string; mime: string }> {
  // Like readLocalImageAsBase64 but also returns the MIME type so the oMLX
  // provider can construct a correct data URL for the OpenAI-compatible
  // image_url content part. The existing ollama-cloud provider keeps using
  // readLocalImageAsBase64 unchanged.
  const resolvedImage = await resolveLocalImagePath(input);
  const bytes = await readFile(resolvedImage.absolutePath);
  return { base64: bytes.toString("base64"), mime: resolvedImage.mime };
}
