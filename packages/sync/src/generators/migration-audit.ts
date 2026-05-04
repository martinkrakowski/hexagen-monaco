import fs from "node:fs";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import type { ReportRecorder } from "../domain/types.js";

interface PackageAudit {
  packageName: string;
  packagePath: string;
  missingAdapters: string[];
  missingWiring: string[];
  missingTestDoubles: string[];
  missingMcpTools: string[];
  missingTests: string[];
}

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

async function auditPackages(
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

  const wireFilePath = path.join(srcPath, "lib", "wire.server.ts");
  if (!fs.existsSync(wireFilePath)) {
    audit.missingWiring.push("wire.server.ts");
    reporter.record(
      "info",
      `${packageName}/src/lib/wire.server.ts`,
      "Missing composition root",
    );
  }

  const mcpToolsPath = path.join(srcPath, "mcp", "tools.ts");
  if (!fs.existsSync(mcpToolsPath)) {
    audit.missingMcpTools.push("tools.ts");
  }

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

function generateMigrationReport(audits: PackageAudit[]): string {
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

function hasIssues(audit: PackageAudit): boolean {
  return (
    audit.missingAdapters.length > 0 ||
    audit.missingWiring.length > 0 ||
    audit.missingTestDoubles.length > 0 ||
    audit.missingMcpTools.length > 0 ||
    audit.missingTests.length > 0
  );
}

export { auditPackages, generateMigrationReport, hasIssues };
export type { PackageAudit, MigrationConfig };
export type { ReportRecorder } from "../domain/types.js";
