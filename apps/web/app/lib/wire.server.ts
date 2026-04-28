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
  CloudLLMPipelineAdapter,
  createDefaultFallbackChain,
  EnvironmentSecretVaultAdapter,
} from "@hexagen/agentic-interaction";
import {
  InMemoryTransactionManager,
  SyncDelegatingManifestMutationAdapter,
  CliLintValidationAdapter,
} from "@hexagen/transaction-system";
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
import type {
  ProjectSpecLike,
  ArchitectureGraphLike,
  LinterReportLike,
} from "@hexagen/prompt-compiler";
import { existsSync } from "fs";
import { join, dirname } from "path";

/**
 * Find the monorepo root by searching upward for .architecture/manifest.yaml
 *
 * This fixes the workspace root resolution issue where process.cwd() resolves
 * to apps/web instead of the monorepo root, causing manifest mutations to
 * target the wrong directory.
 *
 * @param from Starting directory (defaults to process.cwd())
 * @returns Monorepo root path
 * @throws Error if no manifest found
 */
function findMonorepoRoot(from: string = process.cwd()): string {
  let current = from;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const manifestPath = join(current, ".architecture", "manifest.yaml");
    if (existsSync(manifestPath)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `Could not locate monorepo root from ${from}. No .architecture/manifest.yaml found.`,
      );
    }
    current = parent;
  }
}

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

let _transactionManager: InMemoryTransactionManager | null = null;

export const getTransactionManager = (): InMemoryTransactionManager => {
  if (!_transactionManager) {
    _transactionManager = new InMemoryTransactionManager();
  }
  return _transactionManager;
};

let _manifestMutation: SyncDelegatingManifestMutationAdapter | null = null;

export const getManifestMutation =
  (): SyncDelegatingManifestMutationAdapter => {
    if (!_manifestMutation) {
      const workspaceRoot = findMonorepoRoot();
      _manifestMutation = new SyncDelegatingManifestMutationAdapter(
        workspaceRoot,
      );
    }
    return _manifestMutation;
  };

let _lintValidation: CliLintValidationAdapter | null = null;

export const getLintValidation = (): CliLintValidationAdapter => {
  if (!_lintValidation) {
    const workspaceRoot = findMonorepoRoot();
    _lintValidation = new CliLintValidationAdapter(workspaceRoot);
  }
  return _lintValidation;
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
 * @param signal Optional AbortSignal to cancel LLM inference
 * @param callbacks Optional step lifecycle callbacks (onStepRunning, onStepComplete)
 * @returns Fresh or cached ModifyArchitectureUseCase instance
 */
export const getModifyArchitectureUseCase = (
  mode: PipelineMode = "in-memory",
  signal?: AbortSignal,
  callbacks?: StepCallbacks,
): ModifyArchitectureUseCase => {
  if (cachedUseCase && cachedMode === mode && !callbacks && !signal)
    return cachedUseCase;

  const llmSender = createLLMSender(mode, undefined);

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
    transactionManager: getTransactionManager(),
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
    signal,
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
  _transactionManager = null;
  _manifestMutation = null;
  _lintValidation = null;
};
