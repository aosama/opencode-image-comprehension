import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { ImageComprehensionPlugin, __test } from "../../dist/index.js";
import {
  extractImagesFromParts,
  resolveLocalImagePath,
} from "../../dist/image-materialization.js";
import { transformMessagesForImageComprehension } from "../../dist/message-transform.js";
import {
  getProviderApiKey,
  parseOllamaCloudDescription,
} from "../../dist/providers/ollama-cloud.js";
import {
  describeImageWithOmlx,
  getOmlxApiKey,
  parseOmlxDescription,
} from "../../dist/providers/omlx.js";
import {
  DEFAULT_OMLX_MODEL,
  IMAGE_FILENAME_PREFIX,
  IMAGE_FILENAME_SHORT_ID_LENGTH,
  TEMP_DIR_NAME,
} from "../../dist/constants.js";

// Helper to clean up image materialization fixtures created during tests.
// Tests that call extractImagesFromParts write to $TMPDIR/opencode-image-comprehension/
// (or session subdirs). We clean those up so the temp dir doesn't accumulate.
async function cleanImageFixtures() {
  const base = join(tmpdir(), TEMP_DIR_NAME);
  if (!existsSync(base)) return;
  const entries = await readdir(base);
  for (const entry of entries) {
    const fullPath = join(base, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      await rm(fullPath, { recursive: true, force: true });
    } else {
      await unlink(fullPath);
    }
  }
}

test("resolves Ollama Cloud config with legacy visionModel fallback", () => {
  const config = __test.resolvePluginConfig(
    { visionModel: "gemma4:31b" },
    null,
  );

  assert.equal(config.provider, "ollama-cloud");
  assert.equal(config.model, "gemma4:31b");
  assert.equal(config.baseUrl, "https://ollama.com/api/chat");
  assert.equal(config.apiKeyEnv, "OLLAMA_CLOUD_API_KEY");
});

test("auto activation skips models with native image input", () => {
  assert.equal(
    __test.shouldActivateImageComprehension({
      activation: "auto",
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        supportsImageInput: true,
      },
      configuredPatterns: undefined,
    }),
    false,
  );
});

test("auto activation enables models without native image input", () => {
  assert.equal(
    __test.shouldActivateImageComprehension({
      activation: "auto",
      model: {
        providerID: "deepseek",
        modelID: "deepseek-chat",
        supportsImageInput: false,
      },
      configuredPatterns: undefined,
    }),
    true,
  );
});

test("builds Ollama Cloud request with configured model and base64 image", () => {
  assert.deepEqual(
    __test.buildOllamaCloudRequest({
      model: "gemma4:31b",
      prompt: "What is shown?",
      imageBase64: "aW1hZ2U=",
    }),
    {
      model: "gemma4:31b",
      stream: false,
      messages: [
        {
          role: "user",
          content: "What is shown?",
          images: ["aW1hZ2U="],
        },
      ],
    },
  );
});

test("injected prompt gives the LLM image_path instructions", () => {
  const prompt = __test.generateImageReferencePrompt(
    [
      {
        path: "/tmp/opencode-image-comprehension/session/image.png",
        mime: "image/png",
        partId: "part-1",
      },
    ],
    "What is shown here?",
    "comprehend_image",
  );

  assert.match(prompt, /image_path/);
  assert.match(prompt, /prompt/);
  assert.match(
    prompt,
    /\/tmp\/opencode-image-comprehension\/session\/image\.png/,
  );
  assert.match(prompt, /What is shown here\?/);
});

