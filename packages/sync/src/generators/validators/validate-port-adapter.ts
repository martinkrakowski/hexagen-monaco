import fs from "node:fs/promises";
import path from "node:path";
import type { BoundedContext } from "../../types/manifest.js";
import { portName } from "../../types/manifest.js";
import type { ValidationIssue, ValidationResult } from "./validation-types.js";
import { createValidationResult } from "./validation-types.js";

async function validatePortAdapterCorrespondence(
  moduleDir: string,
  context: BoundedContext,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  const adapters = context.layers?.infrastructure?.adapters || [];
  const outPorts = context.layers?.application?.ports?.out || [];
  const outPortNames = outPorts.map(portName);

  for (const adapter of adapters) {
    const expectedPort = adapter.replace(/Adapter$/, "Port");

    if (!outPortNames.includes(expectedPort)) {
      issues.push({
        severity: "warning",
        code: "ADAPTER_NO_PORT",
        message: `Adapter '${adapter}' does not have a corresponding out-port '${expectedPort}'`,
        suggestion: `Add '${expectedPort}' to layers.application.ports.out in manifest.yaml`,
      });
    }

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

  for (const raw of outPorts) {
    const port = portName(raw);
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

export { validatePortAdapterCorrespondence };
