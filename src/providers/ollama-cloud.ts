import { readLocalImageAsBase64 } from "../image-materialization.js";
import type { PluginConfig } from "../types.js";

export function getProviderApiKey(
  config: PluginConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  // Config value wins for explicit per-project setup. The environment fallbacks
  // preserve compatibility with the user's existing Ollama Cloud conventions and
  // older integration scripts.
  return (
    config.apiKey ??
    env[config.apiKeyEnv] ??
    env.OLLAMA_CLOUD_API_KEY ??
    env.SEARCH_WEB_OLLAMA ??
    env.OLLAMA_API_KEY
  );
}

export function buildOllamaCloudRequest(input: {
  model: string;
  prompt: string;
  imageBase64: string;
}): Record<string, unknown> {
  // Ollama Cloud's chat endpoint accepts image input as base64 strings on the
  // message object. Keep the request builder pure and exported so tests can lock
  // this provider-specific wire shape without performing network calls.
  return {
    model: input.model,
    stream: false,
    messages: [
      {
        role: "user",
        content: input.prompt,
        images: [input.imageBase64],
      },
    ],
  };
}

export function parseOllamaCloudDescription(
  responseBody: unknown,
): string | undefined {
  // The provider response is untyped boundary data. Extract only the text field
  // we need and treat empty/malformed bodies as provider errors upstream.
  if (!responseBody || typeof responseBody !== "object") return undefined;
  const body = responseBody as Record<string, unknown>;
  const message = body.message;
  if (!message || typeof message !== "object") return undefined;
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string") return undefined;
  const trimmed = content.trim();
  return trimmed === "" ? undefined : trimmed;
}

export async function describeImageWithOllamaCloud(input: {
  imagePath: string;
  directory: string;
  prompt: string;
  config: PluginConfig;
}): Promise<string> {
  // Provider calls are deliberately late-bound: validate/read the local image,
  // construct one Ollama Cloud request, and return only textual content to the
  // LLM. The non-vision model never receives raw image bytes.
  const apiKey = getProviderApiKey(input.config);
  if (!apiKey) {
    throw new Error(
      `Missing Ollama Cloud API key. Set ${input.config.apiKeyEnv}, OLLAMA_CLOUD_API_KEY, or OLLAMA_API_KEY.`,
    );
  }

  const imageBase64 = await readLocalImageAsBase64({
    imagePath: input.imagePath,
    directory: input.directory,
  });
  const controller = new AbortController();
  // Bound both network stalls and slow provider responses with the same timeout
  // knob exposed in plugin config. AbortController is used instead of racing
  // promises so fetch can cancel the underlying request.
  const timeout = setTimeout(
    () => controller.abort(),
    input.config.timeoutSeconds * 1000,
  );

  try {
    const response = await fetch(input.config.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildOllamaCloudRequest({
          model: input.config.model,
          prompt: input.prompt,
          imageBase64,
        }),
      ),
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      // Include a short body prefix because provider errors often contain the
      // actionable reason (bad model, bad key, payload too large) in text/JSON.
      throw new Error(
        `Ollama Cloud request failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`,
      );
    }

    const parsedResponse = JSON.parse(responseText) as unknown;
    const description = parseOllamaCloudDescription(parsedResponse);
    if (!description)
      throw new Error("Ollama Cloud returned empty or malformed response");
    return description;
  } finally {
    clearTimeout(timeout);
  }
}
