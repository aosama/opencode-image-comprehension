import type { FilePart, Part } from "@opencode-ai/sdk";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTENSION_TO_MIME,
  IMAGE_FILENAME_PREFIX,
  IMAGE_FILENAME_SHORT_ID_LENGTH,
  MIME_TO_EXTENSION,
  SUPPORTED_MIME_TYPES,
  TEMP_DIR_NAME,
} from "./constants.js";
import type { Logger, ResolvedLocalImage, SavedImage } from "./types.js";

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

function getExtensionForMime(mime: string): string {
  return MIME_TO_EXTENSION[mime.toLowerCase()] ?? "png";
}

function pad2(value: number): string {
  // Two-digit zero-pad for timestamp components. Keeps the filename
  // lexically sortable (e.g. "07" not "7") so string sort equals time sort.
  return value < 10 ? `0${value}` : String(value);
}

function buildImageFilename(mime: string): string {
  // Format: image-YYYYMMDD-HHMMSS-xxxxxxxx.<ext>
  // - `image-` prefix makes the temp dir self-documenting.
  // - YYYYMMDD-HHMMSS is lexically sortable (string sort == chronological
  //   sort) and human-readable, so LLMs can find the latest image and reason
  //   about recency from the path alone.
  // - xxxxxxxx is a short random suffix (8 hex chars) for collision safety
  //   when multiple images arrive in the same second. Short enough to copy
  //   reliably; long enough that collisions are astronomically unlikely.
  const now = new Date();
  const timestamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(
    now.getDate(),
  )}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const shortId = randomUUID()
    .replace(/-/g, "")
    .slice(0, IMAGE_FILENAME_SHORT_ID_LENGTH);
  return `${IMAGE_FILENAME_PREFIX}${timestamp}-${shortId}.${getExtensionForMime(mime)}`;
}

const LEGACY_UUID_IMAGE_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[^.]+$/i;

function isMaterializedImageFilename(filename: string): boolean {
  // Current files start with image-YYYYMMDD-HHMMSS-..., while older plugin
  // versions wrote bare UUID filenames. Cleanup should cover both generations,
  // but still avoid touching unrelated non-image files in the temp directory.
  const mime = EXTENSION_TO_MIME[extname(filename).toLowerCase()];
  if (!mime || !SUPPORTED_MIME_TYPES.has(mime)) return false;
  return (
    filename.startsWith(IMAGE_FILENAME_PREFIX) ||
    LEGACY_UUID_IMAGE_FILENAME_PATTERN.test(filename)
  );
}

async function ensureTempDir(): Promise<string> {
  // Use the OS temp directory because these files are derived conversation
  // artifacts, not project source files. OpenCode sessions can still reference
  // the absolute paths during the current run.
  const directory = join(tmpdir(), TEMP_DIR_NAME);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function saveImageToTemp(data: Buffer, mime: string): Promise<string> {
  // Chronologically-sortable, human-readable filenames so LLMs can find the
  // latest image and reproduce the path without copying 36 random hex chars.
  const tempDir = await ensureTempDir();
  const filename = buildImageFilename(mime);
  const filepath = join(tempDir, filename);
  await writeFile(filepath, data);
  return filepath;
}

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
): Promise<SavedImage | null> {
  // Data URLs have no filesystem identity. Materializing them is what makes the
  // desired LLM experience possible: the non-vision model can name a file path in
  // a later tool call.
  const parsed = parseBase64DataUrl(url);
  if (!parsed) {
    log(`Failed to parse data URL for part ${filePart.id}`);
    return null;
  }
  try {
    const savedPath = await saveImageToTemp(parsed.data, parsed.mime);
    log(`Saved pasted image to temp file: ${savedPath}`);
    return { path: savedPath, mime: parsed.mime, partId: filePart.id };
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
  if (url.startsWith("data:")) return handleDataUrl(url, filePart, log);
  log(`Unsupported URL scheme for part ${filePart.id}: ${url.slice(0, 50)}...`);
  return null;
}

export async function extractImagesFromParts(
  parts: Part[],
  log: Logger,
): Promise<SavedImage[]> {
  // Transform all supported images in the latest user message. If one image
  // fails to materialize, keep processing the rest so a single bad attachment
  // does not discard useful context.
  const savedImages: SavedImage[] = [];
  for (const part of parts) {
    if (!isImageFilePart(part)) continue;
    const savedImage = await processImagePart(part, log);
    if (savedImage) savedImages.push(savedImage);
  }
  return savedImages;
}

export async function sweepStaleTempImages(input: {
  directory: string;
  ttlHours: number;
  log: Logger;
}): Promise<void> {
  // Stale temp images accumulate across sessions and confuse LLMs that try to
  // reason over the directory listing (a pile of old files makes "find the
  // latest" harder, even with sortable names). At plugin startup we sweep the
  // temp dir and remove image files older than ttlHours.
  //
  // Resilient by design: a missing directory, unreadable entries, or files
  // that vanish mid-sweep are all ignored — cleanup is best-effort and must
  // never block plugin startup.
  if (input.ttlHours <= 0) return;
  if (!existsSync(input.directory)) return;

  let entries: string[];
  try {
    entries = await readdir(input.directory);
  } catch (error) {
    input.log(
      `Temp image cleanup skipped (could not read ${input.directory}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const ttlMs = input.ttlHours * 60 * 60 * 1000;
  const now = Date.now();
  let removed = 0;

  for (const entry of entries) {
    // Only touch files that look like materialized images. Leave anything else
    // (stray dirs, unrelated files) untouched.
    if (!isMaterializedImageFilename(entry)) continue;
    const filepath = join(input.directory, entry);
    try {
      const fileStats = await stat(filepath);
      if (!fileStats.isFile()) continue;
      const ageMs = now - fileStats.mtimeMs;
      if (ageMs < ttlMs) continue;
      await unlink(filepath);
      removed++;
    } catch {
      // Individual file failures are non-fatal: keep sweeping the rest.
    }
  }

  if (removed > 0) {
    input.log(
      `Temp image cleanup removed ${removed} stale file(s) older than ${input.ttlHours}h`,
    );
  }
}

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
