// apps/web/app/lib/wire.server.ts
// Server-only wiring for project generation and architecture modification
// NEVER imported by client code

import {
  GenerateProjectUseCase,
  ExternalSyncEngineAdapter,
  ArchiveExporterAdapter,
  GitHubExporterAdapter,
} from "@hexagen/project-generation";
import {
  ModifyArchitectureUseCase,
  InMemoryNLParserAdapter,
  InMemoryPromptCompilerAdapter,
  InMemoryLLMSenderAdapter,
  InMemoryLintValidationAdapter,
  CloudLLMPipelineAdapter,
  createDefaultFallbackChain,
  EnvironmentSecretVaultAdapter,
} from "@hexagen/agentic-interaction";
import { SyncDelegatingManifestMutationAdapter } from "@hexagen/transaction-system";
import {
  ReconcileUseCase,
  StructuredDiffReconciliationAdapter,
  VerdictComparatorAdapter,
  GovernanceAwareConflictResolverAdapter,
  LinterReportFilterAdapter,
} from "@hexagen/reconciliation-engine";
import type {
  ModifyArchitectureDeps,
  CloudLLMPipelineAdapterConfig,
  ProviderFallbackChain,
} from "@hexagen/agentic-interaction";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import type {
  ProjectSpecLike,
  ArchitectureGraphLike,
  LinterReportLike,
} from "@hexagen/prompt-compiler";

const emptyManifest: ProjectSpecLike = {
  boundedContexts: [],
};

const emptyArchitectureGraph: ArchitectureGraphLike = {
  nodes: [],
  edges: [],
};

const emptyLinterReport: LinterReportLike = {
  timestamp: new Date().toISOString(),
  isCompliant: true,
  violations: [],
  scannedFilesCount: 0,
};

// ============================================================================
// Project Generation Wiring
// ============================================================================

export const getGenerateProject = (
  destination: "archive" | "github" = "archive",
): GenerateProjectUseCase => {
  const externalGenerator = new ExternalSyncEngineAdapter();
  const exporter =
    destination === "github"
      ? new GitHubExporterAdapter()
      : new ArchiveExporterAdapter();
  return new GenerateProjectUseCase(externalGenerator, exporter);
};

// ============================================================================
// Architecture Modification Wiring
// ============================================================================

// Lazy singleton for environment variable access (domain-layer SecretVaultPort)
let envVaultInstance: EnvironmentSecretVaultAdapter | null = null;
const getEnvironmentVault = (): EnvironmentSecretVaultAdapter => {
  if (!envVaultInstance) {
    envVaultInstance = new EnvironmentSecretVaultAdapter();
  }
  return envVaultInstance;
};

export type PipelineMode = "in-memory" | "cloud";

export interface CloudPipelineConfig {
  fallbackChain?: ProviderFallbackChain;
}

function createLLMSender(
  mode: PipelineMode,
  cloudConfig?: CloudPipelineConfig,
): SendStructuredRequestPort {
  if (mode === "cloud") {
    const fallbackChain =
      cloudConfig?.fallbackChain ?? createDefaultFallbackChain();
    const adapterConfig: CloudLLMPipelineAdapterConfig = {
      fallbackChain,
      secretVault: getEnvironmentVault(),
    };
    return new CloudLLMPipelineAdapter(adapterConfig);
  }
  return new InMemoryLLMSenderAdapter();
}

let cachedUseCase: ModifyArchitectureUseCase | null = null;
let cachedMode: PipelineMode | null = null;

export interface StepCallbacks {
  onStepRunning?: (stepName: string) => void;
  onStepComplete?: (
    stepName: string,
    status: "pending" | "running" | "completed" | "failed" | "skipped",
    durationMs: number | null,
  ) => void;
}

export const getModifyArchitectureUseCase = (
  mode: PipelineMode = "in-memory",
  cloudConfig?: CloudPipelineConfig,
  callbacks?: StepCallbacks,
): ModifyArchitectureUseCase => {
  if (cachedUseCase && cachedMode === mode && !callbacks) return cachedUseCase;

  const llmSender = createLLMSender(mode, cloudConfig);

  const reconcileUseCase = new ReconcileUseCase(
    new StructuredDiffReconciliationAdapter(),
    new VerdictComparatorAdapter(),
    new GovernanceAwareConflictResolverAdapter(),
    undefined, // manifestPatchPort (deferred)
    new LinterReportFilterAdapter(), // lintFilterPort (restored)
  );

  const deps: ModifyArchitectureDeps = {
    nlParser: new InMemoryNLParserAdapter(),
    promptCompiler: new InMemoryPromptCompilerAdapter(),
    llmSender,
    reconcileUseCase,
    transactionManager: new InMemoryTransactionManager(),
    manifestMutation: new SyncDelegatingManifestMutationAdapter(process.cwd()),
    lintValidation: new InMemoryLintValidationAdapter(),
    manifestProvider: async () => emptyManifest,
    architectureGraphProvider: async () => emptyArchitectureGraph,
    linterReportProvider: async () => emptyLinterReport,
    ...callbacks,
  };

  cachedUseCase = new ModifyArchitectureUseCase(deps);
  cachedMode = mode;
  return cachedUseCase;
};
