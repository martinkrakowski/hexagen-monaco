import type { SyncConfig } from "../../config.js";
import type { BoundedContext } from "../../types/manifest.js";
import type { ValidationIssue, ValidationResult } from "./validation-types.js";
import { createValidationResult } from "./validation-types.js";

async function validateDependencyGraph(
  config: SyncConfig,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const contexts = config.manifest.bounded_contexts || [];

  const graph = new Map<string, Set<string>>();
  for (const context of contexts) {
    const deps = new Set(context.depends_on || []);
    graph.set(context.name, deps);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function detectCycle(node: string, path: string[]): boolean {
    visited.add(node);
    recursionStack.add(node);

    const deps = graph.get(node) || new Set();
    for (const dep of deps) {
      if (!visited.has(dep)) {
        if (detectCycle(dep, [...path, node])) {
          return true;
        }
      } else if (recursionStack.has(dep)) {
        const cycle = [...path, node, dep].join(" → ");
        issues.push({
          severity: "error",
          code: "CIRCULAR_DEPENDENCY",
          message: `Circular dependency detected: ${cycle}`,
          suggestion: `Remove one of the dependencies to break the cycle`,
        });
        return true;
      }
    }

    recursionStack.delete(node);
    return false;
  }

  for (const context of contexts) {
    if (!visited.has(context.name)) {
      detectCycle(context.name, []);
    }
  }

  for (const context of contexts) {
    const deps = context.depends_on || [];
    for (const dep of deps) {
      const depContext = contexts.find((c) => c.name === dep);
      if (!depContext) {
        issues.push({
          severity: "error",
          code: "MISSING_DEPENDENCY",
          message: `Context '${context.name}' depends on '${dep}' which is not declared`,
          suggestion: `Add '${dep}' to bounded_contexts in manifest.yaml`,
        });
      }
    }
  }

  return createValidationResult(issues);
}

async function validateLayerBoundaries(
  context: BoundedContext,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  const domainPorts = context.layers?.domain?.ports;
  if (domainPorts?.in?.length || domainPorts?.out?.length) {
    issues.push({
      severity: "warning",
      code: "DOMAIN_HAS_PORTS",
      message: `Domain layer in '${context.name}' declares ports. Ports should be in application layer.`,
      suggestion: `Move ports to layers.application.ports in manifest.yaml`,
    });
  }

  const infraUseCases = (
    context.layers?.infrastructure as { use_cases?: string[] }
  )?.use_cases;
  if (infraUseCases?.length) {
    issues.push({
      severity: "error",
      code: "INFRASTRUCTURE_HAS_USE_CASES",
      message: `Infrastructure layer in '${context.name}' declares use cases. Use cases belong in application layer.`,
      suggestion: `Move use cases to layers.application.use_cases in manifest.yaml`,
    });
  }

  return createValidationResult(issues);
}

export { validateDependencyGraph, validateLayerBoundaries };
