// migration-assistant.ts – Migration assistant for bringing legacy packages up to new standards
// Part of Phase 6: Agent-Friendly Scaffolding
//
// This generator audits existing packages and identifies:
// 1. Ports without adapters
// 2. Adapters without composition root wiring
// 3. Use cases without test doubles
// 4. Missing MCP tool registrations
// 5. Missing unit/integration tests
//
// Then generates the missing pieces to bring legacy code up to standard.

import fs from "node:fs";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";

/**
 * Reporter shape for diagnostic output
 */
type ReportRecorder = {
  record: (level: string, file: string, message: string) => void;
};

/**
 * Audit result for a single package
 */
interface PackageAudit {
  packageName: string;
  packagePath: string;
  missingAdapters: string[];
  missingWiring: string[];
  missingTestDoubles: string[];
  missingMcpTools: string[];
  missingTests: string[];
}

/**
 * Migration configuration
 */
interface MigrationConfig {
  enabled?: boolean;
  dryRun?: boolean;
  packages?: string[];
  generateAdapters?: boolean;
  generateWiring?: boolean;
  generateTestDoubles?: boolean;
  generateMcpTools?: boolean;
  generateTests?: boolean;
}

/**
 * Audit existing packages to identify missing pieces
 */
export async function auditPackages(
  config: SyncConfig,
  reporter: ReportRecorder,
): Promise<PackageAudit[]> {
  const results: PackageAudit[] = [];
  const packagesDir = path.join(config.workspaceRoot, "packages");

  if (!fs.existsSync(packagesDir)) {
    reporter.record("warn", "packages/", "Packages directory not found");
    return results;
  }

  const packages = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  for (const pkg of packages) {
    const packagePath = path.join(packagesDir, pkg);
    const audit = await auditPackage(packagePath, pkg, reporter);
    if (audit) {
      results.push(audit);
    }
  }

  return results;
}

/**
 * Audit a single package
 */
async function auditPackage(
  packagePath: string,
  packageName: string,
  reporter: ReportRecorder,
): Promise<PackageAudit | null> {
  const srcPath = path.join(packagePath, "src");
  if (!fs.existsSync(srcPath)) {
    return null;
  }

  const audit: PackageAudit = {
    packageName,
    packagePath,
    missingAdapters: [],
    missingWiring: [],
    missingTestDoubles: [],
    missingMcpTools: [],
    missingTests: [],
  };

  // Check for ports without adapters
  const portsDir = path.join(srcPath, "application", "ports", "out");
  if (fs.existsSync(portsDir)) {
    const ports = fs
      .readdirSync(portsDir)
      .filter((f) => f.endsWith(".port.ts") && f !== "index.ts");

    for (const portFile of ports) {
      const portName = portFile.replace(".port.ts", "");
      const adapterPath = path.join(
        srcPath,
        "infrastructure",
        "adapters",
        `${portName}.adapter.ts`,
      );

      if (!fs.existsSync(adapterPath)) {
        audit.missingAdapters.push(portName);
        reporter.record(
          "info",
          `${packageName}/${portFile}`,
          `Missing adapter for port`,
        );
      }
    }
  }

  // Check for use cases without test doubles
  const useCasesDir = path.join(srcPath, "application", "use-cases");
  if (fs.existsSync(useCasesDir)) {
    const useCases = fs
      .readdirSync(useCasesDir)
      .filter((f) => f.endsWith(".use-case.ts") && f !== "index.ts");

    for (const useCaseFile of useCases) {
      const useCaseName = useCaseFile.replace(".use-case.ts", "");
      const testDoublePath = path.join(
        packagePath,
        "__tests__",
        "doubles",
        "ports",
      );

      if (!fs.existsSync(testDoublePath)) {
        audit.missingTestDoubles.push(useCaseName);
      }
    }
  }

  // Check for missing composition root wiring
  const wireFilePath = path.join(srcPath, "lib", "wire.server.ts");
  if (!fs.existsSync(wireFilePath)) {
    audit.missingWiring.push("wire.server.ts");
    reporter.record(
      "info",
      `${packageName}/src/lib/wire.server.ts`,
      "Missing composition root",
    );
  }

  // Check for missing MCP tools
  const mcpToolsPath = path.join(srcPath, "mcp", "tools.ts");
  if (!fs.existsSync(mcpToolsPath)) {
    audit.missingMcpTools.push("tools.ts");
  }

  // Check for missing tests
  const testsDir = path.join(packagePath, "__tests__");
  if (!fs.existsSync(testsDir)) {
    audit.missingTests.push("__tests__");
    reporter.record(
      "info",
      `${packageName}/__tests__`,
      "Missing tests directory",
    );
  }

  return audit;
}

