import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  IMAGE_COMPREHENSION_ENABLED_KEY,
  TUI_PLUGIN_NAME,
} from "./constants.js";

interface RecordLike {
  [key: string]: unknown;
}

function isRecordLike(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getOpenCodeTuiStateFilePath(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  const stateHome =
    environment.XDG_STATE_HOME ?? join(homeDirectory, ".local", "state");
  return join(stateHome, "opencode", "kv.json");
}

export async function readImageComprehensionTuiEnabled(input?: {
  stateFilePath?: string;
}): Promise<boolean> {
  try {
    const stateFilePath = input?.stateFilePath ?? getOpenCodeTuiStateFilePath();
    const stateText = await readFile(stateFilePath, "utf8");
    const state = JSON.parse(stateText) as unknown;
    if (!isRecordLike(state)) return true;

    const enabledPlugins = state[IMAGE_COMPREHENSION_ENABLED_KEY];
    if (!isRecordLike(enabledPlugins)) return true;

    const configuredEnabledState = enabledPlugins[TUI_PLUGIN_NAME];
    return typeof configuredEnabledState === "boolean"
      ? configuredEnabledState
      : true;
  } catch {
    // Missing or temporarily unreadable TUI state must preserve the plugin's
    // historical default behavior. Only an explicit persisted false disables it.
    return true;
  }
}
