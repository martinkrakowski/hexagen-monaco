// apps/web/app/lib/wire.server.ts
// Server-only wiring for project generation and architecture modification
// NEVER imported by client code

import {
  GenerateProjectUseCase,
  ExternalSyncEngineAdapter,
  ArchiveExporterAdapter,
} from "@hexagen/project-generation";
import type { AddOnMaterializerPort } from "@hexagen/project-generation";
import {
  GitHubExporterAdapter,
  GitHubRepositoryWriterAdapter,
} from "@hexagen/external-integration";
import type { RepositoryWriterPort } from "@hexagen/external-integration";
import {
  ModifyArchitectureUseCase,
  InMemoryNLParserAdapter,
  InMemoryPromptCompilerAdapter,
  InMemoryLLMSenderAdapter,
  CloudLLMPipelineAdapter,
  createDefaultFallbackChain,
  resolveFallbackChain,
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
  Stage1RefinementConfig,
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
import { logger } from "../../lib/structured-logger";

// The manifest-path anchor lives in its own module so the read-only display
// providers in ./adapters/wire-adapters can share it without importing this
// composition root back (which would be a require cycle). Re-exported here so
// existing `@/lib/wire.server` consumers (the modify-family routes) keep working.
import { findMonorepoRoot } from "./monorepo-root";
export { findMonorepoRoot };

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

let _materializerLoad: Promise<AddOnMaterializerPort> | null = null;

/**
 * Add-on template materializer, loaded lazily. The ~0.7 MB generated bundle is
 * pulled in via a dynamic `import()` on the first `materialize()` call — and the
 * use case only calls that when `addOnsAnswers` is non-empty. So a generation /
 * export request that selects no add-ons never imports or parses the bundle, and
 * it stays out of `wire.server`'s static module graph entirely (only the
 * `/in-memory` subpath carries it). A successful load is memoized so concurrent
 * first-uses share a single import; a failed load is cleared so a transient
 * import/parse error (e.g. a blip during a rolling restart) doesn't poison every
 * later call with the same rejected promise.
 */
const addOnMaterializer: AddOnMaterializerPort = {
  async materialize(addOnsAnswers, options) {
    _materializerLoad ??= import("@hexagen/template-engine/in-memory")
      .then(({ createInMemoryMaterializer }) => createInMemoryMaterializer())
      .catch((error: unknown) => {
        _materializerLoad = null;
        throw error;
      });
    const materializer = await _materializerLoad;
    return materializer.materialize(addOnsAnswers, options);
  },
};

export const getGenerateProject = (
  destination: "archive" | "github" = "archive",
): GenerateProjectUseCase => {
  const externalGenerator = new ExternalSyncEngineAdapter();
  const exporter =
    destination === "github"
      ? new GitHubExporterAdapter()
      : new ArchiveExporterAdapter();
  return new GenerateProjectUseCase(
    externalGenerator,
    exporter,
    addOnMaterializer,
  );
};

let _repositoryWriter: RepositoryWriterPort | null = null;

/**
 * Composition-root accessor for the repository writer used by the editor-push
 * route (`/api/push/github`). The adapter is stateless and token-per-call, so a
 * single instance safely serves requests for different users.
 */
export const getRepositoryWriter = (): RepositoryWriterPort => {
  if (!_repositoryWriter) {
    _repositoryWriter = new GitHubRepositoryWriterAdapter();
  }
  return _repositoryWriter;
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

// Built per call (not a module-level const) so the env-derived entries
// (LLM_BASE_URL / LLM_MODEL / INCEPTION_MODEL) are read at request time —
// same behavior as when this object lived inline in the selector factory.
const buildStagedGenerationFallbackChain = (): ProviderFallbackChain => {
  return {
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
      // Generic LLM_API_KEY provider — supports any OpenAI-compatible endpoint
      // configured via LLM_BASE_URL / LLM_MODEL (same vars as the chat route).
      {
        providerId: "openai" as const,
        baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
        model: process.env.LLM_MODEL || "gpt-4o-mini",
        apiKeyEnvVar: "LLM_API_KEY",
        temperature: 0.3,
        maxTokens: 4000,
      },
      // Inception Labs (Mercury diffusion models) — OpenAI-compatible chat
      // completions; activates only when INCEPTION_API_KEY is set. Mercury
      // reasons by default (reasoning_effort: "medium"). The VALIDATED prod
      // regime is LLM_REASONING=low — the model-sweep parity numbers were
      // measured @low, while "disabled" (Inception's "instant") dropped to
      // 62.5% success with NDJSON failures (see cloud-llm-reasoning.ts and
      // docs/planning/mercury-2-prod-flip-runbook.md). Never send
      // `diffusing: true` — it streams noisy intermediate tokens that break
      // structured-output parsing.
      {
        providerId: "inception" as const,
        baseUrl: "https://api.inceptionlabs.ai/v1",
        model: process.env.INCEPTION_MODEL || "mercury-2",
        apiKeyEnvVar: "INCEPTION_API_KEY",
        temperature: 0.3,
        maxTokens: 4000,
      },
    ],
  };
};

/**
 * The model that actually serves staged manifest generation: the head of the
 * RESOLVED fallback chain — same chain definition and same resolver the
 * selector adapter runs, so this cannot drift from selection behavior.
 * Returns null when no provider resolves (no keys configured).
 *
 * Consumed by /api/manifest/capabilities so UI surfaces report the generation
 * model truthfully. Deliberately distinct from `activeModelName` (LLM_MODEL),
 * which is what the web chat/governance routes use — after the mercury flip
 * these are different models (see docs/planning/mercury-2-prod-flip-runbook.md).
 */
export const resolveActiveGenerationModel = (): string | null => {
  const resolved = resolveFallbackChain(
    getEnvironmentVault(),
    buildStagedGenerationFallbackChain(),
  );
  return resolved[0]?.model ?? null;
};

export const createLLMProviderSelector = (
  config: LLMProviderSelectorConfig,
): LLMProviderSelectorAdapter => {
  const secretVault = getEnvironmentVault();
  const fallbackChain = buildStagedGenerationFallbackChain();

  // Day-one flip verification: surface which providers actually resolved (an
  // API key is present for them) using the SAME resolver the adapter runs, so
  // the log can't drift from selection behavior. Keys themselves are never
  // logged. After the mercury flip (LLM_API_KEY unset, INCEPTION_API_KEY set)
  // this should read exactly ["inception:mercury-2"].
  //
  // Deliberately unconditional and per-request for the flip window: the three
  // constructing routes are low-traffic staged-generation endpoints that
  // already emit multiple INFO lines per multi-second request. Post-flip
  // follow-up: demote to a once-per-process guard (env is static per
  // container, so the first line is fully representative) — NOT logger.debug,
  // which is a no-op when NODE_ENV=production (structured-logger.ts).
  const resolved = resolveFallbackChain(secretVault, fallbackChain);
  logger.info("[llm] cloud fallback chain resolved", {
    providers: resolved.map((p) => `${p.providerId}:${p.model}`),
  });

  return new LLMProviderSelectorAdapter({
    webLlmAdapter: config.webLlmAdapter ?? null,
    preferLocal: config.preferLocal,
    validateLocalLLM: config.validateLocalLLM ?? false,
    fallbackChain,
    secretVault,
  });
};

/**
 * Stage-1 draft→refine cascade (fast drafting model → stronger refiner; the
 * validated pairing is mercury-2 draft → gpt-4o refine, ~+3s/run — see
 * docs/planning/mercury-2-swap-investigation.md §8).
 *
 * Activates only when STAGE1_REFINER_API_KEY is set — a DEDICATED key var so
 * the main fallback chain's ordering is untouched even when the same key
 * value also exists in LLM_API_KEY (the chain would otherwise pick the
 * generic provider over Inception). Returns null (cascade off) when unset.
 *
 * Env:
 * - STAGE1_REFINER_API_KEY  — required to activate
 * - STAGE1_REFINER_BASE_URL — default https://openrouter.ai/api/v1
 * - STAGE1_REFINER_MODEL    — default openai/gpt-4o
 * - STAGE1_REFINER_MODE     — "always" (default) | "escalation"
 */
export const createStage1RefinerConfig = (): Stage1RefinementConfig | null => {
  const vault = getEnvironmentVault();
  if (!vault.getSecret("STAGE1_REFINER_API_KEY")) return null;
  const mode =
    process.env.STAGE1_REFINER_MODE === "escalation" ? "escalation" : "always";
  const port = new LLMProviderSelectorAdapter({
    webLlmAdapter: null,
    preferLocal: false,
    validateLocalLLM: false,
    fallbackChain: {
      primary: {
        providerId: "openai" as const,
        baseUrl:
          process.env.STAGE1_REFINER_BASE_URL || "https://openrouter.ai/api/v1",
        model: process.env.STAGE1_REFINER_MODEL || "openai/gpt-4o",
        apiKeyEnvVar: "STAGE1_REFINER_API_KEY",
        temperature: 0.3,
        maxTokens: 4000,
      },
      fallbacks: [],
    },
    secretVault: vault,
  });
  return { port, mode };
};

/**
 * Stage-7 verify-and-repair reviewer (gpt-4o by default). Mirrors the Stage-1
 * refiner's gating exactly: a DEDICATED key var so the main staged-generation
 * fallback chain is untouched even if the same key value also lives in
 * LLM_API_KEY. Returns null (repair OFF) when unset — the orchestrator then
 * skips Stage 7 and the post-Stage-6 path is byte-identical to report-only.
 *
 * Activating this in prod is a Martin-gated secret change, like the Stage-1
 * refiner — see docs/planning/mercury-2-prod-flip-runbook.md.
 *
 * NOTE: despite the STAGE6_ prefix, these vars wire STAGE 7 (repair) — NOT the
 * Stage-6 review. The Stage-6 review model is STAGE6_VALIDATOR_* (below).
 *
 * Env:
 * - STAGE6_REVIEWER_API_KEY  — required to activate
 * - STAGE6_REVIEWER_BASE_URL — default https://openrouter.ai/api/v1
 * - STAGE6_REVIEWER_MODEL    — default openai/gpt-4o
 */
export const createStage6ReviewerConfig =
  (): LLMProviderSelectorAdapter | null => {
    const vault = getEnvironmentVault();
    if (!vault.getSecret("STAGE6_REVIEWER_API_KEY")) return null;
    return new LLMProviderSelectorAdapter({
      webLlmAdapter: null,
      preferLocal: false,
      validateLocalLLM: false,
      fallbackChain: {
        primary: {
          providerId: "openai" as const,
          baseUrl:
            process.env.STAGE6_REVIEWER_BASE_URL ||
            "https://openrouter.ai/api/v1",
          model: process.env.STAGE6_REVIEWER_MODEL || "openai/gpt-4o",
          apiKeyEnvVar: "STAGE6_REVIEWER_API_KEY",
          temperature: 0.2,
          maxTokens: 8000,
        },
        fallbacks: [],
      },
      secretVault: vault,
    });
  };

let warnedInvalidStage6MaxTokens = false;
/** Loud once: a SET-but-unparseable STAGE6_VALIDATOR_MAX_TOKENS silently reverts
 * to the 4000 default. Because Stage 6 sends request.maxTokens as the operative
 * ceiling, a bad value would quietly change the reviewer's budget — and a
 * reasoning reviewer truncates below ~4k — with no operator-visible signal.
 * Mirrors warnInvalidReasoningOnce (cloud-llm-reasoning.ts). The unset case is
 * intentional and stays silent. */
function warnInvalidStage6MaxTokensOnce(raw: string): void {
  if (warnedInvalidStage6MaxTokens) return;
  warnedInvalidStage6MaxTokens = true;
  // eslint-disable-next-line no-console -- operator-facing misconfiguration warning; no logger port at this layer
  console.warn(
    `STAGE6_VALIDATOR_MAX_TOKENS="${raw}" is not a positive integer — ` +
      `ignoring it (Stage-6 reviewer uses the default 4000).`,
  );
}

/**
 * Stage-6 validation reviewer — a DEDICATED model for the Stage-6 adversarial
 * review itself (and its re-validation after a Stage-7 repair), separate from
 * the main pipeline model (mercury-2) AND from the Stage-7 repair reviewer
 * above. Lets a stronger reviewer (e.g. nemotron-3-ultra) run only the review
 * without touching generation. Returns null (review stays on the main model at
 * its 800-token default) when unset — byte-identical to today. Martin-gated
 * secret change, like the Stage-1 refiner / Stage-7 reviewer.
 *
 * A reasoning reviewer needs a large budget: its reasoning tokens count against
 * the completion budget, so STAGE6_VALIDATOR_MAX_TOKENS defaults to 4000 (at 800
 * a reasoning model truncates before the NDJSON result line — measured).
 *
 * Env:
 * - STAGE6_VALIDATOR_API_KEY    — required to activate
 * - STAGE6_VALIDATOR_BASE_URL   — default https://openrouter.ai/api/v1
 * - STAGE6_VALIDATOR_MODEL      — default openai/gpt-4o
 * - STAGE6_VALIDATOR_MAX_TOKENS — default 4000
 */
export const createStage6ValidatorConfig = (): {
  port: LLMProviderSelectorAdapter;
  maxTokens: number;
} | null => {
  const vault = getEnvironmentVault();
  if (!vault.getSecret("STAGE6_VALIDATOR_API_KEY")) return null;
  const rawMaxTokens = process.env.STAGE6_VALIDATOR_MAX_TOKENS;
  const parsed = Number(rawMaxTokens);
  // Require a positive INTEGER — max_tokens is sent verbatim to the provider,
  // which 400s on a fractional value; isInteger also rejects NaN/Infinity.
  const validMaxTokens = Number.isInteger(parsed) && parsed > 0;
  // Warn only when the var is non-empty but invalid; empty/unset ⇒ silent default.
  if (!validMaxTokens && rawMaxTokens != null && rawMaxTokens.trim() !== "") {
    warnInvalidStage6MaxTokensOnce(rawMaxTokens);
  }
  const maxTokens = validMaxTokens ? parsed : 4000;
  const port = new LLMProviderSelectorAdapter({
    webLlmAdapter: null,
    preferLocal: false,
    validateLocalLLM: false,
    fallbackChain: {
      primary: {
        providerId: "openai" as const,
        baseUrl:
          process.env.STAGE6_VALIDATOR_BASE_URL ||
          "https://openrouter.ai/api/v1",
        model: process.env.STAGE6_VALIDATOR_MODEL || "openai/gpt-4o",
        apiKeyEnvVar: "STAGE6_VALIDATOR_API_KEY",
        temperature: 0.1,
        maxTokens,
      },
      fallbacks: [],
    },
    secretVault: vault,
  });
  return { port, maxTokens };
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
