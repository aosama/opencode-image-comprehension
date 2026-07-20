import type { Plugin } from "@opencode-ai/plugin";
import type { Message, Model, Part } from "@opencode-ai/sdk";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModelInfo } from "./activation.js";
import { createComprehendImageTool } from "./comprehend-tool.js";
import { loadPluginConfig } from "./config.js";
import {
  DEFAULT_TEMP_IMAGE_TTL_HOURS,
  PLUGIN_NAME,
  TEMP_DIR_NAME,
} from "./constants.js";
import { sweepStaleTempImages } from "./image-materialization.js";
import { transformMessagesForImageComprehension } from "./message-transform.js";
import type { Logger } from "./types.js";
export { __test } from "./test-exports.js";

function findLastUserMessage(
  messages: Array<{ info: Message; parts: Part[] }>,
): { info: Message; parts: Part[] } | undefined {
  // The transform hook receives the full replayable conversation. Only the
  // latest user turn should be rewritten; mutating older user turns would make
  // future model replays drift from what the user actually sent at the time.
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    if (messages[messageIndex].info.role === "user")
      return messages[messageIndex];
  }
  return undefined;
}

function sdkModelSupportsImageInput(model: Model): boolean {
  return model.capabilities.input.image === true;
}

function rememberKnownSessionVisionCapability(
  modelSupportsImageInputBySessionID: Map<string, boolean>,
  sessionID: string | undefined,
  supportsImageInput: boolean | undefined,
): void {
  // The messages transform may only have a provider/model identity, while the
  // system transform receives richer SDK metadata. Do not overwrite a known
  // capability from one hook with "unknown" from another hook; only explicit
  // true/false values should update the session guard.
  if (!sessionID || typeof supportsImageInput !== "boolean") return;
  modelSupportsImageInputBySessionID.set(sessionID, supportsImageInput);
}

function createVisionModelSystemInstruction(): string {
  return [
    "OpenCode model metadata says this active model supports native image input.",
    "When the user attaches an image, including with #/local/path# attachment syntax, inspect the attached image directly from your multimodal context.",
    "Do not call comprehend_image. Do not call read to re-open attached images.",
    "Do not decide you are text-only from the model name; follow OpenCode's image-capability metadata for this session.",
  ].join(" ");
}

export const ImageComprehensionPlugin: Plugin = async (input) => {
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
    tool: {
      // This tool is a FALLBACK for text-only models. Vision-capable models
      // should look at images directly. The tool itself blocks calls from
      // vision models and tells them to look at the image natively instead.
      comprehend_image: createComprehendImageTool(
        () => pluginConfig,
        (context) =>
          modelSupportsImageInputBySessionID.get(context.sessionID) === true,
      ),
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      // Capability lookup needs the active model from the latest user message.
      // The transform itself separately finds and mutates that same latest user
      // message so this entry point remains only orchestration glue.
      const result = findLastUserMessage(output.messages);
      const model = result
        ? await resolveModelInfo(client, result, warn)
        : undefined;

      // Track this session's vision capability for the tool guard above. This
      // runs on every chat turn, so the map stays current if the user switches
      // models mid-session.
      if (result) {
        rememberKnownSessionVisionCapability(
          modelSupportsImageInputBySessionID,
          result.info.sessionID,
          model?.supportsImageInput,
        );
      }

      await transformMessagesForImageComprehension({
        messages: output.messages,
        config: pluginConfig,
        configuredModels: pluginConfig.models,
        model,
        log,
        sessionID: result?.info.sessionID,
      });
    },

    "experimental.chat.system.transform": async (systemInput, systemOutput) => {
      const modelSupportsImageInput = sdkModelSupportsImageInput(
        systemInput.model,
      );
      rememberKnownSessionVisionCapability(
        modelSupportsImageInputBySessionID,
        systemInput.sessionID,
        modelSupportsImageInput,
      );
      if (!modelSupportsImageInput) return;

      systemOutput.system.push(createVisionModelSystemInstruction());
    },
  };
};

// Current OpenCode file-plugin loading expects a v1 default export object with
// an id and server() function. Keeping named exports for tests is useful, but a
// default function export would fall into OpenCode's legacy export scanner and
// can be rejected when it sees non-plugin named exports like __test.
export const server = ImageComprehensionPlugin;

export default {
  id: PLUGIN_NAME,
  server,
};