test("resolves relative local image paths from the OpenCode tool directory", async () => {
  const testDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-test-${Date.now()}`,
  );
  const imagePath = join(testDirectory, "fixture.png");
  await mkdir(testDirectory, { recursive: true });
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const resolved = await __test.resolveLocalImagePath({
    imagePath: "fixture.png",
    directory: testDirectory,
  });

  assert.equal(resolved.absolutePath, imagePath);
  assert.equal(resolved.mime, "image/png");
});

test("plugin instances keep their resolved configs isolated", async () => {
  const firstDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-first-${Date.now()}`,
  );
  const secondDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-second-${Date.now()}`,
  );
  const firstConfigDirectory = join(firstDirectory, ".opencode");
  const secondConfigDirectory = join(secondDirectory, ".opencode");
  await mkdir(firstConfigDirectory, { recursive: true });
  await mkdir(secondConfigDirectory, { recursive: true });
  await writeFile(
    join(firstConfigDirectory, "opencode-image-comprehension.json"),
    JSON.stringify({ model: "first-vision-model" }),
  );
  await writeFile(
    join(secondConfigDirectory, "opencode-image-comprehension.json"),
    JSON.stringify({ model: "second-vision-model" }),
  );

  const client = {
    app: { log: async () => undefined },
    provider: { list: async () => ({ data: { all: [] } }) },
  };

  const firstPlugin = await ImageComprehensionPlugin({
    client,
    directory: firstDirectory,
  });
  await ImageComprehensionPlugin({ client, directory: secondDirectory });

  let toolMetadata;
  await firstPlugin.tool.comprehend_image.execute(
    { image_path: "missing.png", prompt: "describe" },
    {
      directory: firstDirectory,
      metadata: (metadata) => {
        toolMetadata = metadata;
      },
    },
  );

  assert.equal(toolMetadata.metadata.model, "first-vision-model");
});

test("vision-model tool guard is isolated by session", async () => {
  const testDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-session-guard-${Date.now()}`,
  );
  await mkdir(testDirectory, { recursive: true });

  const client = {
    app: { log: async () => undefined },
    provider: {
      list: async () => ({
        data: {
          all: [
            {
              id: "vision-provider",
              models: {
                "vision-model": {
                  capabilities: { input: { image: true } },
                },
              },
            },
            {
              id: "text-provider",
              models: {
                "text-model": {
                  capabilities: { input: { image: false } },
                },
              },
            },
          ],
        },
      }),
    },
  };

  const plugin = await ImageComprehensionPlugin({
    client,
    directory: testDirectory,
  });

  await plugin["experimental.chat.messages.transform"](
    {},
    {
      messages: [
        {
          info: {
            id: "vision-message",
            sessionID: "vision-session",
            role: "user",
            model: {
              providerID: "vision-provider",
              modelID: "vision-model",
            },
          },
          parts: [{ id: "vision-text", type: "text", text: "describe" }],
        },
      ],
    },
  );

  await plugin["experimental.chat.messages.transform"](
    {},
    {
      messages: [
        {
          info: {
            id: "text-message",
            sessionID: "text-session",
            role: "user",
            model: {
              providerID: "text-provider",
              modelID: "text-model",
            },
          },
          parts: [{ id: "text", type: "text", text: "describe" }],
        },
      ],
    },
  );

  const toolResult = await plugin.tool.comprehend_image.execute(
    { image_path: "fixture.png", prompt: "describe" },
    {
      sessionID: "vision-session",
      messageID: "vision-message",
      agent: "build",
      directory: testDirectory,
      worktree: testDirectory,
      abort: new AbortController().signal,
      metadata: () => undefined,
      ask: async () => undefined,
    },
  );

  assert.equal(toolResult.metadata.blocked, true);
  assert.match(toolResult.output, /vision-capable model/);
});

test("vision-model system prompt forbids comprehend_image fallback", async () => {
  const testDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-system-${Date.now()}`,
  );
  await mkdir(testDirectory, { recursive: true });

  const client = {
    app: { log: async () => undefined },
    provider: { list: async () => ({ data: { all: [] } }) },
  };
  const plugin = await ImageComprehensionPlugin({
    client,
    directory: testDirectory,
  });

  const output = { system: [] };
  await plugin["experimental.chat.system.transform"](
    {
      sessionID: "vision-session",
      model: {
        id: "vision-model",
        providerID: "vision-provider",
        capabilities: {
          input: { image: true },
        },
      },
    },
    output,
  );

  assert.equal(output.system.length, 1);
  assert.match(output.system[0], /Do not call comprehend_image/);
  assert.match(output.system[0], /OpenCode model metadata says/);
});

test("message transform preserves system vision guard when provider metadata is missing", async () => {
  const testDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-system-guard-${Date.now()}`,
  );
  await mkdir(testDirectory, { recursive: true });

  const client = {
    app: { log: async () => undefined },
    provider: { list: async () => ({ data: { all: [] } }) },
  };
  const plugin = await ImageComprehensionPlugin({
    client,
    directory: testDirectory,
  });

  await plugin["experimental.chat.system.transform"](
    {
      sessionID: "vision-session",
      model: {
        id: "vision-model",
        providerID: "vision-provider",
        capabilities: { input: { image: true } },
      },
    },
    { system: [] },
  );

  await plugin["experimental.chat.messages.transform"](
    {},
    {
      messages: [
        {
          info: {
            id: "message",
            sessionID: "vision-session",
            role: "user",
            model: {
              providerID: "vision-provider",
              modelID: "vision-model",
            },
          },
          parts: [{ id: "text", type: "text", text: "describe" }],
        },
      ],
    },
  );

  const toolResult = await plugin.tool.comprehend_image.execute(
    { image_path: "missing.png", prompt: "describe" },
    {
      sessionID: "vision-session",
      messageID: "message",
      agent: "build",
      directory: testDirectory,
      worktree: testDirectory,
      abort: new AbortController().signal,
      metadata: () => undefined,
      ask: async () => undefined,
    },
  );

  assert.equal(toolResult.metadata.blocked, true);
});

