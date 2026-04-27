// apps/web/app/lib/wire.architecture-modification.ts
// Server-side only wiring for architecture modification pipeline
// Supports both in-memory (testing) and cloud LLM (production) modes

import {
  ModifyArchitectureUseCase,
  InMemoryNLParserAdapter,
  InMemoryPromptCompilerAdapter,
  InMemoryLLMSenderAdapter,
  InMemoryLintValidationAdapter,
  CloudLLMPipelineAdapter,
  createDefaultFallbackChain,
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
    const adapterConfig: CloudLLMPipelineAdapterConfig = { fallbackChain };
    return new CloudLLMPipelineAdapter(adapterConfig);
  }
  return new InMemoryLLMSenderAdapter();
}

let cachedUseCase: ModifyArchitectureUseCase | null = null;
let cachedMode: PipelineMode | null = null;

export const getModifyArchitectureUseCase = (
  mode: PipelineMode = "in-memory",
  cloudConfig?: CloudPipelineConfig,
): ModifyArchitectureUseCase => {
  if (cachedUseCase && cachedMode === mode) return cachedUseCase;

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
  };

  cachedUseCase = new ModifyArchitectureUseCase(deps);
  cachedMode = mode;
  return cachedUseCase;
};
