import type { Message } from "@opencode-ai/sdk";
import type {
  ActivationMode,
  Logger,
  ModelInfo,
  PluginClient,
  ProviderListData,
  ProviderMetadata,
  ProviderModelMetadata,
} from "./types.js";

function matchesWildcardPattern(pattern: string, value: string): boolean {
  // Pattern support is intentionally small: exact, leading wildcard, trailing
  // wildcard, contains wildcard, and all. That is enough for provider/model
  // targeting without introducing a full glob dependency into runtime code.
  const normalizedPattern = pattern.toLowerCase();
  const normalizedValue = value.toLowerCase();
  if (normalizedPattern === "*") return true;
  if (
    normalizedPattern.startsWith("*") &&
    normalizedPattern.endsWith("*") &&
    normalizedPattern.length > 2
  ) {
    return normalizedValue.includes(normalizedPattern.slice(1, -1));
  }
  if (normalizedPattern.endsWith("*"))
    return normalizedValue.startsWith(normalizedPattern.slice(0, -1));
  if (normalizedPattern.startsWith("*"))
    return normalizedValue.endsWith(normalizedPattern.slice(1));
  return normalizedValue === normalizedPattern;
}

function matchesSinglePattern(pattern: string, model: ModelInfo): boolean {
  // Patterns can target either a model/provider name alone or provider/model as
  // a pair. The single-token form is forgiving because users often remember one
  // side of the OpenCode model identity but not the full provider prefix.
  if (pattern === "*") return true;
  const slashIndex = pattern.indexOf("/");
  if (slashIndex === -1) {
    return (
      matchesWildcardPattern(pattern, model.modelID) ||
      matchesWildcardPattern(pattern, model.providerID)
    );
  }
  return (
    matchesWildcardPattern(pattern.slice(0, slashIndex), model.providerID) &&
    matchesWildcardPattern(pattern.slice(slashIndex + 1), model.modelID)
  );
}

function modelMatchesAnyPattern(
  model: ModelInfo | undefined,
  patterns: readonly string[] | undefined,
): boolean {
  if (!model || !patterns) return false;
  return patterns.some((pattern) => matchesSinglePattern(pattern, model));
}

export function shouldActivateImageComprehension(input: {
  activation: ActivationMode;
  model: ModelInfo | undefined;
  configuredPatterns: readonly string[] | undefined;
}): boolean {
  // Activation answers one question: should this plugin strip image media and
  // replace it with file-path/tool instructions? Vision-capable models should
  // keep native image input untouched so we do not degrade their experience.
  if (input.activation === "disabled") return false;
  if (input.activation === "force") return true;
  if (input.activation === "patterns")
    return modelMatchesAnyPattern(input.model, input.configuredPatterns);
  if (input.model?.supportsImageInput === true) return false;
  if (input.model?.supportsImageInput === false) return true;
  if (input.configuredPatterns)
    return modelMatchesAnyPattern(input.model, input.configuredPatterns);
  return false;
}

export function modelMetadataSupportsImageInput(
  model: ProviderModelMetadata,
): boolean | undefined {
  // OpenCode/model metadata has used more than one shape over time. Support both
  // the newer explicit capability flag and the older modality-list form so the
  // plugin keeps working across host versions.
  const capabilityValue = model.capabilities?.input?.image;
  if (typeof capabilityValue === "boolean") return capabilityValue;
  const inputModalities = model.modalities?.input;
  if (Array.isArray(inputModalities)) return inputModalities.includes("image");
  return undefined;
}

function providersFromListData(
  data: ProviderListData | undefined,
): ProviderMetadata[] {
  // SDK/provider list responses have appeared as either `all` or `providers`.
  // Normalize here so callers do not encode response-shape assumptions.
  if (!data) return [];
  if (Array.isArray(data.all)) return data.all;
  if (Array.isArray(data.providers)) return data.providers;
  return [];
}

export function findModelCapabilityInProviderList(
  data: ProviderListData | undefined,
  model: ModelInfo,
): ModelInfo {
  const provider = providersFromListData(data).find(
    (candidate) => candidate.id === model.providerID,
  );
  const metadata = provider?.models[model.modelID];
  if (!metadata) return model;
  return {
    ...model,
    supportsImageInput: modelMetadataSupportsImageInput(metadata),
  };
}

export function getModelFromMessage(message: {
  info: Message;
}): ModelInfo | undefined {
  // The plugin transform hook itself does not receive model metadata directly;
  // OpenCode currently stores the active model on the user message info object.
  // Keep this cast isolated so any future SDK shape change has one repair point.
  const info = message.info as { model?: ModelInfo };
  return info.model;
}

export async function resolveModelInfo(
  client: PluginClient,
  message: { info: Message },
  warn: Logger,
): Promise<ModelInfo | undefined> {
  // Best effort only: when provider metadata lookup fails, return the message's
  // model identity without image support information. The activation policy then
  // decides whether to fall back to configured patterns or skip transformation.
  const model = getModelFromMessage(message);
  if (!model) return undefined;
  try {
    const providerListResult = await client.provider.list();
    return findModelCapabilityInProviderList(
      providerListResult.data as ProviderListData | undefined,
      model,
    );
  } catch (error) {
    warn(
      `Failed to resolve model capabilities from OpenCode: ${error instanceof Error ? error.message : String(error)}`,
    );
    return model;
  }
}
