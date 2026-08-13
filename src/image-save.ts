import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import {
  IMAGE_FILENAME_PREFIX,
  CURRENT_IMAGE_FILENAME_PREFIX,
  IMAGE_FILENAME_SHORT_ID_LENGTH,
  MIME_TO_EXTENSION,
  TEMP_DIR_NAME,
} from "./constants.js";

function getExtensionForMime(mime: string): string {
  return MIME_TO_EXTENSION[mime.toLowerCase()] ?? "png";
}

function pad2(value: number): string {
  // Two-digit zero-pad for timestamp components. Keeps the filename
  // lexically sortable (e.g. "07" not "7") so string sort equals time sort.
  return value < 10 ? `0${value}` : String(value);
}

function buildImageFilename(mime: string, imageIndex?: number): string {
  if (imageIndex !== undefined) {
    const extension = getExtensionForMime(mime);
    return imageIndex === 0
      ? `${CURRENT_IMAGE_FILENAME_PREFIX}.${extension}`
      : `${CURRENT_IMAGE_FILENAME_PREFIX}-${imageIndex + 1}.${extension}`;
  }

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

function safePathSegment(pathSegment: string): string {
  const safeSegment = pathSegment.replace(/[^A-Za-z0-9_-]/g, "_");
  return safeSegment || "unknown";
}

async function ensureTempDir(
  sessionID?: string,
  turnID?: string,
): Promise<string> {
  // Use the OS temp directory because these files are derived conversation
  // artifacts, not project source files. With a sessionID we colocate the
  // materialized image in a per-session subdirectory so it gets swept out
  // naturally when that session ends, instead of piling into a shared flat
  // temp directory where cleanup is purely wall-clock.
  const parent = join(tmpdir(), TEMP_DIR_NAME);
  await mkdir(parent, { recursive: true });
  if (sessionID) {
    const sessionDir = join(parent, safePathSegment(sessionID));
    await mkdir(sessionDir, { recursive: true });
    if (!turnID) return sessionDir;
    const turnDir = join(sessionDir, safePathSegment(turnID));
    await mkdir(turnDir, { recursive: true });
    return turnDir;
  }
  return parent;
}

export async function saveImageToTemp(
  data: Buffer,
  mime: string,
  sessionID?: string,
  turnID?: string,
  imageIndex?: number,
): Promise<string> {
  // A turn-scoped canonical filename makes retries idempotent: replaying the
  // same user message updates the same path instead of creating a confusing
  // collection of timestamped copies.
  const tempDir = await ensureTempDir(sessionID, turnID);
  const filename = buildImageFilename(mime, turnID ? imageIndex : undefined);
  const filepath = join(tempDir, filename);
  await writeFile(filepath, data);
  return filepath;
}
