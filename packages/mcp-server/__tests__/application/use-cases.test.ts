import { describe, it } from "vitest";
import assert from "node:assert";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
// The graph and report shapes live where `ArchitectureQueryPort` reads them
// from; `@hexagen/shared` has not exported either name for some time, which
// nothing noticed while this package had no `typecheck:test`.
import type { LinterReport } from "@hexagen/governance";
import type { ArchitectureGraph } from "@hexagen/visualization";
import { AddDependencyToolUseCase } from "../../src/application/use-cases/add-dependency-tool.use-case.js";
import { AuditBoundariesToolUseCase } from "../../src/application/use-cases/audit-boundaries-tool.use-case.js";
import { CreateAdapterToolUseCase } from "../../src/application/use-cases/create-adapter-tool.use-case.js";
import { CreatePortToolUseCase } from "../../src/application/use-cases/create-port-tool.use-case.js";
import { GetGraphResourceUseCase } from "../../src/application/use-cases/get-graph-resource.use-case.js";
import { GetLinterReportResourceUseCase } from "../../src/application/use-cases/get-linter-report-resource.use-case.js";
import { GetManifestResourceUseCase } from "../../src/application/use-cases/get-manifest-resource.use-case.js";
import { ScaffoldModuleToolUseCase } from "../../src/application/use-cases/scaffold-module-tool.use-case.js";
import type { LinterPort } from "../../src/application/ports/out/linter.port.js";
import type {
  ManifestWritePort,
  AddDependencyCommand,
  RegisterBoundedContextCommand,
  RegisterPortCommand,
  RegisterAdapterCommand,
  RemovePortCommand,
  RemoveContextCommand,
} from "../../src/application/ports/out/manifest-write.port.js";
import type { ArchitectureQueryPort } from "../../src/application/ports/out/sync-engine.port.js";
import type { ProjectConfigurationReadPort } from "../../src/application/ports/out/project-configuration-read.port.js";
import type {
  CreateAdapterCommand,
  CreatePortCommand,
  ScaffoldModuleCommand,
  ScaffoldingPort,
} from "../../src/application/ports/out/scaffolding.port.js";

class ProjectConfigurationReadFake implements ProjectConfigurationReadPort {
  async getManifest() {
    const payload = {
      system: "hexagen-monaco",
      bounded_contexts: [
        {
          name: "sync",
          type: "core",
          description: "Sync engine",
          layers: {},
        },
      ],
    } as unknown;
    return { success: true as const, value: payload as never };
  }
}

class SyncEngineFake implements ArchitectureQueryPort, ScaffoldingPort {
  async getArchitectureGraph() {
    const payload: ArchitectureGraph = {
      nodes: [
        {
          id: "@hexagen/sync",
          label: "sync",
          type: "core",
          status: "active",
        },
      ],
      edges: [],
    };
    return { success: true as const, value: payload };
  }

  async getLinterReport() {
    const payload: LinterReport = {
      timestamp: new Date().toISOString(),
      isCompliant: true,
      violations: [],
      scannedFilesCount: 4,
    };
    return { success: true as const, value: payload };
  }

  async scaffoldModule(command: ScaffoldModuleCommand) {
    return {
      success: true as const,
      value: { filesCreated: [`packages/${command.name}/src/index.ts`] },
    };
  }

  async createPort(command: CreatePortCommand) {
    return {
      success: true as const,
      value: { fileCreated: `ports/${command.portName}.port.ts` },
    };
  }

  async createAdapter(command: CreateAdapterCommand) {
    return {
      success: true as const,
      value: { fileCreated: `adapters/${command.portName}.adapter.ts` },
    };
  }
}

class LinterFake implements LinterPort {
  async auditBoundaries() {
    const payload: LinterReport = {
      timestamp: new Date().toISOString(),
      isCompliant: true,
      violations: [],
      scannedFilesCount: 8,
    };
    return { success: true as const, value: payload };
  }
}

