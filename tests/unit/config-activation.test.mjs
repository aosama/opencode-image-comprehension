import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { ImageComprehensionPlugin, __test } from "../../dist/index.js";
import { resolveLocalImagePath } from "../../dist/image-materialization.js";

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

  const resolvedImage = await __test.resolveLocalImagePath({
    imagePath: "fixture.png",
    directory: testDirectory,
  });

  assert.equal(resolvedImage.absolutePath, imagePath);
  assert.equal(resolvedImage.mime, "image/png");
  await rm(testDirectory, { recursive: true, force: true });
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
    JSON.stringify({ provider: "ollama-cloud", model: "first-vision-model" }),
  );
  await writeFile(
    join(secondConfigDirectory, "opencode-image-comprehension.json"),
    JSON.stringify({ provider: "ollama-cloud", model: "second-vision-model" }),
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
  await writeFile(join(firstDirectory, "fixture.png"), Buffer.from("image"));

  let toolMetadata;
  await firstPlugin.tool.comprehend_image.execute(
    { image_path: "fixture.png", prompt: "describe" },
    {
      sessionID: "config-isolation-session",
      messageID: "config-isolation-message",
      agent: "build",
      directory: firstDirectory,
      worktree: firstDirectory,
      abort: new AbortController().signal,
      metadata: (metadata) => {
        toolMetadata = metadata;
      },
      ask: async () => undefined,
    },
  );

  assert.equal(toolMetadata.metadata.model, "first-vision-model");
  await rm(firstDirectory, { recursive: true, force: true });
  await rm(secondDirectory, { recursive: true, force: true });
});

test("configuring provider omlx resolves to oMLX defaults for model, url, and apiKeyEnv", () => {
  const config = __test.resolvePluginConfig({ provider: "omlx" }, null);

  assert.equal(config.provider, "omlx");
  assert.equal(config.model, "Ornith-1.0-9B-OptiQ-4bit");
  assert.equal(config.baseUrl, "http://localhost:8000/v1/chat/completions");
  assert.equal(config.apiKeyEnv, "OMLX_API_KEY");
});

test("configuring provider optiq resolves to OptiQ defaults for model, url, and apiKeyEnv", () => {
  const config = __test.resolvePluginConfig({ provider: "optiq" }, null);

  assert.equal(config.provider, "optiq");
  assert.equal(config.model, "Ornith-1.0-9B-OptiQ-4bit");
  assert.equal(config.baseUrl, "http://localhost:8080/v1/chat/completions");
  assert.equal(config.apiKeyEnv, "OPTIQ_API_KEY");
  assert.equal(config.optiqServer.managed, false);
  assert.equal(config.optiqServer.idleTimeoutSeconds, 10);
});

test("managed OptiQ server settings derive the matching local endpoint", () => {
  const config = __test.resolvePluginConfig(
    {
      provider: "optiq",
      optiqServer: {
        managed: true,
        host: "127.0.0.2",
        port: 18080,
        idleTimeoutSeconds: 10,
      },
    },
    null,
  );

  assert.equal(config.baseUrl, "http://127.0.0.2:18080/v1/chat/completions");
  assert.equal(config.optiqServer.managed, true);
  assert.equal(config.optiqServer.host, "127.0.0.2");
  assert.equal(config.optiqServer.port, 18080);
});

test("invalid managed OptiQ ports are discarded at the config boundary", () => {
  const parsedConfig = __test.parseConfigObject({
    provider: "optiq",
    optiqServer: { managed: true, port: 70_000 },
  });
  const config = __test.resolvePluginConfig(parsedConfig, null);

  assert.equal(config.optiqServer.port, 8080);
  assert.equal(config.baseUrl, "http://127.0.0.1:8080/v1/chat/completions");
});

test("OptiQ provider completes the image tool journey through an OpenAI-compatible endpoint", async () => {
  const testDirectory = join(
    tmpdir(),
    `opencode-image-comprehension-optiq-journey-${Date.now()}`,
  );
  const configDirectory = join(testDirectory, ".opencode");
  const imagePath = join(testDirectory, "fixture.jpg");
  await mkdir(configDirectory, { recursive: true });
  await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(
    join(configDirectory, "opencode-image-comprehension.json"),
    JSON.stringify({
      provider: "optiq",
      model: "local-optiq-vision",
      baseUrl: "http://127.0.0.1:8080/v1/chat/completions",
      optiqServer: { managed: false },
    }),
  );

  const originalFetch = globalThis.fetch;
  let capturedRequestUrl;
  let capturedRequestBody;
  globalThis.fetch = async (requestUrl, requestInit) => {
    capturedRequestUrl = requestUrl;
    capturedRequestBody = JSON.parse(requestInit.body);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "A locally processed OptiQ image." } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const plugin = await ImageComprehensionPlugin({
      client: {
        app: { log: async () => undefined },
        provider: { list: async () => ({ data: { all: [] } }) },
      },
      directory: testDirectory,
    });
    const toolResult = await plugin.tool.comprehend_image.execute(
      { image_path: imagePath, prompt: "Describe this image." },
      {
        sessionID: "optiq-journey-session",
        messageID: "optiq-journey-message",
        agent: "build",
        directory: testDirectory,
        worktree: testDirectory,
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      },
    );

    assert.equal(toolResult.output, "A locally processed OptiQ image.");
    assert.equal(
      capturedRequestUrl,
      "http://127.0.0.1:8080/v1/chat/completions",
    );
    assert.equal(capturedRequestBody.model, "local-optiq-vision");
    assert.equal(capturedRequestBody.stream, false);
    assert.equal(capturedRequestBody.thinking_budget, undefined);
    assert.deepEqual(
      capturedRequestBody.messages[0].content.map((part) => part.type),
      ["text", "image_url"],
    );
    assert.match(
      capturedRequestBody.messages[0].content[1].image_url.url,
      /^data:image\/jpeg;base64,/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(testDirectory, { recursive: true, force: true });
  }
});
