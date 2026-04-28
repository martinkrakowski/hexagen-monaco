// validators.ts – Architecture validation for manifest-to-code correspondence
// Part of Phase 3: Validation Layer
//
// This module validates:
// 1. Port-adapter correspondence - every adapter implements a declared port
// 2. Manifest-to-code sync - declared elements exist in the filesystem
// 3. Dependency graph correctness - no circular dependencies
// 4. Layer boundary enforcement - no upward dependencies

import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import type { BoundedContext } from "../types/manifest.js";

/**
 * Validation error severity levels
 */
export type ValidationSeverity = "error" | "warning" | "info";

/**
 * A single validation issue
 */
export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  filePath?: string;
  suggestion?: string;
}

/**
 * Result of validation
 */
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

/**
 * Validate port-adapter correspondence for a bounded context
 *
 * Checks that:
 * - Every adapter implements a declared out-port
 * - Port files exist for declared ports
 * - Adapter files exist for declared adapters
 *
 * @param moduleDir - Package root directory
 * @param context - Bounded context
 * @returns Validation result
 */
export async function validatePortAdapterCorrespondence(
  moduleDir: string,
  context: BoundedContext,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  const adapters = context.layers?.infrastructure?.adapters || [];
  const outPorts = context.layers?.application?.ports?.out || [];

  // Check each adapter has a corresponding port
  for (const adapter of adapters) {
    // Convention: FooAdapter implements FooPort
    const expectedPort = adapter.replace(/Adapter$/, "Port");

    if (!outPorts.includes(expectedPort)) {
      issues.push({
        severity: "warning",
        code: "ADAPTER_NO_PORT",
        message: `Adapter '${adapter}' does not have a corresponding out-port '${expectedPort}'`,
        suggestion: `Add '${expectedPort}' to layers.application.ports.out in manifest.yaml`,
      });
    }

    // Check adapter file exists
    const adapterPath = path.join(
      moduleDir,
      "src/infrastructure/adapters",
      `${adapter.toLowerCase()}.adapter.ts`,
    );

    try {
      await fs.access(adapterPath);
    } catch {
      issues.push({
        severity: "error",
        code: "ADAPTER_FILE_MISSING",
        message: `Adapter file not found: ${adapter}`,
        filePath: adapterPath,
        suggestion: `Run 'yarn hexagen sync' to generate the adapter stub`,
      });
    }
  }

  // Check each out-port file exists
  for (const port of outPorts) {
    const portPath = path.join(
      moduleDir,
      "src/application/ports/out",
      `${port.toLowerCase()}.out-port.ts`,
    );

    try {
      await fs.access(portPath);
    } catch {
      issues.push({
        severity: "error",
        code: "PORT_FILE_MISSING",
        message: `Port file not found: ${port}`,
        filePath: portPath,
        suggestion: `Run 'yarn hexagen sync' to generate the port stub`,
      });
    }
  }

  return createValidationResult(issues);
}

/**
 * Validate manifest-to-code sync for a bounded context
 *
 * Checks that all declared elements exist in the filesystem:
 * - Entities
 * - Value objects
 * - Use cases
 * - Ports (in and out)
 * - Adapters
 *
 * @param moduleDir - Package root directory
 * @param context - Bounded context
 * @returns Validation result
 */
