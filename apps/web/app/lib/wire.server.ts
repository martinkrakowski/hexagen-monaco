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

/**
 * Get or create the ModifyArchitectureUseCase with all dependencies wired.
 *
 * **Caching Strategy**:
 * - Cached when: mode matches cached mode AND no callbacks provided (singleton pattern)
 * - New instance when: mode differs OR callbacks provided (fresh per-request for SSE)
 *
 * **Rationale**:
 * - Singleton caching improves performance for repeated non-streaming operations (in-memory mode)
 * - Per-request instances for callback-based scenarios (SSE) prevent cross-request state leakage
 *
 * @param mode Pipeline mode: 'in-memory' (fast, local) or 'cloud' (actual LLM API)
 * @param cloudConfig Optional cloud provider configuration (API keys, fallback chain)
 * @param callbacks Optional step lifecycle callbacks (onStepRunning, onStepComplete)
 * @returns Fresh or cached ModifyArchitectureUseCase instance
 */
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
    /**
     * DEVELOPMENT STUB: Returns empty manifest.
     * Production code should override with actual ProjectSpec provider.
     * If you see empty manifests in tests or development, this stub was used.
     */
    manifestProvider: async () => {
      // eslint-disable-next-line no-console
      console.warn(
        "[STUB] manifestProvider not overridden — returning empty manifest",
      );
      return emptyManifest;
    },
    /**
     * DEVELOPMENT STUB: Returns empty architecture graph.
     * Production code should override with actual ArchitectureGraph provider.
     * If you see empty graphs in tests or development, this stub was used.
     */
    architectureGraphProvider: async () => {
      // eslint-disable-next-line no-console
      console.warn(
        "[STUB] architectureGraphProvider not overridden — returning empty graph",
      );
      return emptyArchitectureGraph;
    },
    /**
     * DEVELOPMENT STUB: Returns empty linter report (always compliant).
     * Production code should override with actual LinterReport provider.
     * If you see empty reports in tests or development, this stub was used.
     */
    linterReportProvider: async () => {
      // eslint-disable-next-line no-console
      console.warn(
        "[STUB] linterReportProvider not overridden — returning empty report",
      );
      return emptyLinterReport;
    },
    ...callbacks,
  };

  cachedUseCase = new ModifyArchitectureUseCase(deps);
  cachedMode = mode;
  return cachedUseCase;
};

/**
 * Clear the ModifyArchitectureUseCase singleton cache.
 *
 * **When to call**:
 * - Testing: Reset state between test cases to prevent cross-test pollution
 * - Development: Clear stale instances during hot-reload or code changes
 * - Long-running processes: Invalidate cache if configuration changes at runtime
 *
 * **Example (tests)**:
 * ```typescript
 * afterEach(() => clearModifyArchitectureCache());
 * ```
 *
 * **Behavior**:
 * - Sets `cachedUseCase` and `cachedMode` to null
 * - Next call to `getModifyArchitectureUseCase()` creates a fresh instance
 * - No-op if already cleared
 */
export const clearModifyArchitectureCache = (): void => {
  cachedUseCase = null;
  cachedMode = null;
};
