import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { ImageComprehensionPlugin } from "../../dist/index.js";
import {
  IMAGE_COMPREHENSION_ENABLED_KEY,
  TUI_PLUGIN_NAME,
} from "../../dist/constants.js";
import {
  getOpenCodeTuiStateFilePath,
  readImageComprehensionTuiEnabled,
} from "../../dist/tui-state.js";

function basicClient() {
  return {
    app: { log: async () => undefined },
    provider: { list: async () => ({ data: { all: [] } }) },
  };
}

function toolContext(
  directory,
  sessionID,
  messageID,
  metadata = () => undefined,
) {
  return {
    sessionID,
    messageID,
    agent: "build",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata,
    ask: async () => undefined,
  };
}

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
    toolContext(testDirectory, "vision-session", "vision-message"),
  );

  assert.equal(toolResult.metadata.blocked, true);
  assert.match(toolResult.output, /vision-capable model/);
  await rm(testDirectory, { recursive: true, force: true });
});

test("TUI plugin state is the source of truth for server enablement", async () => {
  const testDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-tui-toggle-${Date.now()}`,
  );
  const stateDirectory = join(testDirectory, "state");
  const stateFilePath = join(stateDirectory, "opencode", "kv.json");
  await mkdir(join(stateDirectory, "opencode"), { recursive: true });
  await mkdir(join(testDirectory, ".opencode"), { recursive: true });
  await writeFile(
    join(testDirectory, ".opencode", "opencode-image-comprehension.json"),
    JSON.stringify({ activation: "force" }),
  );

  const originalStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateDirectory;

  try {
    await writeFile(
      stateFilePath,
      JSON.stringify({
        [IMAGE_COMPREHENSION_ENABLED_KEY]: { [TUI_PLUGIN_NAME]: false },
      }),
    );
    const disabledPlugin = await ImageComprehensionPlugin({
      client: basicClient(),
      directory: testDirectory,
    });
    const disabledMessages = [
      {
        info: { id: "disabled-message", sessionID: "disabled", role: "user" },
        parts: [
          {
            id: "disabled-image",
            type: "file",
            mime: "image/png",
            url: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      },
    ];

    await disabledPlugin["experimental.chat.messages.transform"](
      {},
      { messages: disabledMessages },
    );
    assert.equal(disabledMessages[0].parts[0].id, "disabled-image");

    const disabledToolResult =
      await disabledPlugin.tool.comprehend_image.execute(
        { image_path: "missing.png", prompt: "describe" },
        toolContext(testDirectory, "disabled", "disabled-message"),
      );
    assert.equal(disabledToolResult.metadata.reason, "plugin-disabled");

    await writeFile(stateFilePath, JSON.stringify({}));
    const enabledPlugin = await ImageComprehensionPlugin({
      client: basicClient(),
      directory: testDirectory,
    });
    const enabledMessages = [
      {
        info: { id: "enabled-message", sessionID: "enabled", role: "user" },
        parts: [
          {
            id: "enabled-image",
            type: "file",
            mime: "image/png",
            url: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      },
    ];

    await enabledPlugin["experimental.chat.messages.transform"](
      {},
      { messages: enabledMessages },
    );
    assert.equal(
      enabledMessages[0].parts.some((part) => part.id === "enabled-image"),
      false,
    );
    assert.match(
      enabledMessages[0].parts.find((part) => part.type === "text").text,
      /comprehend_image/,
    );
  } finally {
    if (originalStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalStateHome;
    await rm(testDirectory, { recursive: true, force: true });
  }
});

test("missing TUI state preserves enabled-by-default behavior", async () => {
  const stateFilePath = join(
    tmpdir(),
    `opencode-image-comprehension-missing-state-${Date.now()}`,
    "kv.json",
  );

  assert.equal(await readImageComprehensionTuiEnabled({ stateFilePath }), true);
});

test("TUI companion exposes the same plugin id and a TUI entrypoint", async () => {
  const tuiModule = await import("../../dist/tui.js");

  assert.equal(tuiModule.default.id, TUI_PLUGIN_NAME);
  assert.equal(typeof tuiModule.default.tui, "function");
  assert.equal(
    getOpenCodeTuiStateFilePath({ XDG_STATE_HOME: "/tmp/state" }, "/tmp/home"),
    "/tmp/state/opencode/kv.json",
  );
});

test("vision-model system prompt forbids comprehend_image fallback", async () => {
  const testDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-system-${Date.now()}`,
  );
  await mkdir(testDirectory, { recursive: true });
  const plugin = await ImageComprehensionPlugin({
    client: basicClient(),
    directory: testDirectory,
  });

  const output = { system: [] };
  await plugin["experimental.chat.system.transform"](
    {
      sessionID: "vision-session",
      model: {
        id: "vision-model",
        providerID: "vision-provider",
        capabilities: { input: { image: true } },
      },
    },
    output,
  );

  assert.equal(output.system.length, 1);
  assert.match(output.system[0], /Do not call comprehend_image/);
  assert.match(output.system[0], /OpenCode model metadata says/);
  await rm(testDirectory, { recursive: true, force: true });
});

test("tool metadata identifies the exact processed image bytes", async () => {
  const testDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-tool-metadata-${Date.now()}`,
  );
  const imagePath = join(testDirectory, "fixture.png");
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  await mkdir(testDirectory, { recursive: true });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  const metadataEvents = [];

  try {
    await writeFile(imagePath, imageBytes);
    const plugin = await ImageComprehensionPlugin({
      client: basicClient(),
      directory: testDirectory,
    });
    const toolResult = await plugin.tool.comprehend_image.execute(
      { image_path: imagePath, prompt: "describe" },
      toolContext(
        testDirectory,
        "metadata-session",
        "metadata-message",
        (event) => metadataEvents.push(event),
      ),
    );

    assert.equal(toolResult.metadata.processed_image_path, imagePath);
    assert.equal(
      toolResult.metadata.processed_image_sha256,
      "0f4636c78f65d3639ece5a064b5ae753e3408614a14fb18ab4d7540d2c248543",
    );
    assert.equal(toolResult.metadata.image_bytes, imageBytes.byteLength);
    assert.equal(
      metadataEvents.at(-1).metadata.processed_image_path,
      imagePath,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(testDirectory, { recursive: true, force: true });
  }
});
