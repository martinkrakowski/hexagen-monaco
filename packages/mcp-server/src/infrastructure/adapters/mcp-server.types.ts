import type { AcceptTransactionToolPort } from "../../application/ports/in/accept-transaction-tool.port.js";
import type { AddDependencyToolPort } from "../../application/ports/in/add-dependency-tool.port.js";
import type { CreateAdapterToolPort } from "../../application/ports/in/create-adapter-tool.port.js";
import type { CreateContextToolPort } from "../../application/ports/in/create-context-tool.port.js";
import type { CreatePortToolPort } from "../../application/ports/in/create-port-tool.port.js";
import type { DiffManifestToolPort } from "../../application/ports/in/diff-manifest-tool.port.js";
import type { GetTransactionToolPort } from "../../application/ports/in/get-transaction-tool.port.js";
import type { ListTransactionsToolPort } from "../../application/ports/in/list-transactions-tool.port.js";
import type { RejectTransactionToolPort } from "../../application/ports/in/reject-transaction-tool.port.js";
import type { RemoveContextToolPort } from "../../application/ports/in/remove-context-tool.port.js";
import type { RemovePortToolPort } from "../../application/ports/in/remove-port-tool.port.js";
import type { AuditBoundariesToolUseCase } from "../../application/use-cases/audit-boundaries-tool.use-case.js";
import type { GetGraphResourceUseCase } from "../../application/use-cases/get-graph-resource.use-case.js";
import type { GetDecisionsResourceUseCase } from "../../application/use-cases/get-decisions-resource.use-case.js";
import type { GetInvariantsResourceUseCase } from "../../application/use-cases/get-invariants-resource.use-case.js";
import type { GetLinterConfigResourceUseCase } from "../../application/use-cases/get-linter-config-resource.use-case.js";
import type { GetLinterReportResourceUseCase } from "../../application/use-cases/get-linter-report-resource.use-case.js";
import type { GetManifestResourceUseCase } from "../../application/use-cases/get-manifest-resource.use-case.js";
import type { GetWorkspaceContextResourceUseCase } from "../../application/use-cases/get-workspace-context-resource.use-case.js";
import type { InitializeFeatureWorktreeToolUseCase } from "../../application/use-cases/initialize-feature-worktree-tool.use-case.js";
import type { LogAgentRemediationToolUseCase } from "../../application/use-cases/log-agent-remediation-tool.use-case.js";
import type { ScaffoldModuleToolUseCase } from "../../application/use-cases/scaffold-module-tool.use-case.js";
import type { SubmitArchitecturalSpecToolUseCase } from "../../application/use-cases/submit-architectural-spec-tool.use-case.js";
import type { GenerateTopologyToolUseCase } from "../../application/use-cases/generate-topology-tool.use-case.js";
import type { GenerateAdaptersToolUseCase } from "../../application/use-cases/generate-adapters-tool.use-case.js";
import type { GenerateManifestPipelineToolUseCase } from "../../application/use-cases/generate-manifest-pipeline-tool.use-case.js";

/**
 * The manifest-structure tool family (remediation item 6.5(a) / HEX-019):
 * create + remove context/port/adapter, add-dependency, diff-manifest.
 *
 * The field names are deliberately left as they were. Renaming them to
 * `*ToolPort` would force an edit to `src/index.ts`, which cannot currently be
 * committed: `turbo/no-undeclared-env-vars` errors there on two OPENAI_* reads
 * that predate this change, and the fix would be a `turbo.json` edit. The
 * types, not the identifiers, carry the direction claim.
 */
export interface ManifestStructureToolDependencies {
  addDependencyToolUseCase: AddDependencyToolPort;
  createPortToolUseCase: CreatePortToolPort;
  createAdapterToolUseCase: CreateAdapterToolPort;
  removePortToolUseCase: RemovePortToolPort;
  removeContextToolUseCase: RemoveContextToolPort;
  createContextToolUseCase: CreateContextToolPort;
  diffManifestToolUseCase: DiffManifestToolPort;
}

