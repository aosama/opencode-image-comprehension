import { existsSync } from "node:fs";
import { readdir, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TEMP_DIR_NAME } from "../../dist/constants.js";

// Tests that materialize data URLs write to the shared temporary image directory.
// Keep the cleanup helper outside individual suites so the split test files retain
// identical isolation behavior without duplicating filesystem traversal code.
export async function cleanImageFixtures() {
  const baseDirectory = join(tmpdir(), TEMP_DIR_NAME);
  if (!existsSync(baseDirectory)) return;

  const entries = await readdir(baseDirectory);
  for (const entry of entries) {
    const entryPath = join(baseDirectory, entry);
    const entryStats = await stat(entryPath);
    if (entryStats.isDirectory()) {
      await rm(entryPath, { recursive: true, force: true });
    } else {
      await unlink(entryPath);
    }
  }
}
