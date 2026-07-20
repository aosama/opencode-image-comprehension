import type { Message, Model, Part } from "@opencode-ai/sdk";
import { resolveModelInfo } from "./activation.js";
import { createComprehendImageTool } from "./comprehend-tool.js";
import { transformMessagesForImageComprehension } from "./message-transform.js";
import type { Logger, PluginClient, PluginConfig } from "./types.js";

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

export function createPluginHooks(input: {
  pluginConfig: PluginConfig;
  log: Logger;
  warn: Logger;
  modelSupportsImageInputBySessionID: Map<string, boolean>;
  client: PluginClient;
}) {
  const {
    pluginConfig,
    log,
    warn,
    modelSupportsImageInputBySessionID,
    client,
  } = input;

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

    "experimental.chat.messages.transform": async (
      _input: {},
      output: { messages: Array<{ info: Message; parts: Part[] }> },
    ) => {
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

    "experimental.chat.system.transform": async (
      systemInput: { sessionID?: string; model: Model },
      systemOutput: { system: string[] },
    ) => {
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
}