test("message transform strips latest image parts and injects image_path instructions", async () => {
  const messages = [
    {
      info: { id: "old-message", sessionID: "session", role: "user" },
      parts: [
        {
          id: "old-image",
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,aW1hZ2U=",
        },
      ],
    },
    {
      info: {
        id: "assistant-message",
        sessionID: "session",
        role: "assistant",
      },
      parts: [],
    },
    {
      info: { id: "latest-message", sessionID: "session", role: "user" },
      parts: [
        {
          id: "latest-text",
          sessionID: "session",
          messageID: "latest-message",
          type: "text",
          text: "Describe the latest image",
        },
        {
          id: "latest-image",
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,aW1hZ2U=",
        },
        {
          id: "latest-document",
          type: "file",
          mime: "text/plain",
          url: "file:///tmp/readme.txt",
        },
      ],
    },
  ];
  const logs = [];

  await transformMessagesForImageComprehension({
    messages,
    config: __test.resolvePluginConfig({ activation: "force" }, null),
    configuredModels: undefined,
    model: undefined,
    log: (message) => logs.push(message),
  });

  const oldUserMessage = messages[0];
  const latestUserMessage = messages[2];
  const transformedText = latestUserMessage.parts.find(
    (part) => part.type === "text",
  ).text;

  assert.equal(
    oldUserMessage.parts.some((part) => part.id === "old-image"),
    true,
  );
  assert.equal(
    latestUserMessage.parts.some((part) => part.id === "latest-image"),
    false,
  );
  assert.equal(
    latestUserMessage.parts.some((part) => part.id === "latest-document"),
    true,
  );
  assert.match(transformedText, /comprehend_image/);
  assert.match(transformedText, /image_path/);
  assert.match(transformedText, /Describe the latest image/);
  assert.equal(
    logs.includes(
      "Successfully injected image file references and image comprehension instructions",
    ),
    true,
  );
});

test("message transform leaves native vision model image parts unchanged", async () => {
  const messages = [
    {
      info: { id: "message", sessionID: "session", role: "user" },
      parts: [
        {
          id: "text",
          sessionID: "session",
          messageID: "message",
          type: "text",
          text: "Describe this image",
        },
        {
          id: "image",
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,aW1hZ2U=",
        },
      ],
    },
  ];

  await transformMessagesForImageComprehension({
    messages,
    config: __test.resolvePluginConfig(null, null),
    configuredModels: undefined,
    model: {
      providerID: "vision-provider",
      modelID: "vision-model",
      supportsImageInput: true,
    },
    log: () => undefined,
  });

  assert.equal(
    messages[0].parts.some((part) => part.id === "image"),
    true,
  );
  assert.equal(messages[0].parts[0].text, "Describe this image");
});

