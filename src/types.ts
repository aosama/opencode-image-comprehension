import type { Plugin } from "@opencode-ai/plugin";

// Fully-resolved runtime config. By the time code receives this shape, all
// project/user/default precedence has already been applied and optional invalid
// config values have been discarded.
export interface PluginConfig {
  provider: "ollama-cloud";
  models?: string[];
  model: string;
  apiKey?: string;
  apiKeyEnv: string;
  baseUrl: string;
  timeoutSeconds: number;
  promptTemplate?: string;
  activation: ActivationMode;
}

// Raw config is intentionally permissive because it represents parsed JSON from
// disk. Individual fields are optional and pre-validated before becoming
// PluginConfig.
export interface RawPluginConfig {
  provider?: "ollama-cloud";
  models?: string[];
  model?: string;
  visionModel?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  timeoutSeconds?: number;
  promptTemplate?: string;
  activation?: ActivationMode;
}

// SavedImage is the bridge between OpenCode message parts and the LLM-visible
// prompt. `partId` lets the transform remove only the original image part that
// produced this file path.
export interface SavedImage {
  path: string;
  mime: string;
  partId: string;
}

// ResolvedLocalImage is returned after tool-time validation. The provider layer
// should only read image bytes from this validated shape.
export interface ResolvedLocalImage {
  absolutePath: string;
  mime: string;
}

// OpenCode stores the active model identity on user messages. supportsImageInput
// is added by this plugin after querying provider metadata when available.
export interface ModelInfo {
  providerID: string;
  modelID: string;
  supportsImageInput?: boolean;
}

// auto: use OpenCode metadata when possible, patterns as fallback only.
// force: always transform image media into local-path/tool instructions.
// disabled: never transform.
// patterns: transform only model/provider IDs matching configured patterns.
export type ActivationMode = "auto" | "force" | "disabled" | "patterns";

export type Logger = (msg: string) => void;
export type PluginClient = Parameters<Plugin>[0]["client"];

// Provider metadata shapes intentionally mirror the subset OpenCode exposes via
// client.provider.list(). Avoid importing a concrete SDK response type here so
// the plugin can tolerate small host-version shape differences.
export interface ProviderListData {
  all?: ProviderMetadata[];
  providers?: ProviderMetadata[];
}

export interface ProviderMetadata {
  id: string;
  models: Record<string, ProviderModelMetadata>;
}

export interface ProviderModelMetadata {
  id?: string;
  capabilities?: {
    input?: {
      image?: boolean;
    };
  };
  modalities?: {
    input?: string[];
  };
}
