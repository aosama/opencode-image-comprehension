import { readLocalImage } from "../image-materialization.js";
import {
  OMLX_IMAGE_SYSTEM_PROMPT,
  OMLX_THINKING_BUDGET_TOKENS,
} from "../constants.js";
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { PluginConfig, PreparedLocalImage } from "../types.js";

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
      { role: "system", content: OMLX_IMAGE_SYSTEM_PROMPT },
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

export function buildOmlxSdkClientOptions(input: {
  baseUrl: string;
  apiKey?: string;
  timeoutSeconds: number;
}) {
  return {
    apiKey: input.apiKey ?? "omlx-local",
    baseURL: input.baseUrl.replace(/\/chat\/completions\/?$/, ""),
    maxRetries: 0,
    timeout: input.timeoutSeconds * 1000,
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
  preparedImage?: PreparedLocalImage;
}): Promise<string> {
  // Provider calls are deliberately late-bound: validate/read the local image,
  // construct one oMLX request, and return only textual content to the LLM.
  // The non-vision model never receives raw image bytes.
  const apiKey = getOmlxApiKey(input.config);
  const preparedImage =
    input.preparedImage ??
    (await readLocalImage({
      imagePath: input.imagePath,
      directory: input.directory,
    }));
  const { base64: imageBase64, mime: mimeType } = preparedImage;
  const client = new OpenAI(
    buildOmlxSdkClientOptions({
      baseUrl: input.config.baseUrl,
      apiKey,
      timeoutSeconds: input.config.timeoutSeconds,
    }),
  );
  const completionRequest = {
    model: input.config.model,
    stream: false,
    messages: [
      { role: "system", content: OMLX_IMAGE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
            },
          },
        ],
      },
    ],
    // oMLX-specific extension accepted by its OpenAI-compatible endpoint.
    thinking_budget: OMLX_THINKING_BUDGET_TOKENS,
  } as ChatCompletionCreateParamsNonStreaming & {
    thinking_budget: number;
  };
  const completion = (await client.chat.completions.create(
    completionRequest,
  )) as OpenAI.Chat.Completions.ChatCompletion;
  const description = completion.choices[0]?.message.content?.trim();
  if (!description)
    throw new Error("oMLX returned empty or malformed response");
  return description;
}