test("plugin transform preserves native vision model image parts byte-for-byte", async () => {
  const testDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-vlm-preserve-${Date.now()}`,
  );
  await mkdir(testDirectory, { recursive: true });

  const client = {
    app: { log: async () => undefined },
    provider: {
      list: async () => ({
        data: {
          all: [
            {
              id: "omlx",
              models: {
                "Ornith-1.0-35B-OptiQ-4bit": {
                  modalities: { input: ["text", "image"] },
                },
              },
            },
          ],
        },
      }),
    },
  };
  const plugin = await ImageComprehensionPlugin({
    client,
    directory: testDirectory,
  });
  const messages = [
    {
      info: {
        id: "message",
        sessionID: "session",
        role: "user",
        model: {
          providerID: "omlx",
          modelID: "Ornith-1.0-35B-OptiQ-4bit",
        },
      },
      parts: [
        {
          id: "text",
          sessionID: "session",
          messageID: "message",
          type: "text",
          text: "Describe this exact image",
        },
        {
          id: "image",
          sessionID: "session",
          messageID: "message",
          type: "file",
          mime: "image/jpeg",
          filename: "vCO7V.jpg",
          url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD=",
          source: {
            type: "file",
            path: "/Users/ahmedhamdy/Downloads/vCO7V.jpg",
            text: { start: 0, end: 9, value: "[Image 1]" },
          },
        },
      ],
    },
  ];
  const before = structuredClone(messages);

  await plugin["experimental.chat.messages.transform"](
    {},
    { messages },
  );

  assert.deepEqual(messages, before);
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
  // Filenames must be lexically sortable (= chronological) and readable so
  // LLMs can find the latest image and reproduce the path without copying
  // 36 random hex chars. Format: image-YYYYMMDD-HHMMSS-xxxxxxxx.<ext>
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

  assert.equal(savedImages.length, 1);
  const filename = savedImages[0].path.split("/").pop() ?? "";
  // Lexically sortable timestamp prefix: image-20260718-150512-...
  assert.match(
    filename,
    new RegExp(
      `^${IMAGE_FILENAME_PREFIX}\\d{8}-\\d{6}-[0-9a-f]{${IMAGE_FILENAME_SHORT_ID_LENGTH}}\\.png$`,
    ),
  );
  // Must NOT be a bare UUID — the old format was gibberish to LLMs.
  assert.doesNotMatch(
    filename,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[1-9][0-9a-f]{11}/,
  );

  await cleanImageFixtures();
});

test("multiple images saved in the same second get distinct formatted filenames", async () => {
  // Two images materialized within the same second must still produce distinct
  // filenames because the timestamp is paired with a collision-safe suffix.
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

  const nameA = first[0].path.split("/").pop() ?? "";
  const nameB = second[0].path.split("/").pop() ?? "";
  assert.notEqual(nameA, nameB);
  // Both must match the new format (jpeg extension for the second one).
  assert.match(
    nameB,
    new RegExp(
      `^${IMAGE_FILENAME_PREFIX}\\d{8}-\\d{6}-[0-9a-f]{${IMAGE_FILENAME_SHORT_ID_LENGTH}}\\.jpg$`,
    ),
  );

  await cleanImageFixtures();
});

test("stale temp images older than the TTL are removed at cleanup", async () => {
  // The cleanup sweep protects LLMs from reasoning over a pile of stale
  // files. Files older than the TTL must be deleted; fresh files kept.
  // The default TTL is 1 hour — ephemeral conversation artifacts should not
  // accumulate across sessions.
  const testSweepDir = join(
    tmpdir(),
    `opencode-image-comprehension-test-sweep-${Date.now()}`,
  );
  await mkdir(testSweepDir, { recursive: true });
  // Plant a stale file (mtime set to 2 hours ago) and a fresh file (now).
  const stalePath = join(testSweepDir, "image-stale.png");
  const freshPath = join(testSweepDir, "image-fresh.png");
  await writeFile(stalePath, Buffer.from("stale"));
  await writeFile(freshPath, Buffer.from("fresh"));
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const { sweepStaleTempImages } = await import(
    "../../dist/image-materialization.js"
  );
  await utimes(stalePath, twoHoursAgo, twoHoursAgo);

  await sweepStaleTempImages({
    directory: testSweepDir,
    ttlHours: 1,
    log: () => undefined,
  });

  assert.equal(existsSync(stalePath), false, "stale file should be removed");
  assert.equal(existsSync(freshPath), true, "fresh file should be kept");

  // Cleanup the test dir.
  try {
    await unlink(freshPath);
  } catch {
    // ignore
  }
});

test("stale temp cleanup removes legacy UUID-named images", async () => {
  // The plugin used to materialize images as bare UUID filenames. Cleanup must
  // remove those stale files too, otherwise old artifacts keep polluting the
  // dedicated temp directory after users upgrade to sortable filenames.
  // The default TTL is 1 hour — ephemeral conversation artifacts should not
  // accumulate across sessions.
  const testSweepDir = join(
    tmpdir(),
    `opencode-image-comprehension-legacy-sweep-${Date.now()}`,
  );
  await mkdir(testSweepDir, { recursive: true });

  const legacyImagePath = join(
    testSweepDir,
    "123e4567-e89b-12d3-a456-426614174000.png",
  );
  const unrelatedPath = join(testSweepDir, "not-an-image.txt");
  await writeFile(legacyImagePath, Buffer.from("legacy"));
  await writeFile(unrelatedPath, Buffer.from("keep"));
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(legacyImagePath, twoHoursAgo, twoHoursAgo);
  await utimes(unrelatedPath, twoHoursAgo, twoHoursAgo);

  const { sweepStaleTempImages } = await import(
    "../../dist/image-materialization.js"
  );
  await sweepStaleTempImages({
    directory: testSweepDir,
    ttlHours: 1,
    log: () => undefined,
  });

  assert.equal(
    existsSync(legacyImagePath),
    false,
    "legacy image should be removed",
  );
  assert.equal(
    existsSync(unrelatedPath),
    true,
    "unrelated file should be kept",
  );

  try {
    await unlink(unrelatedPath);
  } catch {
    // ignore
  }
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

test("Ollama Cloud API key lookup uses config, configured env, then fallbacks", () => {
  const config = __test.resolvePluginConfig(
    { apiKeyEnv: "CUSTOM_OLLAMA_KEY" },
    null,
  );
  const env = {
    CUSTOM_OLLAMA_KEY: "custom-env-key",
    OLLAMA_CLOUD_API_KEY: "cloud-key",
    SEARCH_WEB_OLLAMA: "search-key",
    OLLAMA_API_KEY: "ollama-key",
  };

  assert.equal(
    getProviderApiKey({ ...config, apiKey: "config-key" }, env),
    "config-key",
  );
  assert.equal(getProviderApiKey(config, env), "custom-env-key");
  assert.equal(
    getProviderApiKey(
      __test.resolvePluginConfig({ apiKeyEnv: "MISSING_KEY" }, null),
      env,
    ),
    "cloud-key",
  );
  assert.equal(
    getProviderApiKey(
      __test.resolvePluginConfig({ apiKeyEnv: "MISSING_KEY" }, null),
      { SEARCH_WEB_OLLAMA: "search-key", OLLAMA_API_KEY: "ollama-key" },
    ),
    "search-key",
  );
});

test("Ollama Cloud response parser returns trimmed content and rejects malformed bodies", () => {
  assert.equal(
    parseOllamaCloudDescription({
      message: { content: "  image description  " },
    }),
    "image description",
  );
  assert.equal(
    parseOllamaCloudDescription({ message: { content: "   " } }),
    undefined,
  );
  assert.equal(parseOllamaCloudDescription({ message: {} }), undefined);
  assert.equal(parseOllamaCloudDescription(null), undefined);
});

test("default config with no provider set still resolves to ollama-cloud", () => {
  const config = __test.resolvePluginConfig(null, null);

  assert.equal(config.provider, "ollama-cloud");
  assert.equal(config.model, "gemma4:31b");
  assert.equal(config.baseUrl, "https://ollama.com/api/chat");
  assert.equal(config.apiKeyEnv, "OLLAMA_CLOUD_API_KEY");
});

test("configuring provider omlx resolves to oMLX defaults for model, url, and apiKeyEnv", () => {
  const config = __test.resolvePluginConfig({ provider: "omlx" }, null);

  assert.equal(config.provider, "omlx");
  assert.equal(config.model, DEFAULT_OMLX_MODEL);
  assert.equal(config.baseUrl, "http://localhost:8000/v1/chat/completions");
  assert.equal(config.apiKeyEnv, "OMLX_API_KEY");
});

test("omlx provider lets explicit config override oMLX defaults", () => {
  const config = __test.resolvePluginConfig(
    {
      provider: "omlx",
      model: "custom-mlx-model",
      baseUrl: "http://my-host:9000/v1/chat/completions",
      apiKeyEnv: "MY_OMLX_KEY",
    },
    null,
  );

  assert.equal(config.provider, "omlx");
  assert.equal(config.model, "custom-mlx-model");
  assert.equal(config.baseUrl, "http://my-host:9000/v1/chat/completions");
  assert.equal(config.apiKeyEnv, "MY_OMLX_KEY");
});

test("builds oMLX request in OpenAI-compatible format with data URL", () => {
  assert.deepEqual(
    __test.buildOmlxRequest({
      model: DEFAULT_OMLX_MODEL,
      prompt: "What is shown?",
      imageBase64: "aW1hZ2U=",
      mimeType: "image/png",
    }),
    {
      model: DEFAULT_OMLX_MODEL,
      stream: false,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is shown?" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aW1hZ2U=" },
            },
          ],
        },
      ],
    },
  );
});

test("getOmlxApiKey returns undefined when no optional key is configured", () => {
  // Reproduces the tmux scenario where ~/.env_exports is not sourced and no
  // OMLX_API_KEY is present in the environment.
  const config = __test.resolvePluginConfig({ provider: "omlx" }, null);

  assert.equal(getOmlxApiKey(config, {}), undefined);
});

test("getOmlxApiKey prefers config value, then configured env, then OMLX_API_KEY", () => {
  const config = __test.resolvePluginConfig({ provider: "omlx" }, null);

  assert.equal(
    getOmlxApiKey({ ...config, apiKey: "config-omlx-key" }, {}),
    "config-omlx-key",
  );
  assert.equal(
    getOmlxApiKey(config, { OMLX_API_KEY: "env-omlx-key" }),
    "env-omlx-key",
  );
  assert.equal(
    getOmlxApiKey(
      __test.resolvePluginConfig(
        { provider: "omlx", apiKeyEnv: "CUSTOM_OMLX_KEY" },
        null,
      ),
      { CUSTOM_OMLX_KEY: "custom-env-key" },
    ),
    "custom-env-key",
  );
});

test("oMLX request omits Authorization when no optional key is configured", async () => {
  const testDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-omlx-auth-${Date.now()}`,
  );
  const imagePath = join(testDirectory, "fixture.png");
  await mkdir(testDirectory, { recursive: true });
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const originalFetch = globalThis.fetch;
  const originalOmlxApiKey = process.env.OMLX_API_KEY;
  const originalConfiguredApiKey = process.env.TEST_OMLX_AUTH_KEY;
  let requestHeaders;

  delete process.env.OMLX_API_KEY;
  delete process.env.TEST_OMLX_AUTH_KEY;
  globalThis.fetch = async (_url, requestInit) => {
    requestHeaders = requestInit.headers;
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: "image description" } }],
        }),
    };
  };

  try {
    const description = await describeImageWithOmlx({
      imagePath,
      directory: testDirectory,
      prompt: "Describe the image",
      config: __test.resolvePluginConfig(
        { provider: "omlx", apiKeyEnv: "TEST_OMLX_AUTH_KEY" },
        null,
      ),
    });

    assert.equal(description, "image description");
    assert.equal(requestHeaders.Authorization, undefined);
    assert.equal(requestHeaders["Content-Type"], "application/json");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOmlxApiKey === undefined) delete process.env.OMLX_API_KEY;
    else process.env.OMLX_API_KEY = originalOmlxApiKey;
    if (originalConfiguredApiKey === undefined)
      delete process.env.TEST_OMLX_AUTH_KEY;
    else process.env.TEST_OMLX_AUTH_KEY = originalConfiguredApiKey;
  }
});

