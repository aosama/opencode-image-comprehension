import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPluginConfig } from "./config.js";
import {
  DEFAULT_TEMP_IMAGE_TTL_HOURS,
  PLUGIN_NAME,
  TEMP_DIR_NAME,
} from "./constants.js";
import { sweepStaleTempImages } from "./image-materialization.js";
import type { Logger, PluginClient } from "./types.js";

export async function setupImageComprehensionPlugin(input: {
  client: PluginClient;
  directory: string;
}) {
  const { client, directory } = input;

  // OpenCode exposes logging as an async app API. Plugin hooks should never
  // fail just because logging failed, so logging errors are intentionally
  // swallowed at this boundary.
  const log: Logger = (message) => {
    client.app
      .log({ body: { service: PLUGIN_NAME, level: "info", message } })
      .catch(() => {});
  };

  const warn: Logger = (message) => {
    client.app
      .log({ body: { service: PLUGIN_NAME, level: "warn", message } })
      .catch(() => {});
  };

  // Keep the resolved config scoped to this plugin invocation. OpenCode may load
  // the same plugin for more than one directory in one process, and module-level
  // config would let later loads change earlier tool instances.
  const pluginConfig = await loadPluginConfig(directory, log);
  log(
    `Plugin initialized with ${pluginConfig.provider} model '${pluginConfig.model}'`,
  );

  // Best-effort cleanup of stale materialized images before this session adds
  // new ones. Failures are swallowed inside the sweep so a non-writable or
  // missing temp dir never blocks plugin startup.
  await sweepStaleTempImages({
    directory: join(tmpdir(), TEMP_DIR_NAME),
    ttlHours: DEFAULT_TEMP_IMAGE_TTL_HOURS,
    log,
  }).catch(() => {});

  // Track each session's current model capability so we can block
  // vision-capable models from calling comprehend_image. The tool is always
  // registered (the plugin API does not support conditional registration), but
  // vision models should look at images natively instead of routing through
  // this fallback tool. A map is required because OpenCode can interleave
  // multiple sessions in one plugin instance.
  const modelSupportsImageInputBySessionID = new Map<string, boolean>();

  return {
    pluginConfig,
    log,
    warn,
    modelSupportsImageInputBySessionID,
  };
}
