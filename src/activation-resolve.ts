import type { Message } from "@opencode-ai/sdk";
import type {
  Logger,
  ModelInfo,
  PluginClient,
  ProviderListData,
  ProviderMetadata,
  ProviderModelMetadata,
} from "./types.js";

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