test("parseOmlxDescription extracts trimmed content from choices[0].message.content", () => {
  assert.equal(
    parseOmlxDescription({
      choices: [{ message: { content: "  image description  " } }],
    }),
    "image description",
  );
  assert.equal(
    parseOmlxDescription({
      choices: [{ message: { content: "   " } }],
    }),
    undefined,
  );
  assert.equal(parseOmlxDescription({ choices: [{ message: {} }] }), undefined);
  assert.equal(parseOmlxDescription({ choices: [] }), undefined);
  assert.equal(parseOmlxDescription({}), undefined);
  assert.equal(parseOmlxDescription(null), undefined);
});

test("extractImagesFromParts places materialized images in a session-scoped directory", async () => {
  // When a sessionID is provided, materialized images must land in
  // $TMPDIR/opencode-image-comprehension/<sessionID>/, not in the flat root.
  // This lets session cleanup wipe the whole directory when the session ends.
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
  // When no sessionID is given (legacy path), images should still materialize
  // in the base temp directory so existing tests and behavior are preserved.
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
  // Images from two concurrent sessions must never share a directory.
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
  // Sweep must traverse into per-session subdirectories and clean out any
  // stale images there, not just files at the base level.
  const testSweepDir = join(
    tmpdir(),
    `opencode-image-comprehension-sweep-session-${Date.now()}`,
  );
  const sessionDir = join(testSweepDir, "session-to-clean");
  await mkdir(sessionDir, { recursive: true });

  const staleFile = join(sessionDir, "image-stale.png");
  const freshFile = join(sessionDir, "image-fresh.png");
  await writeFile(staleFile, Buffer.from("stale"));
  await writeFile(freshFile, Buffer.from("fresh"));
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(staleFile, twoHoursAgo, twoHoursAgo);

  const { sweepStaleTempImages } = await import(
    "../../dist/image-materialization.js"
  );
  await sweepStaleTempImages({
    directory: testSweepDir,
    ttlHours: 1,
    log: () => undefined,
  });

  assert.equal(
    existsSync(staleFile),
    false,
    "stale file inside session dir should be removed",
  );
  assert.equal(
    existsSync(freshFile),
    true,
    "fresh file inside session dir should be kept",
  );

  // Cleanup remaining test artifacts.
  try {
    await unlink(freshFile);
    await unlink(sessionDir);
    await unlink(testSweepDir);
  } catch {
    // ignore
  }
});

