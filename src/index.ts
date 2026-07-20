// Barrel file: re-exports the main plugin entry point.
// Code that imports from "./index.js" will continue to work without changes.

import type { Plugin } from "@opencode-ai/plugin";
import { PLUGIN_NAME } from "./constants.js";
import { setupImageComprehensionPlugin } from "./plugin-setup.js";
import { createPluginHooks } from "./plugin-hooks.js";

export const ImageComprehensionPlugin: Plugin = async (input) => {
  const { client, directory } = input;

  const { pluginConfig, log, warn, modelSupportsImageInputBySessionID } =
    await setupImageComprehensionPlugin({ client, directory });

  const hooks = createPluginHooks({
    pluginConfig,
    log,
    warn,
    modelSupportsImageInputBySessionID,
    client,
  });

  return hooks;
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

// Re-export for tests
export { __test } from "./test-exports.js";
