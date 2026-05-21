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
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import {
  SyncDelegatingManifestMutationAdapter,
  CliLintValidationAdapter,
} from "@hexagen/transaction-system/server";
import {
  ReconcileUseCase,
  StructuredDiffReconciliationAdapter,
  VerdictComparatorAdapter,
  GovernanceAwareConflictResolverAdapter,
  LinterReportFilterAdapter,
} from "@hexagen/reconciliation-engine";
import { LLMProviderSelectorAdapter } from "@hexagen/agentic-interaction";
import type {
  ModifyArchitectureDeps,
  CloudLLMPipelineAdapterConfig,
  ProviderFallbackChain,
} from "@hexagen/agentic-interaction";
import type { LocalLLMProviderPort } from "@hexagen/local-llm";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import type { ArchitectureGraphLike } from "@hexagen/prompt-compiler";
import type { LinterReportLike } from "@hexagen/core-domain";
import {
  ManifestProviderAdapter,
  ServerArchitectureGraphProviderAdapter,
  ServerLinterReportProviderAdapter,
} from "./adapters/wire-adapters";
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
  const maxDepth = 10; // Prevent infinite loop
  let depth = 0;

  while (depth < maxDepth) {
    const manifestPath = join(current, ".architecture", "manifest.yaml");
    if (existsSync(manifestPath)) {
      return current;
    }
    const parent = dirname(current);
    depth++;
    if (parent === current) {
      throw new Error(
        `Could not locate monorepo root from ${from}. No .architecture/manifest.yaml found.`,
      );
    }
    current = parent;
  }

  throw new Error(
    `Could not locate monorepo root from ${from}. Maximum search depth (${maxDepth}) exceeded.`,
  );
}

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

// ============================================================================
// LLM Provider Wiring
// ============================================================================

export interface LLMProviderSelectorConfig {
  preferLocal: boolean;
  webLlmAdapter?: (LocalLLMProviderPort & SendStructuredRequestPort) | null;
  validateLocalLLM?: boolean;
}

export const createLLMProviderSelector = (
  config: LLMProviderSelectorConfig,
): LLMProviderSelectorAdapter => {
  const secretVault = getEnvironmentVault();
  return new LLMProviderSelectorAdapter({
    webLlmAdapter: config.webLlmAdapter ?? null,
    preferLocal: config.preferLocal,
    validateLocalLLM: config.validateLocalLLM ?? false,
    fallbackChain: {
      primary: {
        providerId: "openai" as const,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o",
        apiKeyEnvVar: "OPENAI_API_KEY",
        temperature: 0.3,
        maxTokens: 4000,
      },
      fallbacks: [
        {
          providerId: "anthropic" as const,
          baseUrl: "https://api.anthropic.com/v1",
          model: "claude-3-5-sonnet-20241022",
          apiKeyEnvVar: "ANTHROPIC_API_KEY",
          temperature: 0.3,
          maxTokens: 4000,
        },
      ],
    },
    secretVault,
  });
};

// ============================================================================
// Adapter Singletons
// ============================================================================

let _manifestProvider: ManifestProviderAdapter | null = null;
const getManifestProviderAdapter = (): ManifestProviderAdapter => {
  if (!_manifestProvider) {
    _manifestProvider = new ManifestProviderAdapter();
  }
  return _manifestProvider;
};

let _architectureGraphProvider: ServerArchitectureGraphProviderAdapter | null =
  null;
const getArchitectureGraphProviderAdapter =
  (): ServerArchitectureGraphProviderAdapter => {
    if (!_architectureGraphProvider) {
      _architectureGraphProvider = new ServerArchitectureGraphProviderAdapter();
    }
    return _architectureGraphProvider;
  };

let _linterReportProvider: ServerLinterReportProviderAdapter | null = null;
const getLinterReportProviderAdapter =
  (): ServerLinterReportProviderAdapter => {
    if (!_linterReportProvider) {
      _linterReportProvider = new ServerLinterReportProviderAdapter();
    }
    return _linterReportProvider;
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
    undefined, // promoteStatePort (optional)
    undefined, // manifestPatchPort (deferred)
    new LinterReportFilterAdapter(), // lintFilterPort (restored)
  );

  const deps: ModifyArchitectureDeps = {
    nlParser: new InMemoryNLParserAdapter(),
    promptCompiler: new InMemoryPromptCompilerAdapter(),
    llmSender,
    reconcileUseCase,
    transactionManager: getTransactionManager(),
    manifestProvider: async () => {
      const adapter = getManifestProviderAdapter();
      return adapter.getManifest();
    },
    architectureGraphProvider: async () => {
      const adapter = getArchitectureGraphProviderAdapter();
      const result = await adapter.getArchitectureGraph("default");
      if (!result.success) {
        return emptyArchitectureGraph;
      }
      return result.value;
    },
    linterReportProvider: async () => {
      const adapter = getLinterReportProviderAdapter();
      const result = await adapter.getLinterReport();
      if (!result.success) {
        return emptyLinterReport;
      }
      return result.value;
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