test("sweepStaleTempImages removes empty session directories", async () => {
  // When a per-session directory has no image files left (all cleaned or
  // never created), sweep should remove the empty directory to keep the
  // temp dir tidy.
  const testSweepDir = join(
    tmpdir(),
    `opencode-image-comprehension-sweep-empty-${Date.now()}`,
  );
  await mkdir(testSweepDir, { recursive: true });

  const emptySessionDir = join(testSweepDir, "empty-session");
  await mkdir(emptySessionDir, { recursive: true });

  // Also plant a non-empty session dir to verify it is NOT removed.
  const activeSessionDir = join(testSweepDir, "active-session");
  await mkdir(activeSessionDir, { recursive: true });
  await writeFile(join(activeSessionDir, "image-some.png"), Buffer.from("keep"));

  const { sweepStaleTempImages } = await import(
    "../../dist/image-materialization.js"
  );
  await sweepStaleTempImages({
    directory: testSweepDir,
    ttlHours: 1,
    log: () => undefined,
  });

  const postSweepEntries = await readdir(testSweepDir);

  assert.equal(
    existsSync(emptySessionDir),
    false,
    "empty session dir should be removed",
  );
  assert.equal(
    existsSync(activeSessionDir),
    true,
    "active session dir should be kept",
  );

  // Cleanup.
  try {
    await unlink(join(activeSessionDir, "image-some.png"));
    await unlink(activeSessionDir);
    await unlink(testSweepDir);
  } catch {
    // ignore
  }
});

