/**
 * Utility functions for extracting and validating YAML from LLM responses
 * for manifest generation use cases.
 */

/**
 * Extract YAML content from LLM response
 * Handles various response formats (code blocks, plain text, etc.)
 */
export function extractYamlFromResponse(response: string): string {
  // Try to extract from code block first
  const codeBlockMatch = response.match(/```ya?ml\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try generic code block
  const genericBlockMatch = response.match(/```\n([\s\S]*?)\n```/);
  if (genericBlockMatch) {
    const content = genericBlockMatch[1].trim();
    // Verify it looks like YAML
    if (
      content.includes("workspace:") ||
      content.includes("boundedContexts:")
    ) {
      return content;
    }
  }

  // If no code block, check if the entire response is YAML
  if (
    response.includes("workspace:") &&
    response.includes("boundedContexts:")
  ) {
    return response.trim();
  }

  // Last resort: try to find YAML-like content
  const lines = response.split("\n");
  const yamlStart = lines.findIndex(
    (line) =>
      line.trim().startsWith("workspace:") || line.trim().startsWith("# "),
  );
  if (yamlStart !== -1) {
    return lines.slice(yamlStart).join("\n").trim();
  }

  return "";
}

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
    warnings.push(
      "Large number of contexts detected - consider consolidation",
    );
  }

  // Check for missing critical sections
  if (!manifest.includes("ports:")) {
    warnings.push(
      "No ports defined - hexagonal architecture may be incomplete",
    );
  }

  return warnings;
}
