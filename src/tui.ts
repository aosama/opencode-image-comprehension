import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { TUI_PLUGIN_NAME } from "./constants.js";

// This companion entry intentionally has no UI of its own. OpenCode's plugin
// manager owns its enabled state and persists it in the shared TUI KV store;
// the server entry reads that state before doing any image work.
export const tui: TuiPlugin = async () => {};

export default {
  id: TUI_PLUGIN_NAME,
  tui,
};
