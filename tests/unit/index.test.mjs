import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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
  getOmlxApiKey,
  parseOmlxDescription,
} from "../../dist/providers/omlx.js";

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
  assert.equal(config.model, "Ornith-1.0-9B-8bit");
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
      model: "Ornith-1.0-9B-8bit",
      prompt: "What is shown?",
      imageBase64: "aW1hZ2U=",
      mimeType: "image/png",
    }),
    {
      model: "Ornith-1.0-9B-8bit",
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

test("getOmlxApiKey falls back to default 1234 when no config or env key is set", () => {
  // Reproduces the tmux scenario where ~/.env_exports is not sourced and no
  // OMLX_API_KEY is present in the environment.
  const config = __test.resolvePluginConfig({ provider: "omlx" }, null);

  assert.equal(getOmlxApiKey(config, {}), "1234");
});

test("getOmlxApiKey prefers config value, then configured env, then OMLX_API_KEY, then default", () => {
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
  assert.equal(
    parseOmlxDescription({ choices: [{ message: {} }] }),
    undefined,
  );
  assert.equal(parseOmlxDescription({ choices: [] }), undefined);
  assert.equal(parseOmlxDescription({}), undefined);
  assert.equal(parseOmlxDescription(null), undefined);
});
