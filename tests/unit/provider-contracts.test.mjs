import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { __test } from "../../dist/index.js";
import {
  describeImageWithOmlx,
  getOmlxApiKey,
  parseOmlxDescription,
} from "../../dist/providers/omlx.js";
import {
  getProviderApiKey,
  parseOllamaCloudDescription,
} from "../../dist/providers/ollama-cloud.js";
import { parseOptiqDescription } from "../../dist/providers/optiq.js";
import {
  DEFAULT_OMLX_MODEL,
  OMLX_IMAGE_SYSTEM_PROMPT,
  OMLX_THINKING_BUDGET_TOKENS,
} from "../../dist/constants.js";

test("default config with no provider set still resolves to ollama-cloud", () => {
  const config = __test.resolvePluginConfig(null, null);

  assert.equal(config.provider, "ollama-cloud");
  assert.equal(config.model, "gemma4:31b");
  assert.equal(config.baseUrl, "https://ollama.com/api/chat");
  assert.equal(config.apiKeyEnv, "OLLAMA_CLOUD_API_KEY");
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
        { role: "system", content: OMLX_IMAGE_SYSTEM_PROMPT },
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

test("oMLX image requests use the focused system prompt and thinking budget", () => {
  assert.equal(
    OMLX_IMAGE_SYSTEM_PROMPT,
    "You are a helpful assitant whose sole purpose is to read the image provided and respond to the user's quesiton, there is no other purpose for you than this.",
  );
  assert.equal(OMLX_THINKING_BUDGET_TOKENS, 1024);
});

test("configures the official OpenAI SDK for the oMLX-compatible endpoint", () => {
  assert.deepEqual(
    __test.buildOmlxSdkClientOptions({
      baseUrl: "http://localhost:8000/v1/chat/completions",
      timeoutSeconds: 180,
    }),
    {
      apiKey: "omlx-local",
      baseURL: "http://localhost:8000/v1",
      maxRetries: 0,
      timeout: 180_000,
    },
  );
});

test("getOmlxApiKey returns undefined when no optional key is configured", () => {
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

test("oMLX request uses the local placeholder authorization when no key is configured", async () => {
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
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "image description" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
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
    assert.equal(requestHeaders.get("authorization"), "Bearer omlx-local");
    assert.equal(requestHeaders.get("content-type"), "application/json");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOmlxApiKey === undefined) delete process.env.OMLX_API_KEY;
    else process.env.OMLX_API_KEY = originalOmlxApiKey;
    if (originalConfiguredApiKey === undefined)
      delete process.env.TEST_OMLX_AUTH_KEY;
    else process.env.TEST_OMLX_AUTH_KEY = originalConfiguredApiKey;
    await rm(testDirectory, { recursive: true, force: true });
  }
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

test("oMLX response parser extracts trimmed content from choices[0].message.content", () => {
  assert.equal(
    parseOmlxDescription({
      choices: [{ message: { content: "  image description  " } }],
    }),
    "image description",
  );
  assert.equal(
    parseOmlxDescription({ choices: [{ message: { content: "   " } }] }),
    undefined,
  );
  assert.equal(parseOmlxDescription({ choices: [{ message: {} }] }), undefined);
  assert.equal(parseOmlxDescription({ choices: [] }), undefined);
  assert.equal(parseOmlxDescription({}), undefined);
  assert.equal(parseOmlxDescription(null), undefined);
});

test("OptiQ response parser rejects an empty provider response", () => {
  assert.equal(
    parseOptiqDescription({ choices: [{ message: { content: "  " } }] }),
    undefined,
  );
});
