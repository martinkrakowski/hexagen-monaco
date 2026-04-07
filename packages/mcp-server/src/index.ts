import { MCPServerAdapter } from "./infrastructure/adapters/mcp-server.adapter.js";
import type { EventBusPort } from "@hexagen/messaging";
import { AddDependencyToolUseCase } from "./application/use-cases/add-dependency-tool.use-case.js";
import { AuditBoundariesToolUseCase } from "./application/use-cases/audit-boundaries-tool.use-case.js";
import { CreateAdapterToolUseCase } from "./application/use-cases/create-adapter-tool.use-case.js";
import { CreatePortToolUseCase } from "./application/use-cases/create-port-tool.use-case.js";
import { GetGraphResourceUseCase } from "./application/use-cases/get-graph-resource.use-case.js";
import { GetLinterReportResourceUseCase } from "./application/use-cases/get-linter-report-resource.use-case.js";
import { GetManifestResourceUseCase } from "./application/use-cases/get-manifest-resource.use-case.js";
import { ScaffoldModuleToolUseCase } from "./application/use-cases/scaffold-module-tool.use-case.js";
import type { ManifestWritePort } from "./application/ports/out/manifest-write.port.js";
import type { ProjectConfigurationReadPort } from "./application/ports/out/project-configuration-read.port.js";
import type { LinterPort } from "./application/ports/out/linter.port.js";
import type { SyncEnginePort } from "./application/ports/out/sync-engine.port.js";
import { LinterAdapter } from "./infrastructure/adapters/linter.adapter.js";
import { ManifestWriteAdapter } from "./infrastructure/adapters/manifest-write.adapter.js";
import { ProjectConfigurationReadAdapter } from "./infrastructure/adapters/project-configuration-read.adapter.js";
import { SyncEngineAdapter } from "./infrastructure/adapters/sync-engine.adapter.js";
import { InMemoryEventBusAdapter } from "./infrastructure/adapters/in-memory-event-bus.adapter.js";

export interface MCPCompositionRoot {
  projectConfigurationReadPort: ProjectConfigurationReadPort;
  syncEnginePort: SyncEnginePort;
  manifestWritePort: ManifestWritePort;
  linterPort: LinterPort;
  eventBusPort: EventBusPort;
}

export function createDefaultMCPCompositionRoot(
  workspaceRoot: string = process.cwd(),
): MCPCompositionRoot {
  const syncEnginePort = new SyncEngineAdapter(workspaceRoot);
  const manifestWritePort = new ManifestWriteAdapter(workspaceRoot);

  return {
    projectConfigurationReadPort: new ProjectConfigurationReadAdapter(
      workspaceRoot,
    ),
    syncEnginePort,
    manifestWritePort,
    linterPort: new LinterAdapter(syncEnginePort),
    eventBusPort: new InMemoryEventBusAdapter(),
  };
}

export function createMCPServer(root: MCPCompositionRoot): MCPServerAdapter {
  const getManifestResourceUseCase = new GetManifestResourceUseCase(
    root.projectConfigurationReadPort,
  );
  const getGraphResourceUseCase = new GetGraphResourceUseCase(
    root.syncEnginePort,
  );
  const getLinterReportResourceUseCase = new GetLinterReportResourceUseCase(
    root.syncEnginePort,
  );
  const auditBoundariesToolUseCase = new AuditBoundariesToolUseCase(
    root.linterPort,
  );
  const scaffoldModuleToolUseCase = new ScaffoldModuleToolUseCase(
    root.syncEnginePort,
    root.manifestWritePort,
    root.eventBusPort,
  );
  const addDependencyToolUseCase = new AddDependencyToolUseCase(
    root.manifestWritePort,
    root.eventBusPort,
  );
  const createPortToolUseCase = new CreatePortToolUseCase(root.syncEnginePort);
  const createAdapterToolUseCase = new CreateAdapterToolUseCase(
    root.syncEnginePort,
  );

  return new MCPServerAdapter({
    getManifestResourceUseCase,
    getGraphResourceUseCase,
    getLinterReportResourceUseCase,
    auditBoundariesToolUseCase,
    scaffoldModuleToolUseCase,
    addDependencyToolUseCase,
    createPortToolUseCase,
    createAdapterToolUseCase,
  });
}

export async function startMCPServer(root: MCPCompositionRoot): Promise<void> {
  const server = createMCPServer(root);
  await server.start();
}

export async function startDefaultMCPServer(
  workspaceRoot: string = process.cwd(),
): Promise<void> {
  await startMCPServer(createDefaultMCPCompositionRoot(workspaceRoot));
}
