import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { extname } from "node:path";
import {
  EXTENSION_TO_MIME,
  IMAGE_FILENAME_PREFIX,
  SUPPORTED_MIME_TYPES,
} from "./constants.js";
import type { Logger } from "./types.js";

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
  // With per-session directories the dominant cleanup path is deleting the
  // entire session directory when the session ends. The sweep now runs as a
  // fallback: orphaned session directories (those with no active sessions) that
  // exceed the TTL are pruned, and any leftover stale image files within still-
  // tracked session directories are also removed.
  //
  // Resilient by design: a missing directory, unreadable entries, or files
  // that vanish mid-sweep are all ignored — cleanup is best-effort and must
  // never block plugin startup.
  if (input.ttlHours <= 0) return;
  if (!existsSync(input.directory)) return;

  const ttlMs = input.ttlHours * 60 * 60 * 1000;
  const now = Date.now();
  let removed = 0;
  let removedDirs = 0;

  let entries: string[];
  try {
    entries = await readdir(input.directory);
  } catch (error) {
    input.log(
      `Temp image cleanup skipped (could not read ${input.directory}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  // First pass: remove stale image files in any remaining directories
  // (session-scoped or legacy flat). Also remove empty session directories.
  for (const entry of entries) {
    const entryPath = join(input.directory, entry);
    try {
      const entryStats = await stat(entryPath);
      if (entryStats.isFile() && isMaterializedImageFilename(entry)) {
        const ageMs = now - entryStats.mtimeMs;
        if (ageMs >= ttlMs) {
          await rm(entryPath, { force: true });
          removed++;
        }
      } else if (entryStats.isDirectory()) {
        // Per-session subdirectory: scan for stale files inside it, then
        // remove the directory if it becomes empty after cleanup.
        const sessionDirEntries: string[] = [];
        try {
          const initialEntries = await readdir(entryPath);
          sessionDirEntries.push(...initialEntries);
        } catch {
          continue;
        }
        for (const subEntry of sessionDirEntries) {
          const subPath = join(entryPath, subEntry);
          try {
            const subStats = await stat(subPath);
            if (subStats.isFile() && isMaterializedImageFilename(subEntry)) {
              const ageMs = now - subStats.mtimeMs;
              if (ageMs >= ttlMs) {
                await rm(subPath, { force: true });
                removed++;
              }
            }
          } catch {
            // Non-fatal: keep scanning the rest of this session dir.
          }
        }
        // Re-read to check if the dir is now empty (stale files may have been
        // removed in the loop above).
        const shouldBeRemoved = sessionDirEntries.length === 0;
        if (!shouldBeRemoved) {
          try {
            const postEntries = await readdir(entryPath);
            if (postEntries.length === 0) {
              await rm(entryPath, { recursive: true, force: true });
              removedDirs++;
              input.log(`Removed empty session directory: ${entry}`);
            }
          } catch {
            // Directory disappeared between reads — ignore.
          }
        } else {
          // Already empty from the start — remove it immediately.
          try {
            await rm(entryPath, { recursive: true, force: true });
            removedDirs++;
            input.log(`Removed empty session directory: ${entry}`);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      input.log(
        `Temp image cleanup failed on entry ${entry}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Individual file/directory failures are non-fatal: keep sweeping.
    }
  }

  if (removed > 0) {
    input.log(
      `Temp image cleanup removed ${removed} stale file(s) older than ${input.ttlHours}h`,
    );
  }
  if (removedDirs > 0) {
    input.log(
      `Temp image cleanup removed ${removedDirs} empty session directory(ies)`,
    );
  }
}