/**
 * Generate migration report
 */
export function generateMigrationReport(audits: PackageAudit[]): string {
  const lines: string[] = [];

  lines.push("# Migration Audit Report");
  lines.push("");
  lines.push(
    `Audited ${audits.length} packages. Found issues in ${audits.filter((a) => hasIssues(a)).length} packages.`,
  );
  lines.push("");

  for (const audit of audits) {
    if (!hasIssues(audit)) continue;

    lines.push(`## ${audit.packageName}`);
    lines.push("");

    if (audit.missingAdapters.length > 0) {
      lines.push("### Missing Adapters");
      for (const adapter of audit.missingAdapters) {
        lines.push(`- ${adapter}`);
      }
      lines.push("");
    }

    if (audit.missingWiring.length > 0) {
      lines.push("### Missing Wiring");
      for (const wiring of audit.missingWiring) {
        lines.push(`- ${wiring}`);
      }
      lines.push("");
    }

    if (audit.missingTestDoubles.length > 0) {
      lines.push("### Missing Test Doubles");
      for (const testDouble of audit.missingTestDoubles) {
        lines.push(`- ${testDouble}`);
      }
      lines.push("");
    }

    if (audit.missingMcpTools.length > 0) {
      lines.push("### Missing MCP Tools");
      for (const tool of audit.missingMcpTools) {
        lines.push(`- ${tool}`);
      }
      lines.push("");
    }

    if (audit.missingTests.length > 0) {
      lines.push("### Missing Tests");
      for (const test of audit.missingTests) {
        lines.push(`- ${test}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Check if audit has any issues
 */
function hasIssues(audit: PackageAudit): boolean {
  return (
    audit.missingAdapters.length > 0 ||
    audit.missingWiring.length > 0 ||
    audit.missingTestDoubles.length > 0 ||
    audit.missingMcpTools.length > 0 ||
    audit.missingTests.length > 0
  );
}

/**
 * Generate missing pieces for a package
 */
export async function migratePackage(
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

  // Generate missing adapters
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

  // Generate missing wiring
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

  // Generate missing test doubles
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

  // Generate missing MCP tools
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

  // Generate missing tests
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

/**
 * Generate adapter stub
 */
function generateAdapterStub(adapterName: string): string {
  return `// @generated adapter stub — implement this
/**
 * ${adapterName} adapter
 *
 * Generated by HexaGen migration assistant.
 * TODO: Implement the port interface methods.
 */

export class ${toPascalCase(adapterName)}Adapter {
  // TODO: Add constructor with dependencies

  // TODO: Implement port interface methods
}
`;
}

/**
 * Generate wiring stub
 */
function generateWiringStub(packageName: string): string {
  return `// @generated composition root — edit freely
/**
 * Composition root for ${packageName}
 *
 * Generated by HexaGen migration assistant.
 * Wire your dependencies here.
 */

// TODO: Import your use cases and adapters

export function createUseCases() {
  // TODO: Instantiate adapters
  // TODO: Instantiate use cases with adapters
  // TODO: Return use cases
  return {};
}
`;
}

/**
 * Generate test double stub
 */
function generateTestDoubleStub(testDoubleName: string): string {
  return `// @generated test double — edit freely
/**
 * Fake implementation for ${testDoubleName}
 *
 * Generated by HexaGen migration assistant.
 */

export class ${toPascalCase(testDoubleName)}Fake {
  // TODO: Implement port interface methods
  // TODO: Add spy/stub functionality as needed
}
`;
}

/**
 * Generate MCP tools stub
 */
function generateMcpToolsStub(packageName: string): string {
  return `// @generated MCP tools — edit freely
/**
 * MCP tool registrations for ${packageName}
 *
 * Generated by HexaGen migration assistant.
 */

export const tools = [
  // TODO: Register your use cases as MCP tools
];
`;
}

/**
 * Convert string to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

// Made with Bob
