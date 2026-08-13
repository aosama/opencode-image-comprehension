import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { readLocalImage } from "../image-materialization.js";
import type { PluginConfig, PreparedLocalImage } from "../types.js";

const DEFAULT_OPTIQ_API_KEY = "sk-optiq-local";

export function getOptiqApiKey(
  config: PluginConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return config.apiKey ?? env[config.apiKeyEnv] ?? env.OPTIQ_API_KEY;
}

export function buildOptiqRequest(input: {
  model: string;
  prompt: string;
  imageBase64: string;
  mimeType: string;
}): Record<string, unknown> {
  return {
    model: input.model,
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:${input.mimeType};base64,${input.imageBase64}`,
            },
          },
        ],
      },
    ],
  };
}

export function buildOptiqSdkClientOptions(input: {
  baseUrl: string;
  apiKey?: string;
  timeoutSeconds: number;
}) {
  return {
    apiKey: input.apiKey ?? DEFAULT_OPTIQ_API_KEY,
    baseURL: input.baseUrl.replace(/\/chat\/completions\/?$/, ""),
    maxRetries: 0,
    timeout: input.timeoutSeconds * 1000,
  };
}

export function parseOptiqDescription(
  responseBody: unknown,
): string | undefined {
  if (!responseBody || typeof responseBody !== "object") return undefined;
  const choices = (responseBody as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = (choices[0] as Record<string, unknown>)?.message;
  if (!message || typeof message !== "object") return undefined;
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string") return undefined;
  const trimmed = content.trim();
  return trimmed === "" ? undefined : trimmed;
}

export async function describeImageWithOptiq(input: {
  imagePath: string;
  directory: string;
  prompt: string;
  config: PluginConfig;
  preparedImage?: PreparedLocalImage;
}): Promise<string> {
  const preparedImage =
    input.preparedImage ??
    (await readLocalImage({
      imagePath: input.imagePath,
      directory: input.directory,
    }));
  const client = new OpenAI(
    buildOptiqSdkClientOptions({
      baseUrl: input.config.baseUrl,
      apiKey: getOptiqApiKey(input.config),
      timeoutSeconds: input.config.timeoutSeconds,
    }),
  );
  const completionRequest = buildOptiqRequest({
    model: input.config.model,
    prompt: input.prompt,
    imageBase64: preparedImage.base64,
    mimeType: preparedImage.mime,
  }) as unknown as ChatCompletionCreateParamsNonStreaming;
  (
    completionRequest as ChatCompletionCreateParamsNonStreaming & {
      chat_template_kwargs: { enable_thinking: boolean };
    }
  ).chat_template_kwargs = { enable_thinking: false };
  const completion = await client.chat.completions.create(completionRequest);
  const description = parseOptiqDescription(completion);
  if (!description)
    throw new Error("OptiQ returned empty or malformed response");
  return description;
}
