import { MCPServerAdapter } from "./infrastructure/adapters/mcp-server.adapter.js";
import type { EventBusPort } from "@hexagen/messaging";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import { AcceptTransactionToolUseCase } from "./application/use-cases/accept-transaction-tool.use-case.js";
import { AddDependencyToolUseCase } from "./application/use-cases/add-dependency-tool.use-case.js";
import { AuditBoundariesToolUseCase } from "./application/use-cases/audit-boundaries-tool.use-case.js";
import { DiffManifestToolUseCase } from "./application/use-cases/diff-manifest-tool.use-case.js";
import { CreateAdapterToolUseCase } from "./application/use-cases/create-adapter-tool.use-case.js";
import { CreateContextToolUseCase } from "./application/use-cases/create-context-tool.use-case.js";
import { CreatePortToolUseCase } from "./application/use-cases/create-port-tool.use-case.js";
import { GenerateAdaptersToolUseCase } from "./application/use-cases/generate-adapters-tool.use-case.js";
import { GenerateManifestPipelineToolUseCase } from "./application/use-cases/generate-manifest-pipeline-tool.use-case.js";
import { GenerateTopologyToolUseCase } from "./application/use-cases/generate-topology-tool.use-case.js";
import { GetGraphResourceUseCase } from "./application/use-cases/get-graph-resource.use-case.js";
import { GetLinterReportResourceUseCase } from "./application/use-cases/get-linter-report-resource.use-case.js";
import { GetDecisionsResourceUseCase } from "./application/use-cases/get-decisions-resource.use-case.js";
import { GetInvariantsResourceUseCase } from "./application/use-cases/get-invariants-resource.use-case.js";
import { GetLinterConfigResourceUseCase } from "./application/use-cases/get-linter-config-resource.use-case.js";
import { GetManifestResourceUseCase } from "./application/use-cases/get-manifest-resource.use-case.js";
import { GetTransactionToolUseCase } from "./application/use-cases/get-transaction-tool.use-case.js";
import { GetWorkspaceContextResourceUseCase } from "./application/use-cases/get-workspace-context-resource.use-case.js";
import { InitializeFeatureWorktreeToolUseCase } from "./application/use-cases/initialize-feature-worktree-tool.use-case.js";
import { ListTransactionsToolUseCase } from "./application/use-cases/list-transactions-tool.use-case.js";
import { LogAgentRemediationToolUseCase } from "./application/use-cases/log-agent-remediation-tool.use-case.js";
import { RejectTransactionToolUseCase } from "./application/use-cases/reject-transaction-tool.use-case.js";
import { RemoveContextToolUseCase } from "./application/use-cases/remove-context-tool.use-case.js";
import { RemovePortToolUseCase } from "./application/use-cases/remove-port-tool.use-case.js";
import { ScaffoldModuleToolUseCase } from "./application/use-cases/scaffold-module-tool.use-case.js";
import { SubmitArchitecturalSpecToolUseCase } from "./application/use-cases/submit-architectural-spec-tool.use-case.js";
import type { ArchitectureQueryPort } from "./application/ports/out/sync-engine.port.js";
import type { ManifestDiffPort } from "./application/ports/out/manifest-diff.port.js";
import type { GovernanceReadPort } from "./application/ports/out/governance-read.port.js";
import type { ManifestWritePort } from "./application/ports/out/manifest-write.port.js";
import type { ProjectConfigurationReadPort } from "./application/ports/out/project-configuration-read.port.js";
import type { LinterPort } from "./application/ports/out/linter.port.js";
import type { ScaffoldingPort } from "./application/ports/out/scaffolding.port.js";
import type { ReportGovernancePort } from "./application/ports/out/report-governance.port.js";
import type { ManifestGenerationPort } from "./application/ports/out/manifest-generation.port.js";
import { GovernanceReadAdapter } from "./infrastructure/adapters/governance-read.adapter.js";
import { LinterAdapter } from "./infrastructure/adapters/linter.adapter.js";
import { ManifestDiffAdapter } from "./infrastructure/adapters/manifest-diff.adapter.js";
import { ManifestWriteAdapter } from "./infrastructure/adapters/manifest-write.adapter.js";
import { ProjectConfigurationReadAdapter } from "./infrastructure/adapters/project-configuration-read.adapter.js";
import { SyncEngineAdapter } from "./infrastructure/adapters/sync-engine.adapter.js";
import { InMemoryEventBusAdapter } from "./infrastructure/adapters/in-memory-event-bus.adapter.js";
import { OpenAIManifestGenerationAdapter } from "./infrastructure/adapters/manifest-generation.adapter.js";
import { ReportGovernanceAdapter } from "./infrastructure/adapters/report-governance.adapter.js";

function envOptional(name: string): string | undefined {
  return process.env[name];
}

export interface MCPCompositionRoot {
  projectConfigurationReadPort: ProjectConfigurationReadPort;
  governanceReadPort: GovernanceReadPort;
  architectureQueryPort: ArchitectureQueryPort;
  scaffoldingPort: ScaffoldingPort;
  manifestWritePort: ManifestWritePort;
  linterPort: LinterPort;
  manifestDiffPort: ManifestDiffPort;
  eventBusPort: EventBusPort;
  reportGovernancePort: ReportGovernancePort;
  transactionManagerPort: TransactionManagerPort;
  manifestGenerationPort: ManifestGenerationPort;
}