class ManifestWriteFake implements ManifestWritePort {
  async validateDependency(_command: AddDependencyCommand) {
    void _command;
    return { success: true as const, value: { valid: true, errors: [] } };
  }

  async addDependency(_command: AddDependencyCommand) {
    void _command;
    return { success: true as const, value: { updated: true } };
  }

  async registerBoundedContext(_command: RegisterBoundedContextCommand) {
    void _command;
    return {
      success: true as const,
      value: { registered: true, alreadyExisted: false },
    };
  }

  async registerPort(_command: RegisterPortCommand) {
    void _command;
    return { success: true as const, value: { registered: true } };
  }

  async registerAdapter(_command: RegisterAdapterCommand) {
    void _command;
    return { success: true as const, value: { registered: true } };
  }

  async removePort(_command: RemovePortCommand) {
    void _command;
    return { success: true as const, value: { removed: true } };
  }

  async removeContext(_command: RemoveContextCommand) {
    void _command;
    return { success: true as const, value: { removed: true } };
  }
}

describe("use cases", () => {
  const projectRead = new ProjectConfigurationReadFake();
  const sync = new SyncEngineFake();
  const linter = new LinterFake();
  const manifestWrite = new ManifestWriteFake();

  it("should return manifest data", async () => {
    const manifestResult = await new GetManifestResourceUseCase(
      projectRead,
    ).execute();
    assert.ok(manifestResult.success, "getManifest should succeed");
    assert.ok(manifestResult.value);
  });

  it("should return architecture graph", async () => {
    const graphResult = await new GetGraphResourceUseCase(
      sync as ArchitectureQueryPort,
    ).execute();
    assert.ok(graphResult.success, "getGraph should succeed");
    assert.strictEqual(graphResult.value.nodes.length, 1);
  });

  it("should return linter report", async () => {
    const linterResult = await new GetLinterReportResourceUseCase(
      sync as ArchitectureQueryPort,
    ).execute();
    assert.ok(linterResult.success, "getLinterReport should succeed");
    assert.strictEqual(linterResult.value.isCompliant, true);
  });

  it("should audit boundaries", async () => {
    const auditResult = await new AuditBoundariesToolUseCase(linter).execute();
    assert.strictEqual(auditResult.report.scannedFilesCount, 8);
  });

  it("should scaffold module in dry_run mode", async () => {
    const scaffoldResult = await new ScaffoldModuleToolUseCase(
      new InMemoryTransactionManager(),
    ).execute({
      name: "mcp-server",
      layer: "infrastructure",
      context_type: "supporting",
      dry_run: true,
    });
    assert.strictEqual(scaffoldResult.dryRun, true);
  });

  it("should propose a dependency without writing", async () => {
    const dependencyResult = await new AddDependencyToolUseCase(
      manifestWrite,
      new InMemoryTransactionManager(),
    ).execute({
      sourceModule: "mcp-server",
      targetModule: "sync",
      dry_run: false,
    });
    assert.strictEqual(dependencyResult.updated, false);
    assert.strictEqual(dependencyResult.pendingApproval, true);
  });

  it("should propose a port without writing", async () => {
    const createPortResult = await new CreatePortToolUseCase(
      new InMemoryTransactionManager(),
    ).execute({
      domain_name: "billing",
      port_name: "PaymentGatewayPort",
      type: "outbound",
      dry_run: false,
    });
    assert.strictEqual(createPortResult.fileCreated, undefined);
    assert.strictEqual(createPortResult.pendingApproval, true);
  });

  it("should propose an adapter without writing", async () => {
    const createAdapterResult = await new CreateAdapterToolUseCase(
      new InMemoryTransactionManager(),
    ).execute({
      port_name: "PaymentGatewayPort",
      infrastructure_name: "stripe-billing",
      dry_run: false,
    });
    assert.strictEqual(createAdapterResult.fileCreated, undefined);
    assert.strictEqual(createAdapterResult.pendingApproval, true);
  });
});
