/**
 * Utility functions for inspecting generated manifest YAML
 * for manifest generation use cases.
 */

/**
 * Generate helpful suggestions based on manifest content
 */
export function generateSuggestions(manifest: string): string[] {
  const suggestions: string[] = [];

  // Check for common improvements
  if (!manifest.includes("description:")) {
    suggestions.push("Consider adding descriptions to your bounded contexts");
  }

  if (!manifest.includes("adapters:")) {
    suggestions.push("You may want to define adapters for your ports");
  }

  if (!manifest.includes("dependencies:")) {
    suggestions.push("Consider defining dependencies between contexts");
  }

  if (manifest.split("boundedContexts:")[1]?.split("-").length === 2) {
    suggestions.push(
      "Single context detected - consider if domain decomposition is needed",
    );
  }

  return suggestions;
}

/**
 * Detect potential issues or warnings in generated manifest
 */
export function detectWarnings(manifest: string): string[] {
  const warnings: string[] = [];

  // Check for incomplete sections
  if (manifest.includes("TODO") || manifest.includes("FIXME")) {
    warnings.push(
      "Manifest contains TODO/FIXME markers - manual review needed",
    );
  }

  // Check for placeholder values
  if (manifest.includes("example.com") || manifest.includes("placeholder")) {
    warnings.push("Manifest may contain placeholder values");
  }

  // Check for large number of contexts
  const contextMatches = manifest.match(/- name: [^\n]+/g);
  if (contextMatches && contextMatches.length > 5) {
    warnings.push("Large number of contexts detected - consider consolidation");
  }

  // Check for missing critical sections
  if (!manifest.includes("ports:")) {
    warnings.push(
      "No ports defined - hexagonal architecture may be incomplete",
    );
  }

  return warnings;
}
