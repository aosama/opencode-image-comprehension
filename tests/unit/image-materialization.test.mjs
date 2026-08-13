import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  rm,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  extractImagesFromParts,
  resolveLocalImagePath,
  sweepStaleTempImages,
} from "../../dist/image-materialization.js";
import {
  IMAGE_FILENAME_PREFIX,
  IMAGE_FILENAME_SHORT_ID_LENGTH,
} from "../../dist/constants.js";
import { cleanImageFixtures } from "./test-helpers.mjs";

test("replaying a turn reuses canonical image paths instead of creating duplicates", async () => {
  const firstImages = await extractImagesFromParts(
    [
      {
        id: "canonical-image",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ],
    () => undefined,
    "session-canonical",
    "message-canonical",
  );
  const secondImages = await extractImagesFromParts(
    [
      {
        id: "canonical-image-replay",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ],
    () => undefined,
    "session-canonical",
    "message-canonical",
  );

  assert.equal(firstImages[0].path, secondImages[0].path);
  assert.match(firstImages[0].path, /\/message-canonical\/current-image\.png$/);
  await cleanImageFixtures();
});

test("multiple images in one turn receive stable numbered canonical paths", async () => {
  const savedImages = await extractImagesFromParts(
    [
      {
        id: "canonical-first",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
      {
        id: "canonical-second",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ],
    () => undefined,
    "session-canonical-multiple",
    "message-canonical-multiple",
  );

  assert.match(savedImages[0].path, /\/current-image\.png$/);
  assert.match(savedImages[1].path, /\/current-image-2\.png$/);
  await cleanImageFixtures();
});

test("image materialization saves data URL parts and skips unsupported URL schemes", async () => {
  const savedImages = await extractImagesFromParts(
    [
      {
        id: "data-image",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
      {
        id: "remote-image",
        type: "file",
        mime: "image/png",
        url: "https://example.com/image.png",
      },
    ],
    () => undefined,
  );

  assert.equal(savedImages.length, 1);
  assert.equal(savedImages[0].mime, "image/png");
  assert.equal(savedImages[0].partId, "data-image");
  assert.match(savedImages[0].path, /\.png$/);
  assert.equal(existsSync(savedImages[0].path), true);
  await cleanImageFixtures();
});

test("materialized image filename is chronologically sortable and human-readable", async () => {
  const savedImages = await extractImagesFromParts(
    [
      {
        id: "data-image-naming",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ],
    () => undefined,
  );

  const filename = savedImages[0].path.split("/").pop() ?? "";
  assert.match(
    filename,
    new RegExp(
      `^${IMAGE_FILENAME_PREFIX}\\d{8}-\\d{6}-[0-9a-f]{${IMAGE_FILENAME_SHORT_ID_LENGTH}}\\.png$`,
    ),
  );
  assert.doesNotMatch(
    filename,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[1-9][0-9a-f]{11}/,
  );
  await cleanImageFixtures();
});

test("multiple images saved in the same second get distinct formatted filenames", async () => {
  const first = await extractImagesFromParts(
    [
      {
        id: "img-a",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ],
    () => undefined,
  );
  const second = await extractImagesFromParts(
    [
      {
        id: "img-b",
        type: "file",
        mime: "image/jpeg",
        url: "data:image/jpeg;base64,aW1hZ2U=",
      },
    ],
    () => undefined,
  );

  const firstName = first[0].path.split("/").pop() ?? "";
  const secondName = second[0].path.split("/").pop() ?? "";
  assert.notEqual(firstName, secondName);
  assert.match(
    secondName,
    new RegExp(
      `^${IMAGE_FILENAME_PREFIX}\\d{8}-\\d{6}-[0-9a-f]{${IMAGE_FILENAME_SHORT_ID_LENGTH}}\\.jpg$`,
    ),
  );
  await cleanImageFixtures();
});

test("local image path resolver rejects remote and data URL inputs", async () => {
  await assert.rejects(
    resolveLocalImagePath({
      imagePath: "https://example.com/image.png",
      directory: tmpdir(),
    }),
    /only accepts local image paths/,
  );
  await assert.rejects(
    resolveLocalImagePath({
      imagePath: "data:image/png;base64,aW1hZ2U=",
      directory: tmpdir(),
    }),
    /only accepts local image paths/,
  );
});

test("stale temp images older than the TTL are removed at cleanup", async () => {
  const testSweepDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-test-sweep-${Date.now()}`,
  );
  await mkdir(testSweepDirectory, { recursive: true });
  const stalePath = join(testSweepDirectory, "image-stale.png");
  const freshPath = join(testSweepDirectory, "image-fresh.png");
  await writeFile(stalePath, Buffer.from("stale"));
  await writeFile(freshPath, Buffer.from("fresh"));
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(stalePath, twoHoursAgo, twoHoursAgo);

  await sweepStaleTempImages({
    directory: testSweepDirectory,
    ttlHours: 1,
    log: () => undefined,
  });

  assert.equal(existsSync(stalePath), false);
  assert.equal(existsSync(freshPath), true);
  await rm(testSweepDirectory, { recursive: true, force: true });
});

test("stale temp cleanup removes legacy UUID-named images", async () => {
  const testSweepDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-legacy-sweep-${Date.now()}`,
  );
  await mkdir(testSweepDirectory, { recursive: true });
  const legacyImagePath = join(
    testSweepDirectory,
    "123e4567-e89b-12d3-a456-426614174000.png",
  );
  const unrelatedPath = join(testSweepDirectory, "not-an-image.txt");
  await writeFile(legacyImagePath, Buffer.from("legacy"));
  await writeFile(unrelatedPath, Buffer.from("keep"));
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(legacyImagePath, twoHoursAgo, twoHoursAgo);
  await utimes(unrelatedPath, twoHoursAgo, twoHoursAgo);

  await sweepStaleTempImages({
    directory: testSweepDirectory,
    ttlHours: 1,
    log: () => undefined,
  });

  assert.equal(existsSync(legacyImagePath), false);
  assert.equal(existsSync(unrelatedPath), true);
  await rm(testSweepDirectory, { recursive: true, force: true });
});

test("extractImagesFromParts places materialized images in a session-scoped directory", async () => {
  const savedImages = await extractImagesFromParts(
    [
      {
        id: "session-image",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ],
    () => undefined,
    "test-session-abc",
  );

  assert.equal(savedImages.length, 1);
  assert.equal(savedImages[0].sessionID, "test-session-abc");
  assert.match(
    savedImages[0].path,
    /\/opencode-image-comprehension\/test-session-abc\//,
  );
  assert.match(savedImages[0].path, /\/image-\d{8}-\d{6}-[0-9a-f]+\.png$/);
  assert.equal(existsSync(savedImages[0].path), true);
  await cleanImageFixtures();
});

test("extractImagesFromParts without sessionID falls back to flat temp dir", async () => {
  const savedImages = await extractImagesFromParts(
    [
      {
        id: "flat-image",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ],
    () => undefined,
  );

  assert.equal(savedImages.length, 1);
  assert.equal(savedImages[0].sessionID, undefined);
  assert.match(
    savedImages[0].path,
    /\/opencode-image-comprehension\/image-\d{8}-\d{6}-[0-9a-f]+\.png$/,
  );
  assert.equal(existsSync(savedImages[0].path), true);
  await cleanImageFixtures();
});

test("two different sessionIDs produce isolated materialized images", async () => {
  const first = await extractImagesFromParts(
    [
      {
        id: "img-first",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ],
    () => undefined,
    "session-A-1",
  );
  const second = await extractImagesFromParts(
    [
      {
        id: "img-second",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ],
    () => undefined,
    "session-B-2",
  );

  assert.notEqual(first[0].sessionID, second[0].sessionID);
  assert.match(first[0].path, /\/session-A-1\//);
  assert.match(second[0].path, /\/session-B-2\//);
  assert.doesNotMatch(first[0].path, /\/session-B-2\//);
  assert.doesNotMatch(second[0].path, /\/session-A-1\//);
  await cleanImageFixtures();
});

test("sweepStaleTempImages removes stale files inside session directories", async () => {
  const testSweepDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-sweep-session-${Date.now()}`,
  );
  const sessionDirectory = join(testSweepDirectory, "session-to-clean");
  await mkdir(sessionDirectory, { recursive: true });
  const stalePath = join(sessionDirectory, "image-stale.png");
  const freshPath = join(sessionDirectory, "image-fresh.png");
  await writeFile(stalePath, Buffer.from("stale"));
  await writeFile(freshPath, Buffer.from("fresh"));
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(stalePath, twoHoursAgo, twoHoursAgo);

  await sweepStaleTempImages({
    directory: testSweepDirectory,
    ttlHours: 1,
    log: () => undefined,
  });

  assert.equal(existsSync(stalePath), false);
  assert.equal(existsSync(freshPath), true);
  await rm(testSweepDirectory, { recursive: true, force: true });
});

test("sweepStaleTempImages removes empty session directories", async () => {
  const testSweepDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-sweep-empty-${Date.now()}`,
  );
  await mkdir(testSweepDirectory, { recursive: true });
  const emptySessionDirectory = join(testSweepDirectory, "empty-session");
  const activeSessionDirectory = join(testSweepDirectory, "active-session");
  await mkdir(emptySessionDirectory, { recursive: true });
  await mkdir(activeSessionDirectory, { recursive: true });
  await writeFile(
    join(activeSessionDirectory, "image-some.png"),
    Buffer.from("keep"),
  );

  await sweepStaleTempImages({
    directory: testSweepDirectory,
    ttlHours: 1,
    log: () => undefined,
  });

  const postSweepEntries = await readdir(testSweepDirectory);
  assert.equal(existsSync(emptySessionDirectory), false);
  assert.equal(existsSync(activeSessionDirectory), true);
  assert.deepEqual(postSweepEntries, ["active-session"]);
  await rm(testSweepDirectory, { recursive: true, force: true });
});

test("SavedImage exposes sessionID for session cleanup", async () => {
  const savedImages = await extractImagesFromParts(
    [
      {
        id: "cleanup-image",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ],
    () => undefined,
    "cleanup-session",
  );

  assert.equal(savedImages.length, 1);
  assert.equal(savedImages[0].sessionID, "cleanup-session");
  assert.match(savedImages[0].path, /\/cleanup-session\//);
  assert.equal(existsSync(savedImages[0].path), true);
  await cleanImageFixtures();
});
