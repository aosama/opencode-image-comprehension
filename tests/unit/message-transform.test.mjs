import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { ImageComprehensionPlugin } from "../../dist/index.js";
import { __test } from "../../dist/index.js";
import { transformMessagesForImageComprehension } from "../../dist/message-transform.js";

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
  await rm(testDirectory, { recursive: true, force: true });
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

  await plugin["experimental.chat.messages.transform"]({}, { messages });

  assert.deepEqual(messages, before);
  await rm(testDirectory, { recursive: true, force: true });
});

test("message transform injects session-scoped path into the LLM prompt", async () => {
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
  assert.match(transformedText, /\/prompt-session-xyz\//);
  assert.match(transformedText, /comprehend_image/);
});