export function createDefaultMCPCompositionRoot(
  workspaceRoot: string = process.cwd(),
): MCPCompositionRoot {
  const syncEngineAdapter = new SyncEngineAdapter(workspaceRoot);
  const manifestWritePort = new ManifestWriteAdapter(workspaceRoot);
  const eventBusPort = new InMemoryEventBusAdapter();

  const manifestGenerationPort = new OpenAIManifestGenerationAdapter(
    {
      apiKey: process.env.OPENAI_API_KEY ?? "",
      baseUrl: envOptional("OPENAI_BASE_URL"),
      model: envOptional("OPENAI_MODEL"),
    },
    manifestWritePort,
    eventBusPort,
  );

  return {
    projectConfigurationReadPort: new ProjectConfigurationReadAdapter(
      workspaceRoot,
    ),
    governanceReadPort: new GovernanceReadAdapter(workspaceRoot),
    architectureQueryPort: syncEngineAdapter,
    scaffoldingPort: syncEngineAdapter,
    manifestWritePort,
    linterPort: new LinterAdapter(syncEngineAdapter),
    manifestDiffPort: new ManifestDiffAdapter(workspaceRoot),
    eventBusPort,
    reportGovernancePort: new ReportGovernanceAdapter(workspaceRoot),
    transactionManagerPort: new InMemoryTransactionManager(),
    manifestGenerationPort,
  };
}

export function createMCPServer(root: MCPCompositionRoot): MCPServerAdapter {
  const getDecisionsResourceUseCase = new GetDecisionsResourceUseCase(
    root.governanceReadPort,
  );
  const getInvariantsResourceUseCase = new GetInvariantsResourceUseCase(
    root.governanceReadPort,
  );
  const getLinterConfigResourceUseCase = new GetLinterConfigResourceUseCase(
    root.governanceReadPort,
  );
  const getWorkspaceContextResourceUseCase =
    new GetWorkspaceContextResourceUseCase(root.governanceReadPort);
  const getManifestResourceUseCase = new GetManifestResourceUseCase(
    root.projectConfigurationReadPort,
  );
  const getGraphResourceUseCase = new GetGraphResourceUseCase(
    root.architectureQueryPort,
  );
  const getLinterReportResourceUseCase = new GetLinterReportResourceUseCase(
    root.architectureQueryPort,
  );
  const auditBoundariesToolUseCase = new AuditBoundariesToolUseCase(
    root.linterPort,
  );
  const scaffoldModuleToolUseCase = new ScaffoldModuleToolUseCase(
    root.transactionManagerPort,
  );
  const addDependencyToolUseCase = new AddDependencyToolUseCase(
    root.manifestWritePort,
    root.transactionManagerPort,
  );
  const createPortToolUseCase = new CreatePortToolUseCase(
    root.transactionManagerPort,
  );
  const createAdapterToolUseCase = new CreateAdapterToolUseCase(
    root.transactionManagerPort,
  );
  const removePortToolUseCase = new RemovePortToolUseCase(
    root.transactionManagerPort,
  );
  const removeContextToolUseCase = new RemoveContextToolUseCase(
    root.transactionManagerPort,
  );
  const createContextToolUseCase = new CreateContextToolUseCase(
    root.transactionManagerPort,
  );
  const diffManifestToolUseCase = new DiffManifestToolUseCase(
    root.manifestDiffPort,
  );
  const initializeFeatureWorktreeToolUseCase =
    new InitializeFeatureWorktreeToolUseCase(root.reportGovernancePort);
  const submitArchitecturalSpecToolUseCase =
    new SubmitArchitecturalSpecToolUseCase(root.reportGovernancePort);
  const logAgentRemediationToolUseCase = new LogAgentRemediationToolUseCase(
    root.reportGovernancePort,
  );
  const getTransactionToolUseCase = new GetTransactionToolUseCase(
    root.transactionManagerPort,
  );
  const listTransactionsToolUseCase = new ListTransactionsToolUseCase(
    root.transactionManagerPort,
  );
  const acceptTransactionToolUseCase = new AcceptTransactionToolUseCase(
    root.transactionManagerPort,
    root.manifestWritePort,
    root.scaffoldingPort,
    root.eventBusPort,
  );
  const rejectTransactionToolUseCase = new RejectTransactionToolUseCase(
    root.transactionManagerPort,
  );
  const generateTopologyToolUseCase = new GenerateTopologyToolUseCase(
    root.manifestGenerationPort,
  );
  const generateAdaptersToolUseCase = new GenerateAdaptersToolUseCase(
    root.manifestGenerationPort,
  );
  const generateManifestPipelineToolUseCase =
    new GenerateManifestPipelineToolUseCase(root.manifestGenerationPort);

  return new MCPServerAdapter({
    getManifestResourceUseCase,
    getGraphResourceUseCase,
    getLinterReportResourceUseCase,
    getDecisionsResourceUseCase,
    getInvariantsResourceUseCase,
    getLinterConfigResourceUseCase,
    getWorkspaceContextResourceUseCase,
    auditBoundariesToolUseCase,
    scaffoldModuleToolUseCase,
    addDependencyToolUseCase,
    createPortToolUseCase,
    createAdapterToolUseCase,
    removePortToolUseCase,
    removeContextToolUseCase,
    createContextToolUseCase,
    diffManifestToolUseCase,
    initializeFeatureWorktreeToolUseCase,
    submitArchitecturalSpecToolUseCase,
    logAgentRemediationToolUseCase,
    getTransactionToolUseCase,
    listTransactionsToolUseCase,
    acceptTransactionToolUseCase,
    rejectTransactionToolUseCase,
    generateTopologyToolUseCase,
    generateAdaptersToolUseCase,
    generateManifestPipelineToolUseCase,
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
