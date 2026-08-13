import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_ACTIVATION_MODE,
  DEFAULT_API_KEY_ENV,
  DEFAULT_OMLX_API_KEY_ENV,
  DEFAULT_OMLX_MODEL,
  DEFAULT_OMLX_URL,
  DEFAULT_OPTIQ_API_KEY_ENV,
  DEFAULT_OPTIQ_IDLE_TIMEOUT_SECONDS,
  DEFAULT_OPTIQ_MODEL,
  DEFAULT_OPTIQ_SERVER_COMMAND,
  DEFAULT_OPTIQ_SERVER_HOST,
  DEFAULT_OPTIQ_SERVER_PORT,
  DEFAULT_OPTIQ_URL,
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
  const isOptiq = providerResult.value === "optiq";
  const optiqServer = {
    managed: selectWithPrecedence(
      projectConfig?.optiqServer?.managed,
      userConfig?.optiqServer?.managed,
      false,
    ).value,
    command: selectWithPrecedence(
      projectConfig?.optiqServer?.command,
      userConfig?.optiqServer?.command,
      DEFAULT_OPTIQ_SERVER_COMMAND,
    ).value,
    modelPath: selectWithPrecedence(
      projectConfig?.optiqServer?.modelPath,
      userConfig?.optiqServer?.modelPath,
      DEFAULT_OPTIQ_MODEL,
    ).value,
    host: selectWithPrecedence(
      projectConfig?.optiqServer?.host,
      userConfig?.optiqServer?.host,
      DEFAULT_OPTIQ_SERVER_HOST,
    ).value,
    port: selectWithPrecedence(
      projectConfig?.optiqServer?.port,
      userConfig?.optiqServer?.port,
      DEFAULT_OPTIQ_SERVER_PORT,
    ).value,
    idleTimeoutSeconds: selectWithPrecedence(
      projectConfig?.optiqServer?.idleTimeoutSeconds,
      userConfig?.optiqServer?.idleTimeoutSeconds,
      DEFAULT_OPTIQ_IDLE_TIMEOUT_SECONDS,
    ).value,
  };
  const defaultOptiqUrl = `http://${optiqServer.host}:${optiqServer.port}/v1/chat/completions`;

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
      isOmlx
        ? DEFAULT_OMLX_MODEL
        : isOptiq
          ? DEFAULT_OPTIQ_MODEL
          : DEFAULT_VISION_MODEL,
    ).value,
    apiKey: selectWithPrecedence(
      projectConfig?.apiKey,
      userConfig?.apiKey,
      undefined,
    ).value,
    apiKeyEnv: selectWithPrecedence(
      projectConfig?.apiKeyEnv,
      userConfig?.apiKeyEnv,
      isOmlx
        ? DEFAULT_OMLX_API_KEY_ENV
        : isOptiq
          ? DEFAULT_OPTIQ_API_KEY_ENV
          : DEFAULT_API_KEY_ENV,
    ).value,
    baseUrl: selectWithPrecedence(
      projectConfig?.baseUrl,
      userConfig?.baseUrl,
      isOmlx
        ? DEFAULT_OMLX_URL
        : isOptiq
          ? projectConfig?.optiqServer || userConfig?.optiqServer
            ? defaultOptiqUrl
            : DEFAULT_OPTIQ_URL
          : DEFAULT_OLLAMA_CLOUD_URL,
    ).value,
    timeoutSeconds: selectWithPrecedence(
      projectConfig?.timeoutSeconds,
      userConfig?.timeoutSeconds,
      DEFAULT_TIMEOUT_SECONDS,
    ).value,
    optiqServer,
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
    resolvedConfig.model,
  );
  log(
    modelResult.source !== "default"
      ? `Using vision model from ${modelResult.source} config: ${modelResult.value}`
      : `Using default vision model: ${modelResult.value}`,
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
