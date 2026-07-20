import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_ACTIVATION_MODE,
  DEFAULT_API_KEY_ENV,
  DEFAULT_OMLX_API_KEY_ENV,
  DEFAULT_OMLX_MODEL,
  DEFAULT_OMLX_URL,
  DEFAULT_OLLAMA_CLOUD_URL,
  DEFAULT_PROVIDER,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_VISION_MODEL,
} from "./constants.js";
import { getProjectConfigPath, getUserConfigPath } from "./config-paths.js";
import { parseConfigObject } from "./config-parse.js";
import type { Logger, PluginConfig, RawPluginConfig } from "./types.js";

export async function readConfigFile(
  configPath: string,
): Promise<RawPluginConfig | null> {
  // Missing or malformed config files are equivalent to absent config. This is a
  // plugin convenience layer, not a required OpenCode startup dependency.
  if (!existsSync(configPath)) return null;
  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    return parseConfigObject(parsed);
  } catch {
    return null;
  }
}

export function selectWithPrecedence<T>(
  projectValue: T | undefined,
  userValue: T | undefined,
  defaultValue: T,
): { value: T; source: "project" | "user" | "default" } {
  // Keep source tracking alongside the selected value so startup logs can state
  // where meaningful behavior came from without duplicating precedence logic.
  if (projectValue !== undefined)
    return { value: projectValue, source: "project" };
  if (userValue !== undefined) return { value: userValue, source: "user" };
  return { value: defaultValue, source: "default" };
}

export function resolvePluginConfig(
  projectConfig: RawPluginConfig | null,
  userConfig: RawPluginConfig | null,
): PluginConfig {
  // Resolve everything in one place so tests and runtime use the same precedence
  // behavior. Project config intentionally wins over user config because it is
  // closest to the repository/session being operated on.
  //
  // Provider is resolved first so the provider-specific defaults for model,
  // apiKeyEnv, and baseUrl can be selected. This lets a user set only
  // {"provider":"omlx"} and inherit oMLX defaults for the other fields instead
  // of having to repeat them.
  const providerResult = selectWithPrecedence(
    projectConfig?.provider,
    userConfig?.provider,
    DEFAULT_PROVIDER,
  );
  const isOmlx = providerResult.value === "omlx";

  return {
    provider: providerResult.value,
    models: selectWithPrecedence(
      projectConfig?.models,
      userConfig?.models,
      undefined,
    ).value,
    model: selectWithPrecedence(
      projectConfig?.model ?? projectConfig?.visionModel,
      userConfig?.model ?? userConfig?.visionModel,
      isOmlx ? DEFAULT_OMLX_MODEL : DEFAULT_VISION_MODEL,
    ).value,
    apiKey: selectWithPrecedence(
      projectConfig?.apiKey,
      userConfig?.apiKey,
      undefined,
    ).value,
    apiKeyEnv: selectWithPrecedence(
      projectConfig?.apiKeyEnv,
      userConfig?.apiKeyEnv,
      isOmlx ? DEFAULT_OMLX_API_KEY_ENV : DEFAULT_API_KEY_ENV,
    ).value,
    baseUrl: selectWithPrecedence(
      projectConfig?.baseUrl,
      userConfig?.baseUrl,
      isOmlx ? DEFAULT_OMLX_URL : DEFAULT_OLLAMA_CLOUD_URL,
    ).value,
    timeoutSeconds: selectWithPrecedence(
      projectConfig?.timeoutSeconds,
      userConfig?.timeoutSeconds,
      DEFAULT_TIMEOUT_SECONDS,
    ).value,
    promptTemplate: selectWithPrecedence(
      projectConfig?.promptTemplate,
      userConfig?.promptTemplate,
      undefined,
    ).value,
    activation: selectWithPrecedence(
      projectConfig?.activation,
      userConfig?.activation,
      DEFAULT_ACTIVATION_MODE,
    ).value,
  };
}

export async function loadPluginConfig(
  directory: string,
  log: Logger,
): Promise<PluginConfig> {
  // This function does two jobs: reads/merges config, then emits durable startup
  // facts into OpenCode's app log. The returned config is the only state the rest
  // of the plugin should depend on.
  const userConfig = await readConfigFile(getUserConfigPath());
  const projectConfig = await readConfigFile(getProjectConfigPath(directory));
  const resolvedConfig = resolvePluginConfig(projectConfig, userConfig);

  const modelsResult = selectWithPrecedence(
    projectConfig?.models,
    userConfig?.models,
    undefined,
  );
  if (modelsResult.source !== "default") {
    log(
      `Loaded models from ${modelsResult.source} config: ${modelsResult.value?.join(", ")}`,
    );
  } else {
    log(
      "Using auto-detection for non-vision models (no model patterns configured)",
    );
  }

  const providerResult = selectWithPrecedence(
    projectConfig?.provider,
    userConfig?.provider,
    DEFAULT_PROVIDER,
  );
  log(
    `Using ${providerResult.value} provider from ${providerResult.source} config`,
  );

  const modelResult = selectWithPrecedence(
    projectConfig?.model ?? projectConfig?.visionModel,
    userConfig?.model ?? userConfig?.visionModel,
    DEFAULT_VISION_MODEL,
  );
  log(
    modelResult.source !== "default"
      ? `Using vision model from ${modelResult.source} config: ${modelResult.value}`
      : `Using default vision model: ${DEFAULT_VISION_MODEL}`,
  );

  log(`Using provider endpoint: ${resolvedConfig.baseUrl}`);
  log(`Provider timeout: ${resolvedConfig.timeoutSeconds}s`);
  log(`Activation mode: ${resolvedConfig.activation}`);

  const templateResult = selectWithPrecedence(
    projectConfig?.promptTemplate,
    userConfig?.promptTemplate,
    undefined,
  );
  log(
    templateResult.source !== "default"
      ? `Using prompt template from ${templateResult.source} config (${templateResult.value?.length ?? 0} chars)`
      : "Using default injection prompt template",
  );

  return resolvedConfig;
}
