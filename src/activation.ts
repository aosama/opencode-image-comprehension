// Barrel file: re-exports everything from the activation sub-modules
// to preserve the public API. Code that imports from "./activation.js" will
// continue to work without changes.

export { shouldActivateImageComprehension } from "./activation-decide.js";

export {
  findModelCapabilityInProviderList,
  getModelFromMessage,
  modelMetadataSupportsImageInput,
  resolveModelInfo,
} from "./activation-resolve.js";
