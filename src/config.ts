// Barrel file: re-exports everything from the config sub-modules
// to preserve the public API. Code that imports from "./config.js" will
// continue to work without changes.

export { getProjectConfigPath, getUserConfigPath } from "./config-paths.js";

export { parseConfigObject } from "./config-parse.js";

export {
  loadPluginConfig,
  readConfigFile,
  resolvePluginConfig,
  selectWithPrecedence,
} from "./config-resolve.js";
