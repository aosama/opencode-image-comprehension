import { PROMPT_TEMPLATE_VARIABLES } from "./constants.js";
import type { ActivationMode, RawPluginConfig } from "./types.js";

function parseModelsArray(value: unknown): string[] | undefined {
  // Treat malformed config as absent rather than fatal. Plugin startup should be
  // resilient: a typo in optional config should not prevent OpenCode from
  // starting or block normal non-image chat usage.
  if (!Array.isArray(value)) return undefined;
  const models = value.filter(
    (model): model is string => typeof model === "string",
  );
  return models.length > 0 ? models : undefined;
}

function parseString(value: unknown): string | undefined {
  // Empty strings are not meaningful configuration values. Returning undefined
  // lets the normal project > user > default precedence path handle them.
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseProvider(value: unknown): "ollama-cloud" | "omlx" | undefined {
  // Keep the provider enum deliberately narrow. Unknown provider values are
  // ignored instead of accepted and failing later in tool execution.
  if (value === "ollama-cloud" || value === "omlx") return value;
  return undefined;
}

function parseBaseUrl(value: unknown): string | undefined {
  // URL parsing normalizes things like missing trailing slashes and rejects
  // unsupported schemes. The provider request code assumes HTTP semantics.
  const trimmed = parseString(value);
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function parseTimeoutSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const seconds = Math.trunc(value);
  return seconds > 0 ? seconds : undefined;
}

function parseActivationMode(value: unknown): ActivationMode | undefined {
  if (
    value === "auto" ||
    value === "force" ||
    value === "disabled" ||
    value === "patterns"
  )
    return value;
  return undefined;
}

function parsePromptTemplate(value: unknown): string | undefined {
  // A template without any supported variable would replace the user's prompt
  // with static text and hide the image paths. Reject it so the safe default
  // prompt remains in use.
  const trimmed = parseString(value);
  if (!trimmed) return undefined;
  if (
    !PROMPT_TEMPLATE_VARIABLES.some((templateVariable) =>
      trimmed.includes(templateVariable),
    )
  )
    return undefined;
  return trimmed;
}

export function parseConfigObject(raw: unknown): RawPluginConfig {
  // Parse boundary data immediately into a typed, partially-valid config object.
  // Each property parser is intentionally independent so one bad key does not
  // discard unrelated valid keys in the same file.
  if (!raw || typeof raw !== "object") return {};
  const configObject = raw as Record<string, unknown>;
  return {
    provider: parseProvider(configObject.provider),
    models: parseModelsArray(configObject.models),
    model: parseString(configObject.model),
    visionModel: parseString(configObject.visionModel),
    apiKey: parseString(configObject.apiKey),
    apiKeyEnv: parseString(configObject.apiKeyEnv),
    baseUrl: parseBaseUrl(configObject.baseUrl),
    timeoutSeconds: parseTimeoutSeconds(configObject.timeoutSeconds),
    promptTemplate: parsePromptTemplate(configObject.promptTemplate),
    activation: parseActivationMode(configObject.activation),
  };
}
