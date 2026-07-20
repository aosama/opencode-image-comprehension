import { join } from "node:path";
import { homedir } from "node:os";
import { CONFIG_FILENAME } from "./constants.js";

// Config is intentionally separate from OpenCode provider config. The host model
// can be any OpenCode model, while this plugin independently chooses a vision
// provider/model for image comprehension.
export function getUserConfigPath(): string {
  return join(homedir(), ".config", "opencode", CONFIG_FILENAME);
}

export function getProjectConfigPath(directory: string): string {
  return join(directory, ".opencode", CONFIG_FILENAME);
}
