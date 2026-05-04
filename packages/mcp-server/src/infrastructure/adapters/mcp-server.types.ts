import type { AddDependencyToolUseCase } from "../../application/use-cases/add-dependency-tool.use-case.js";
import type { AuditBoundariesToolUseCase } from "../../application/use-cases/audit-boundaries-tool.use-case.js";
import type { CreateAdapterToolUseCase } from "../../application/use-cases/create-adapter-tool.use-case.js";
import type { CreateContextToolUseCase } from "../../application/use-cases/create-context-tool.use-case.js";
import type { DiffManifestToolUseCase } from "../../application/use-cases/diff-manifest-tool.use-case.js";
import type { CreatePortToolUseCase } from "../../application/use-cases/create-port-tool.use-case.js";
import type { GetGraphResourceUseCase } from "../../application/use-cases/get-graph-resource.use-case.js";
import type { GetDecisionsResourceUseCase } from "../../application/use-cases/get-decisions-resource.use-case.js";
import type { GetInvariantsResourceUseCase } from "../../application/use-cases/get-invariants-resource.use-case.js";
import type { GetLinterConfigResourceUseCase } from "../../application/use-cases/get-linter-config-resource.use-case.js";
import type { GetLinterReportResourceUseCase } from "../../application/use-cases/get-linter-report-resource.use-case.js";
import type { GetManifestResourceUseCase } from "../../application/use-cases/get-manifest-resource.use-case.js";
import type { GetWorkspaceContextResourceUseCase } from "../../application/use-cases/get-workspace-context-resource.use-case.js";
import type { InitializeFeatureWorktreeToolUseCase } from "../../application/use-cases/initialize-feature-worktree-tool.use-case.js";
import type { LogAgentRemediationToolUseCase } from "../../application/use-cases/log-agent-remediation-tool.use-case.js";
import type { RemoveContextToolUseCase } from "../../application/use-cases/remove-context-tool.use-case.js";
import type { RemovePortToolUseCase } from "../../application/use-cases/remove-port-tool.use-case.js";
import type { ScaffoldModuleToolUseCase } from "../../application/use-cases/scaffold-module-tool.use-case.js";
import type { SubmitArchitecturalSpecToolUseCase } from "../../application/use-cases/submit-architectural-spec-tool.use-case.js";
import type { GetTransactionToolUseCase } from "../../application/use-cases/get-transaction-tool.use-case.js";
import type { ListTransactionsToolUseCase } from "../../application/use-cases/list-transactions-tool.use-case.js";
import type { AcceptTransactionToolUseCase } from "../../application/use-cases/accept-transaction-tool.use-case.js";
import type { RejectTransactionToolUseCase } from "../../application/use-cases/reject-transaction-tool.use-case.js";
import type { GenerateTopologyToolUseCase } from "../../application/use-cases/generate-topology-tool.use-case.js";
import type { GenerateAdaptersToolUseCase } from "../../application/use-cases/generate-adapters-tool.use-case.js";
import type { GenerateManifestPipelineToolUseCase } from "../../application/use-cases/generate-manifest-pipeline-tool.use-case.js";

export interface MCPServerAdapterDependencies {
  getManifestResourceUseCase: GetManifestResourceUseCase;
  getGraphResourceUseCase: GetGraphResourceUseCase;
  getLinterReportResourceUseCase: GetLinterReportResourceUseCase;
  getDecisionsResourceUseCase: GetDecisionsResourceUseCase;
  getInvariantsResourceUseCase: GetInvariantsResourceUseCase;
  getLinterConfigResourceUseCase: GetLinterConfigResourceUseCase;
  getWorkspaceContextResourceUseCase: GetWorkspaceContextResourceUseCase;
  auditBoundariesToolUseCase: AuditBoundariesToolUseCase;
  scaffoldModuleToolUseCase: ScaffoldModuleToolUseCase;
  addDependencyToolUseCase: AddDependencyToolUseCase;
  createPortToolUseCase: CreatePortToolUseCase;
  createAdapterToolUseCase: CreateAdapterToolUseCase;
  removePortToolUseCase: RemovePortToolUseCase;
  removeContextToolUseCase: RemoveContextToolUseCase;
  createContextToolUseCase: CreateContextToolUseCase;
  diffManifestToolUseCase: DiffManifestToolUseCase;
  initializeFeatureWorktreeToolUseCase: InitializeFeatureWorktreeToolUseCase;
  submitArchitecturalSpecToolUseCase: SubmitArchitecturalSpecToolUseCase;
  logAgentRemediationToolUseCase: LogAgentRemediationToolUseCase;
  getTransactionToolUseCase: GetTransactionToolUseCase;
  listTransactionsToolUseCase: ListTransactionsToolUseCase;
  acceptTransactionToolUseCase: AcceptTransactionToolUseCase;
  rejectTransactionToolUseCase: RejectTransactionToolUseCase;
  generateTopologyToolUseCase: GenerateTopologyToolUseCase;
  generateAdaptersToolUseCase: GenerateAdaptersToolUseCase;
  generateManifestPipelineToolUseCase: GenerateManifestPipelineToolUseCase;
}

export interface MCPServerRuntime {
  connect(transport: unknown): Promise<void>;
  setRequestHandler(
    schema: unknown,
    handler: (
      request: unknown,
      extra: { signal: AbortSignal },
    ) => Promise<unknown>,
  ): void;
  close?: () => Promise<void> | void;
}

export interface MCPSchemas {
  CallToolRequestSchema: unknown;
  ListToolsRequestSchema: unknown;
  ListResourcesRequestSchema: unknown;
  ReadResourceRequestSchema: unknown;
}