test("message transform injects session-scoped path into the LLM prompt", async () => {
  // The prompt shown to the LLM should reference the session-scoped image
  // path, so the LLM calls comprehend_image with a path that actually exists.
  const messages = [
    {
      info: {
        id: "prompt-message",
        sessionID: "prompt-session-xyz",
        role: "user",
      },
      parts: [
        {
          id: "prompt-text",
          sessionID: "prompt-session-xyz",
          messageID: "prompt-message",
          type: "text",
          text: "What is in this image?",
        },
        {
          id: "prompt-image",
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,aW1hZ2U=",
        },
      ],
    },
  ];
  const logs = [];

  await transformMessagesForImageComprehension({
    messages,
    config: __test.resolvePluginConfig({ activation: "force" }, null),
    configuredModels: undefined,
    model: undefined,
    log: (message) => logs.push(message),
    sessionID: "prompt-session-xyz",
  });

  const transformedText = messages[0].parts.find(
    (part) => part.type === "text",
  ).text;
  assert.match(
    transformedText,
    /\/prompt-session-xyz\//,
    "prompt must reference the session-scoped image path",
  );
  assert.match(transformedText, /comprehend_image/);
});

test("SavedImage exposes sessionID for session cleanup", async () => {
  // The SavedImage shape must carry sessionID so callers can drive cleanup
  // of per-session directories when a session ends.
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
