import type { ActivationMode, ModelInfo } from "./types.js";
import { modelMatchesAnyPattern } from "./activation-patterns.js";

export function shouldActivateImageComprehension(input: {
  activation: ActivationMode;
  model: ModelInfo | undefined;
  configuredPatterns: readonly string[] | undefined;
}): boolean {
  // Activation answers one question: should this plugin strip image media and
  // replace it with file-path/tool instructions? Vision-capable models should
  // keep native image input untouched so we do not degrade their experience.
  if (input.activation === "disabled") return false;
  if (input.activation === "force") return true;
  if (input.activation === "patterns")
    return modelMatchesAnyPattern(input.model, input.configuredPatterns);
  if (input.model?.supportsImageInput === true) return false;
  if (input.model?.supportsImageInput === false) return true;
  if (input.configuredPatterns)
    return modelMatchesAnyPattern(input.model, input.configuredPatterns);
  return false;
}