/**
 * The transaction-lifecycle tool family (remediation item 6.5(b) / HEX-019):
 * accept, reject, get and list transaction.
 *
 * Only the *inbound* half moves here. The family's driven collaborator —
 * `TransactionManagerPort` from `@hexagen/transaction-system`, implemented by
 * the `InMemoryTransactionManager` adapter — is an existing port and is reused
 * unchanged; it stays a constructor dependency of the four use cases and is
 * deliberately absent from this bag. A handler holding the manager directly
 * would drive the transaction store past the use case, which is the coupling
 * this item removes rather than relocates.
 *
 * Field names are left as they were, for the same reason the (a) family's were:
 * renaming them to `*ToolPort` forces an edit to `src/index.ts`, which cannot
 * currently be committed (`turbo/no-undeclared-env-vars` errors there on two
 * pre-existing OPENAI_* reads, and the fix would be a `turbo.json` edit). The
 * types, not the identifiers, carry the direction claim.
 */
export interface TransactionLifecycleToolDependencies {
  getTransactionToolUseCase: GetTransactionToolPort;
  listTransactionsToolUseCase: ListTransactionsToolPort;
  acceptTransactionToolUseCase: AcceptTransactionToolPort;
  rejectTransactionToolUseCase: RejectTransactionToolPort;
}

export interface MCPServerAdapterDependencies
  extends
    ManifestStructureToolDependencies,
    TransactionLifecycleToolDependencies {
  getManifestResourceUseCase: GetManifestResourceUseCase;
  getGraphResourceUseCase: GetGraphResourceUseCase;
  getLinterReportResourceUseCase: GetLinterReportResourceUseCase;
  getDecisionsResourceUseCase: GetDecisionsResourceUseCase;
  getInvariantsResourceUseCase: GetInvariantsResourceUseCase;
  getLinterConfigResourceUseCase: GetLinterConfigResourceUseCase;
  getWorkspaceContextResourceUseCase: GetWorkspaceContextResourceUseCase;
  auditBoundariesToolUseCase: AuditBoundariesToolUseCase;
  scaffoldModuleToolUseCase: ScaffoldModuleToolUseCase;
  initializeFeatureWorktreeToolUseCase: InitializeFeatureWorktreeToolUseCase;
  submitArchitecturalSpecToolUseCase: SubmitArchitecturalSpecToolUseCase;
  logAgentRemediationToolUseCase: LogAgentRemediationToolUseCase;
  generateTopologyToolUseCase: GenerateTopologyToolUseCase;
  generateAdaptersToolUseCase: GenerateAdaptersToolUseCase;
  generateManifestPipelineToolUseCase: GenerateManifestPipelineToolUseCase;
}

/**
 * ADR-0048 / HEX-019 compile-time half of the guard, kept in production code so
 * that a regression fails `yarn build` — not only a test that can be deleted.
 *
 * `PublicShapeOf<T>` maps over `keyof T`, which for a class type lists only its
 * *public* members. A concrete `*UseCase` class keeps its collaborators in
 * `private readonly` constructor properties, so the mapped copy loses them and
 * is therefore **not** assignable back to the class. An interface — an inbound
 * port — has no private state, so its mapped copy is assignable to itself.
 *
 * `Expect<false>` is a compile error, so this asserts rather than narrows:
 * retyping any manifest-structure dependency back to a concrete use-case class
 * fails `tsc` here, in a file that ships, rather than in a deletable test.
 */
type PublicShapeOf<T> = { [K in keyof T]: T[K] };
type StructurallySatisfiable<T> = { [K in keyof T]: PublicShapeOf<T[K]> };
type Expect<T extends true> = T;

export type ManifestStructureDepsAreInboundPorts = Expect<
  StructurallySatisfiable<ManifestStructureToolDependencies> extends ManifestStructureToolDependencies
    ? true
    : false
>;

/**
 * Same check for the transaction-lifecycle family (item 6.5(b)).
 *
 * Note what this does *not* catch, so nobody mistakes it for the whole guard:
 * a homomorphic mapped type over an array is the identity, so
 * `x: SomeToolUseCase[]` satisfies it. The source-text guard in
 * `__tests__/architecture/transaction-lifecycle-inbound-ports.guard.test.ts`
 * covers that hole by reading declared types verbatim and reporting any it
 * cannot tie to a single named contract. Neither half is sufficient alone.
 */
export type TransactionLifecycleDepsAreInboundPorts = Expect<
  StructurallySatisfiable<TransactionLifecycleToolDependencies> extends TransactionLifecycleToolDependencies
    ? true
    : false
>;

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
