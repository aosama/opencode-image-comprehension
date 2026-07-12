import { readLocalImage } from "../image-materialization.js";
import type { PluginConfig } from "../types.js";

export function getOmlxApiKey(
  config: PluginConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  // Authentication is optional for oMLX servers that skip key verification.
  // Explicit config and environment values still support secured deployments.
  return config.apiKey ?? env[config.apiKeyEnv] ?? env.OMLX_API_KEY;
}

export function buildOmlxRequest(input: {
  model: string;
  prompt: string;
  imageBase64: string;
  mimeType: string;
}): Record<string, unknown> {
  // oMLX exposes an OpenAI-compatible chat endpoint. Image input is sent as a
  // data URL inside a content array alongside the text prompt. Keep the request
  // builder pure and exported so tests can lock this provider-specific wire
  // shape without performing network calls.
  const dataUrl = `data:${input.mimeType};base64,${input.imageBase64}`;
  return {
    model: input.model,
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };
}

export function parseOmlxDescription(
  responseBody: unknown,
): string | undefined {
  // The provider response is untyped boundary data. Extract only the text field
  // we need from the OpenAI-compatible choices array and treat empty/malformed
  // bodies as provider errors upstream.
  if (!responseBody || typeof responseBody !== "object") return undefined;
  const body = responseBody as Record<string, unknown>;
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const firstChoice = choices[0] as Record<string, unknown>;
  const message = firstChoice?.message;
  if (!message || typeof message !== "object") return undefined;
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string") return undefined;
  const trimmed = content.trim();
  return trimmed === "" ? undefined : trimmed;
}

export async function describeImageWithOmlx(input: {
  imagePath: string;
  directory: string;
  prompt: string;
  config: PluginConfig;
}): Promise<string> {
  // Provider calls are deliberately late-bound: validate/read the local image,
  // construct one oMLX request, and return only textual content to the LLM.
  // The non-vision model never receives raw image bytes.
  const apiKey = getOmlxApiKey(input.config);
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) requestHeaders.Authorization = `Bearer ${apiKey}`;

  const { base64: imageBase64, mime: mimeType } = await readLocalImage({
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
      headers: requestHeaders,
      body: JSON.stringify(
        buildOmlxRequest({
          model: input.config.model,
          prompt: input.prompt,
          imageBase64,
          mimeType,
        }),
      ),
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      // Include a short body prefix because provider errors often contain the
      // actionable reason (bad model, bad key, payload too large) in text/JSON.
      throw new Error(
        `oMLX request failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`,
      );
    }

    const parsedResponse = JSON.parse(responseText) as unknown;
    const description = parseOmlxDescription(parsedResponse);
    if (!description)
      throw new Error("oMLX returned empty or malformed response");
    return description;
  } finally {
    clearTimeout(timeout);
  }
}
