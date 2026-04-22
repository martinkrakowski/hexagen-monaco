import type { Identifier } from "@hexagen/shared";

/**
 * PromptCacheKey represents a unique identifier for caching prompts.
 * It's based on the prompt template ID and the specific variable values used.
 */
export interface PromptCacheKey {
  templateId: Identifier;
  variableHash: string;
  version: number;
}

/**
 * Creates a PromptCacheKey from a template and variable values
 * The variableHash is a simple hash of the variable names and values
 */
export function createPromptCacheKey(
  templateId: Identifier,
  variables: Record<string, string>,
  version: number = 1,
): PromptCacheKey {
  // Create a deterministic hash of the variables
  const variableEntries = Object.entries(variables)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value || ""}`)
    .join("|");

  // Simple string hash - in production you might want to use a proper hashing algorithm
  const variableHash = variableEntries
    .split("")
    .reduce((hash, char) => {
      return ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    }, 0)
    .toString();

  return {
    templateId,
    variableHash,
    version,
  };
}

/**
 * Checks if two PromptCacheKeys are equivalent
 */
export function arePromptCacheKeysEqual(
  a: PromptCacheKey,
  b: PromptCacheKey,
): boolean {
  return (
    a.templateId === b.templateId &&
    a.variableHash === b.variableHash &&
    a.version === b.version
  );
}
