import type { Plugin } from "@opencode-ai/plugin";
import type { Message, Part } from "@opencode-ai/sdk";
import { resolveModelInfo } from "./activation.js";
import { PLUGIN_NAME } from "./constants.js";
import { createComprehendImageTool } from "./comprehend-tool.js";
import { loadPluginConfig } from "./config.js";
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

  return {
    tool: {
      // This is the tool the non-vision model sees. The message transform below
      // gives the model concrete local file paths and tells it to choose the
      // visual prompt itself, then this tool executes that chosen prompt against
      // the configured vision provider.
      comprehend_image: createComprehendImageTool(() => pluginConfig),
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      // Capability lookup needs the active model from the latest user message.
      // The transform itself separately finds and mutates that same latest user
      // message so this entry point remains only orchestration glue.
      const result = findLastUserMessage(output.messages);
      const model = result
        ? await resolveModelInfo(client, result, warn)
        : undefined;
      await transformMessagesForImageComprehension({
        messages: output.messages,
        config: pluginConfig,
        configuredModels: pluginConfig.models,
        model,
        log,
      });
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