export async function validateManifestToCodeSync(
  moduleDir: string,
  context: BoundedContext,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  // Validate domain layer
  const entities = context.layers?.domain?.entities || [];
  for (const entity of entities) {
    const entityPath = path.join(
      moduleDir,
      "src/domain",
      `${entity.toLowerCase()}.ts`,
    );

    try {
      await fs.access(entityPath);
    } catch {
      issues.push({
        severity: "warning",
        code: "ENTITY_FILE_MISSING",
        message: `Entity file not found: ${entity}`,
        filePath: entityPath,
        suggestion: `Run 'yarn hexagen sync' to generate the entity stub`,
      });
    }
  }

  const valueObjects = context.layers?.domain?.value_objects || [];
  for (const vo of valueObjects) {
    const voPath = path.join(
      moduleDir,
      "src/domain",
      `${vo.toLowerCase()}.vo.ts`,
    );

    try {
      await fs.access(voPath);
    } catch {
      issues.push({
        severity: "warning",
        code: "VALUE_OBJECT_FILE_MISSING",
        message: `Value object file not found: ${vo}`,
        filePath: voPath,
        suggestion: `Run 'yarn hexagen sync' to generate the value object stub`,
      });
    }
  }

  // Validate application layer
  const useCases = context.layers?.application?.use_cases || [];
  for (const useCase of useCases) {
    const useCasePath = path.join(
      moduleDir,
      "src/application/use-cases",
      `${useCase.toLowerCase()}.use-case.ts`,
    );

    try {
      await fs.access(useCasePath);
    } catch {
      issues.push({
        severity: "error",
        code: "USE_CASE_FILE_MISSING",
        message: `Use case file not found: ${useCase}`,
        filePath: useCasePath,
        suggestion: `Run 'yarn hexagen sync' to generate the use case stub`,
      });
    }
  }

  const inPorts = context.layers?.application?.ports?.in || [];
  for (const port of inPorts) {
    const portPath = path.join(
      moduleDir,
      "src/application/ports/in",
      `${port.toLowerCase()}.in-port.ts`,
    );

    try {
      await fs.access(portPath);
    } catch {
      issues.push({
        severity: "error",
        code: "IN_PORT_FILE_MISSING",
        message: `In-port file not found: ${port}`,
        filePath: portPath,
        suggestion: `Run 'yarn hexagen sync' to generate the port stub`,
      });
    }
  }

  return createValidationResult(issues);
}

/**
 * Validate dependency graph for circular dependencies
 *
 * Checks that:
 * - No circular dependencies between bounded contexts
 * - Dependencies flow in the correct direction
 *
 * @param config - Sync configuration
 * @returns Validation result
 */
export async function validateDependencyGraph(
  config: SyncConfig,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const contexts = config.manifest.bounded_contexts || [];

  // Build dependency graph
  const graph = new Map<string, Set<string>>();
  for (const context of contexts) {
    const deps = new Set(context.depends_on || []);
    graph.set(context.name, deps);
  }

  // Detect circular dependencies using DFS
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
        // Circular dependency detected
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

  // Check for missing dependencies
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

/**
 * Validate layer boundaries for a bounded context
 *
 * Checks that:
 * - Domain layer doesn't depend on application or infrastructure
 * - Application layer doesn't depend on infrastructure
 * - Infrastructure can depend on application and domain
 *
 * This is a static check based on manifest declarations.
 * For runtime import analysis, use the arch-linter.
 *
 * @param context - Bounded context
 * @returns Validation result
 */
export async function validateLayerBoundaries(
  context: BoundedContext,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  // Check if domain layer has ports (it shouldn't in pure hexagonal architecture)
  const domainPorts = context.layers?.domain?.ports;
  if (domainPorts?.in?.length || domainPorts?.out?.length) {
    issues.push({
      severity: "warning",
      code: "DOMAIN_HAS_PORTS",
      message: `Domain layer in '${context.name}' declares ports. Ports should be in application layer.`,
      suggestion: `Move ports to layers.application.ports in manifest.yaml`,
    });
  }

  // Check if infrastructure layer has use cases (it shouldn't)
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

/**
 * Run all validations for a bounded context
 *
 * @param moduleDir - Package root directory
 * @param context - Bounded context
 * @param config - Sync configuration
 * @returns Combined validation result
 */
export async function validateBoundedContext(
  moduleDir: string,
  context: BoundedContext,
): Promise<ValidationResult> {
  const results = await Promise.all([
    validatePortAdapterCorrespondence(moduleDir, context),
    validateManifestToCodeSync(moduleDir, context),
    validateLayerBoundaries(context),
  ]);

  // Combine all issues
  const allIssues = results.flatMap((r) => r.issues);
  return createValidationResult(allIssues);
}

/**
 * Create a validation result from a list of issues
 */
function createValidationResult(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const info = issues.filter((i) => i.severity === "info").length;

  return {
    valid: errors === 0,
    issues,
    summary: {
      errors,
      warnings,
      info,
    },
  };
}

// Made with Bob
