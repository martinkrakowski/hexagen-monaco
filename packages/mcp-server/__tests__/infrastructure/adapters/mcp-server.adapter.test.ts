import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { EventBusPort } from "@hexagen/messaging";
import { MCPServerAdapter } from "../../../src/infrastructure/adapters/mcp-server.adapter.js";
import { AddDependencyToolUseCase } from "../../../src/application/use-cases/add-dependency-tool.use-case.js";
import { AuditBoundariesToolUseCase } from "../../../src/application/use-cases/audit-boundaries-tool.use-case.js";
import { CreateAdapterToolUseCase } from "../../../src/application/use-cases/create-adapter-tool.use-case.js";
import { CreatePortToolUseCase } from "../../../src/application/use-cases/create-port-tool.use-case.js";
import { GetGraphResourceUseCase } from "../../../src/application/use-cases/get-graph-resource.use-case.js";
import { GetLinterReportResourceUseCase } from "../../../src/application/use-cases/get-linter-report-resource.use-case.js";
import { GetManifestResourceUseCase } from "../../../src/application/use-cases/get-manifest-resource.use-case.js";
import { RemoveContextToolUseCase } from "../../../src/application/use-cases/remove-context-tool.use-case.js";
import { RemovePortToolUseCase } from "../../../src/application/use-cases/remove-port-tool.use-case.js";
import { ScaffoldModuleToolUseCase } from "../../../src/application/use-cases/scaffold-module-tool.use-case.js";
import type { ArchitectureQueryPort } from "../../../src/application/ports/out/sync-engine.port.js";
import type { ScaffoldingPort } from "../../../src/application/ports/out/scaffolding.port.js";
import type { LinterPort } from "../../../src/application/ports/out/linter.port.js";
import type { ManifestWritePort } from "../../../src/application/ports/out/manifest-write.port.js";
import type { ProjectConfigurationReadPort } from "../../../src/application/ports/out/project-configuration-read.port.js";

const projectRead: ProjectConfigurationReadPort = {
  async getManifest() {
    return {
      success: true,
      value: [{ name: "sync", type: "core", description: "", layers: {} }],
    } as never;
  },
};

const sync: ArchitectureQueryPort & ScaffoldingPort = {
  async getArchitectureGraph() {
    return { success: true, value: { nodes: [], edges: [] } };
  },
  async getLinterReport() {
    return {
      success: true,
      value: {
        timestamp: new Date().toISOString(),
        isCompliant: true,
        violations: [],
        scannedFilesCount: 1,
      },
    };
  },
  async scaffoldModule() {
    return { success: true, value: { filesCreated: [] } };
  },
  async createPort() {
    return { success: true, value: { fileCreated: "port.ts" } };
  },
  async createAdapter() {
    return { success: true, value: { fileCreated: "adapter.ts" } };
  },
};

const linter: LinterPort = {
  async auditBoundaries() {
    return {
      success: true,
      value: {
        timestamp: new Date().toISOString(),
        isCompliant: true,
        violations: [],
        scannedFilesCount: 1,
      },
    };
  },
};

const manifestWrite: ManifestWritePort = {
  async validateDependency() {
    return { success: true, value: { valid: true, errors: [] } };
  },
  async addDependency() {
    return { success: true, value: { updated: true } };
  },
  async registerBoundedContext() {
    return {
      success: true,
      value: { registered: true, alreadyExisted: false },
    };
  },
  async registerPort() {
    return { success: true, value: { registered: true } };
  },
  async registerAdapter() {
    return { success: true, value: { registered: true } };
  },
  async removePort() {
    return { success: true, value: { removed: true } };
  },
  async removeContext() {
    return { success: true, value: { removed: true } };
  },
};

class EventBusFake implements EventBusPort {
  subscribe(): () => void {
    return () => {};
  }

  publish(): void {}

  unsubscribe(): void {}

  clear(): void {}
}

describe("MCPServerAdapter", () => {
  it("should be constructible with all dependencies", () => {
    const eventBus = new EventBusFake();
    const adapter = new MCPServerAdapter({
      getManifestResourceUseCase: new GetManifestResourceUseCase(projectRead),
      getGraphResourceUseCase: new GetGraphResourceUseCase(sync),
      getLinterReportResourceUseCase: new GetLinterReportResourceUseCase(sync),
      auditBoundariesToolUseCase: new AuditBoundariesToolUseCase(linter),
      scaffoldModuleToolUseCase: new ScaffoldModuleToolUseCase(
        sync,
        manifestWrite,
        eventBus,
      ),
      addDependencyToolUseCase: new AddDependencyToolUseCase(
        manifestWrite,
        eventBus,
      ),
      createPortToolUseCase: new CreatePortToolUseCase(sync, manifestWrite),
      createAdapterToolUseCase: new CreateAdapterToolUseCase(
        sync,
        manifestWrite,
      ),
      removePortToolUseCase: new RemovePortToolUseCase(manifestWrite, eventBus),
      removeContextToolUseCase: new RemoveContextToolUseCase(
        manifestWrite,
        eventBus,
      ),
    });

    assert.ok(adapter);
  });
});
