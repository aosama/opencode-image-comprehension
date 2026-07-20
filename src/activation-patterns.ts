import type { ModelInfo } from "./types.js";

function matchesWildcardPattern(pattern: string, value: string): boolean {
  // Pattern support is intentionally small: exact, leading wildcard, trailing
  // wildcard, contains wildcard, and all. That is enough for provider/model
  // targeting without introducing a full glob dependency into runtime code.
  const normalizedPattern = pattern.toLowerCase();
  const normalizedValue = value.toLowerCase();
  if (normalizedPattern === "*") return true;
  if (
    normalizedPattern.startsWith("*") &&
    normalizedPattern.endsWith("*") &&
    normalizedPattern.length > 2
  ) {
    return normalizedValue.includes(normalizedPattern.slice(1, -1));
  }
  if (normalizedPattern.endsWith("*"))
    return normalizedValue.startsWith(normalizedPattern.slice(0, -1));
  if (normalizedPattern.startsWith("*"))
    return normalizedValue.endsWith(normalizedPattern.slice(1));
  return normalizedValue === normalizedPattern;
}

function matchesSinglePattern(pattern: string, model: ModelInfo): boolean {
  // Patterns can target either a model/provider name alone or provider/model as
  // a pair. The single-token form is forgiving because users often remember one
  // side of the OpenCode model identity but not the full provider prefix.
  if (pattern === "*") return true;
  const slashIndex = pattern.indexOf("/");
  if (slashIndex === -1) {
    return (
      matchesWildcardPattern(pattern, model.modelID) ||
      matchesWildcardPattern(pattern, model.providerID)
    );
  }
  return (
    matchesWildcardPattern(pattern.slice(0, slashIndex), model.providerID) &&
    matchesWildcardPattern(pattern.slice(slashIndex + 1), model.modelID)
  );
}

function modelMatchesAnyPattern(
  model: ModelInfo | undefined,
  patterns: readonly string[] | undefined,
): boolean {
  if (!model || !patterns) return false;
  return patterns.some((pattern) => matchesSinglePattern(pattern, model));
}

export { matchesSinglePattern, matchesWildcardPattern, modelMatchesAnyPattern };
