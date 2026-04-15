import assert from "node:assert";
import type { EventBusPort } from "@hexagen/messaging";
import { type ArchitectureGraph, type LinterReport } from "@hexagen/shared";
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

class EventBusFake implements EventBusPort {
  subscribe(): () => void {
    return () => {};
  }

  publish(): void {}

  unsubscribe(): void {}

  clear(): void {}
}

(async () => {
  const projectRead = new ProjectConfigurationReadFake();
  const sync = new SyncEngineFake();
  const linter = new LinterFake();
  const manifestWrite = new ManifestWriteFake();
  const eventBus = new EventBusFake();

  const manifestResource = await new GetManifestResourceUseCase(
    projectRead,
  ).execute();
  assert.ok(manifestResource);

  const graphResource = await new GetGraphResourceUseCase(
    sync as ArchitectureQueryPort,
  ).execute();
  assert.strictEqual(graphResource.nodes.length, 1);

  const linterResource = await new GetLinterReportResourceUseCase(
    sync as ArchitectureQueryPort,
  ).execute();
  assert.strictEqual(linterResource.isCompliant, true);

  const auditResult = await new AuditBoundariesToolUseCase(linter).execute();
  assert.strictEqual(auditResult.report.scannedFilesCount, 8);

  const scaffoldResult = await new ScaffoldModuleToolUseCase(
    sync as ScaffoldingPort,
    manifestWrite,
    eventBus,
  ).execute({
    name: "mcp-server",
    layer: "infrastructure",
    context_type: "supporting",
    dry_run: true,
  });
  assert.strictEqual(scaffoldResult.dryRun, true);

  const dependencyResult = await new AddDependencyToolUseCase(
    manifestWrite,
    eventBus,
  ).execute({
    sourceModule: "mcp-server",
    targetModule: "sync",
    dry_run: false,
  });
  assert.strictEqual(dependencyResult.updated, true);

  const createPortResult = await new CreatePortToolUseCase(
    sync as ScaffoldingPort,
    manifestWrite,
  ).execute({
    domain_name: "billing",
    port_name: "PaymentGatewayPort",
    type: "outbound",
    dry_run: false,
  });
  assert.ok(createPortResult.fileCreated);

  const createAdapterResult = await new CreateAdapterToolUseCase(
    sync as ScaffoldingPort,
    manifestWrite,
  ).execute({
    port_name: "PaymentGatewayPort",
    infrastructure_name: "stripe-billing",
    dry_run: false,
  });
  assert.ok(createAdapterResult.fileCreated);

  console.log("✅ mcp-server application use-cases tests passed");
})();
