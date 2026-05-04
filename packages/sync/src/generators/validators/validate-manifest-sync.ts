import fs from "node:fs/promises";
import path from "node:path";
import type { BoundedContext } from "../../types/manifest.js";
import type { ValidationIssue, ValidationResult } from "./validation-types.js";
import { createValidationResult } from "./validation-types.js";

async function validateManifestToCodeSync(
  moduleDir: string,
  context: BoundedContext,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

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

export { validateManifestToCodeSync };
