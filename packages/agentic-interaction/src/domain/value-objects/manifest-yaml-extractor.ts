import type { GeneratedManifest } from "./index.js";

export function extractManifestYaml(response: string): string | null {
  const codeBlockMatch = response.match(/```ya?ml\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  const genericBlockMatch = response.match(/```\n([\s\S]*?)\n```/);
  if (genericBlockMatch) {
    const content = genericBlockMatch[1].trim();
    if (content.includes("workspace:") || content.includes("boundedContexts:")) {
      return content;
    }
  }

  if (response.includes("workspace:") && response.includes("boundedContexts:")) {
    return response.trim();
  }

  const lines = response.split("\n");
  const yamlStart = lines.findIndex(
    (line) =>
      line.trim().startsWith("workspace:") || line.trim().startsWith("# "),
  );
  if (yamlStart !== -1) {
    return lines.slice(yamlStart).join("\n").trim();
  }

  return null;
}

export function generateManifestSuggestions(yaml: string): string[] {
  const suggestions: string[] = [];

  if (!yaml.includes("description:")) {
    suggestions.push("Consider adding descriptions to your bounded contexts");
  }

  if (!yaml.includes("adapters:")) {
    suggestions.push("You may want to define adapters for your ports");
  }

  if (!yaml.includes("dependencies:")) {
    suggestions.push("Consider defining dependencies between contexts");
  }

  if (yaml.split("boundedContexts:")[1]?.split("-").length === 2) {
    suggestions.push(
      "Single context detected - consider if domain decomposition is needed",
    );
  }

  return suggestions;
}

export function detectManifestWarnings(yaml: string): string[] {
  const warnings: string[] = [];

  if (yaml.includes("TODO") || yaml.includes("FIXME")) {
    warnings.push(
      "Manifest contains TODO/FIXME markers - manual review needed",
    );
  }

  if (yaml.includes("example.com") || yaml.includes("placeholder")) {
    warnings.push("Manifest may contain placeholder values");
  }

  if (yaml.split("boundedContexts:")[1]?.split("-").length > 5) {
    warnings.push(
      "Large number of contexts detected - consider consolidation",
    );
  }

  if (!yaml.includes("ports:")) {
    warnings.push(
      "No ports defined - hexagonal architecture may be incomplete",
    );
  }

  return warnings;
}
