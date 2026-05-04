import fs from "node:fs";
import path from "node:path";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import {
  type PackageAudit,
  type MigrationConfig,
  type ReportRecorder,
} from "./migration-audit.js";
import {
  generateAdapterStub,
  generateWiringStub,
  generateTestDoubleStub,
  generateMcpToolsStub,
} from "./migration-stubs.js";

export { auditPackages, generateMigrationReport } from "./migration-audit.js";
export type { PackageAudit, MigrationConfig } from "./migration-audit.js";

async function migratePackage(
  audit: PackageAudit,
  config: MigrationConfig,
  reporter: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  if (config.dryRun) {
    reporter.record(
      "info",
      audit.packageName,
      "Dry run mode - no files will be written",
    );
  }

  if (config.generateAdapters && audit.missingAdapters.length > 0) {
    for (const adapter of audit.missingAdapters) {
      const adapterPath = path.join(
        audit.packagePath,
        "src",
        "infrastructure",
        "adapters",
        `${adapter}.adapter.ts`,
      );

      const adapterContent = generateAdapterStub(adapter);

      if (!config.dryRun) {
        fs.mkdirSync(path.dirname(adapterPath), { recursive: true });
        fs.writeFileSync(adapterPath, adapterContent, "utf-8");
      }

      result.created.push(adapterPath);
      reporter.record("info", adapterPath, "Generated adapter stub");
    }
  }

  if (config.generateWiring && audit.missingWiring.length > 0) {
    const wirePath = path.join(
      audit.packagePath,
      "src",
      "lib",
      "wire.server.ts",
    );

    const wireContent = generateWiringStub(audit.packageName);

    if (!config.dryRun) {
      fs.mkdirSync(path.dirname(wirePath), { recursive: true });
      fs.writeFileSync(wirePath, wireContent, "utf-8");
    }

    result.created.push(wirePath);
    reporter.record("info", wirePath, "Generated composition root");
  }

  if (config.generateTestDoubles && audit.missingTestDoubles.length > 0) {
    const testDoublesDir = path.join(
      audit.packagePath,
      "__tests__",
      "doubles",
      "ports",
    );

    if (!config.dryRun) {
      fs.mkdirSync(testDoublesDir, { recursive: true });
    }

    for (const testDouble of audit.missingTestDoubles) {
      const testDoublePath = path.join(testDoublesDir, `${testDouble}.fake.ts`);
      const testDoubleContent = generateTestDoubleStub(testDouble);

      if (!config.dryRun) {
        fs.writeFileSync(testDoublePath, testDoubleContent, "utf-8");
      }

      result.created.push(testDoublePath);
      reporter.record("info", testDoublePath, "Generated test double");
    }
  }

  if (config.generateMcpTools && audit.missingMcpTools.length > 0) {
    const mcpToolsPath = path.join(audit.packagePath, "src", "mcp", "tools.ts");
    const mcpToolsContent = generateMcpToolsStub(audit.packageName);

    if (!config.dryRun) {
      fs.mkdirSync(path.dirname(mcpToolsPath), { recursive: true });
      fs.writeFileSync(mcpToolsPath, mcpToolsContent, "utf-8");
    }

    result.created.push(mcpToolsPath);
    reporter.record("info", mcpToolsPath, "Generated MCP tools");
  }

  if (config.generateTests && audit.missingTests.length > 0) {
    const testsDir = path.join(audit.packagePath, "__tests__");

    if (!config.dryRun) {
      fs.mkdirSync(testsDir, { recursive: true });
    }

    result.created.push(testsDir);
    reporter.record("info", testsDir, "Created tests directory");
  }

  return result;
}

export { migratePackage };
