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
  resolveFallbackChain,
  EnvironmentSecretVaultAdapter,
  StaticProviderCatalogAdapter,
} from "@hexagen/agentic-interaction";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
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
  ProviderCatalogPort,
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
  ServerMergedManifestProviderAdapter,
} from "./adapters/wire-adapters";
import { CliManifestLintAdapter } from "./governance/adapters/cli-manifest-lint.adapter";
import { LlmSuggestionAdapter } from "./governance/adapters/llm-suggestion.adapter";
import type { ManifestLintPort, SuggestionPort } from "./governance/ports";
import { logger } from "../../lib/structured-logger";

// The manifest-path anchor lives in its own module so the read-only display
// providers in ./adapters/wire-adapters can share it without importing this
// composition root back (which would be a require cycle). Re-exported here so
// existing `@/lib/wire.server` consumers (the modify-family routes) keep working.
import { findMonorepoRoot, MonorepoRootNotFoundError } from "./monorepo-root";
export { findMonorepoRoot, MonorepoRootNotFoundError };

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

/**
 * Transaction manager for ONE manifest-generation request (HEX-003).
 *
 * Deliberately NOT `getTransactionManager()` above. That one is a
 * process-wide singleton because the modify-architecture flow spans three
 * requests — `POST /api/architecture/modify` begins a speculative transaction
 * and a later `accept`/`reject` commits or rolls it back, so the transaction
 * has to outlive the request that created it.
 *
 * Staged generation has no such second leg: the orchestrator begins a
 * transaction and transitions it, nothing ever commits it, and the id it
 * reports on the wire is not consumed by any accept/reject path. Parking those
 * transactions in the shared singleton would grow an unbounded map for the
 * lifetime of the server. A per-request manager keeps the existing lifetime
 * (garbage once the response ends) while moving the `new` out of the routes.
 */
export const createGenerationTransactionManager = (): TransactionManagerPort =>
  new InMemoryTransactionManager();

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
// Governance API Wiring (HEX-016)
// ============================================================================
//
// Server composition root for the governance API family (HEX-016).
// `SuggestionPort` is used by `POST /api/governance/suggestions`.
// `ManifestLintPort` is still constructed here; no route currently calls it
// after `POST /api/governance/refresh` was retired as unused transport.

let _manifestLint: ManifestLintPort | null = null;

/**
 * A `ManifestLintPort` for a host where the linter can never run, because the
 * monorepo root — and with it `.architecture/manifest.yaml` and the root
 * `lint:arch` script — was not found on disk.
 *
 * Callers evaluate `getManifestLint()` before any handler `try`, so a throw
 * from `findMonorepoRoot()` would become a framework 500 instead of the
 * `unavailable` outcome the port exists to populate. The standalone image
 * makes this reachable: `apps/web/Dockerfile`'s runtime stage copies only
 * `.next/standalone` and `.next/static`, so no `.architecture/` marker is
 * present to walk up to.
 *
 * The reason carried to the client is the error's path-free `clientMessage`;
 * the detailed message embeds an absolute server path and is logged only.
 */
function unavailableManifestLint(error: unknown): ManifestLintPort {
  const reason =
    error instanceof MonorepoRootNotFoundError
      ? MonorepoRootNotFoundError.clientMessage
      : "Monorepo root could not be resolved";
  logger.error("[governance] manifest lint adapter unavailable", {
    error: error instanceof Error ? error.message : String(error),
  });
  return { lintManifest: async () => ({ kind: "unavailable", reason }) };
}

/** Candidate-manifest linting for the governance routes. Anchored on the
 * monorepo root, not process.cwd() — see the adapter's class doc (AUD-002).
 *
 * Total by construction: it returns a port on every path. Only a successfully
 * constructed adapter is memoized, so a host that is repaired (or a test that
 * runs before its fixture root exists) recovers on the next request instead of
 * being pinned to the degraded port for the process's lifetime. */
export const getManifestLint = (): ManifestLintPort => {
  if (!_manifestLint) {
    try {
      _manifestLint = CliManifestLintAdapter.fromMonorepoRoot();
    } catch (error) {
      return unavailableManifestLint(error);
    }
  }
  return _manifestLint;
};

let _governanceSuggestions: SuggestionPort | null = null;

/** The one suggestion implementation for `POST /api/governance/suggestions`. */
export const getGovernanceSuggestions = (): SuggestionPort => {
  if (!_governanceSuggestions) {
    _governanceSuggestions = new LlmSuggestionAdapter();
  }
  return _governanceSuggestions;
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

/**
 * Browser-side WebLLM provider, loaded lazily (HEX-003).
 *
 * `/api/manifest/generate/local` used to `await import("@hexagen/local-llm")`
 * and `new` this adapter inside the request handler. The import is kept dynamic
 * so the WebLLM bundle stays out of every other server path's module graph, and
 * the failure posture is unchanged: a load/construct error yields `null` and
 * the selector falls back to the cloud chain rather than failing the request.
 *
 * A returned adapter is per-call, not memoized: it carries a `defaultModelId`
 * chosen by the caller, and callers ask for different models.
 */
export const createWebLLMAdapter = async (
  defaultModelId?: string,
): Promise<(LocalLLMProviderPort & SendStructuredRequestPort) | null> => {
  try {
    const { WebLLMAdapter, isDomainModelId } =
      await import("@hexagen/local-llm");
    return new WebLLMAdapter({
      // The id arrives from an HTTP body, so this is the boundary conversion.
      // `DomainModelId` is a runtime string ENUM, not a string-literal union, so
      // a cast checked nothing: the route's inline version stored any non-empty
      // string and `initialize()` then failed with `Unknown model ID: ...`
      // instead of applying the adapter's own default. `isDomainModelId` is the
      // package's own guard, taken off the SAME dynamic import — a static value
      // import of it would pull the WebLLM bundle into every server path's
      // module graph and defeat the lazy load this factory exists to preserve.
      defaultModelId: isDomainModelId(defaultModelId)
        ? defaultModelId
        : undefined,
    });
  } catch (error) {
    logger.warn("WebLLM adapter initialization failed:", { error });
    return null;
  }
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

let _mergedManifestProvider: ServerMergedManifestProviderAdapter | null = null;

/**
 * Composition-root accessor for the merged-manifest read (HEX-034). The
 * adapter is stateless, so one instance serves every request.
 *
 * Exported — unlike the two private provider accessors around it — because its
 * consumer is an HTTP route (`/api/llm/context`) rather than a use case this
 * module assembles.
 */
export const getMergedManifestProvider =
  (): ServerMergedManifestProviderAdapter => {
    if (!_mergedManifestProvider) {
      _mergedManifestProvider = new ServerMergedManifestProviderAdapter();
    }
    return _mergedManifestProvider;
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
  /**
   * Source of the default chain when `fallbackChain` is absent. Defaults to
   * the composition root's catalog adapter; overridable so tests can prove
   * the default path actually reads the port rather than a literal.
   */
  providerCatalog?: ProviderCatalogPort;
}

/**
 * The injected provider catalog (ADR-0051, Decision 1) — vendor baseUrls,
 * model ids and the API-key env-var name for the **default** cloud chain.
 *
 * Not to be confused with `buildStagedGenerationFallbackChain` above, which
 * stays in this composition root by design (Decision 3): that one reads
 * `process.env` at wiring time and serves staged generation on `gpt-4o`. This
 * one is env-independent and serves the modify pipeline's default on
 * `gpt-4o-mini`. The two are deliberately different chains.
 */
let _providerCatalog: ProviderCatalogPort | null = null;

const getProviderCatalog = (): ProviderCatalogPort => {
  if (!_providerCatalog) {
    _providerCatalog = new StaticProviderCatalogAdapter();
  }
  return _providerCatalog;
};

/**
 * Builds the structured-request sender for a pipeline mode.
 *
 * Exported (rather than module-private) so the cloud **default** path — the
 * `cloudConfig?.fallbackChain ?? …` arm, reached whenever a caller passes no
 * explicit chain — can be pinned behaviourally by a test. That arm is the one
 * ADR-0051 §Decision 4 requires to stay covered.
 */
export function createLLMSender(
  mode: PipelineMode,
  cloudConfig?: CloudPipelineConfig,
): SendStructuredRequestPort {
  if (mode === "cloud") {
    const fallbackChain =
      cloudConfig?.fallbackChain ??
      (
        cloudConfig?.providerCatalog ?? getProviderCatalog()
      ).createDefaultChain();
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
 * - Cached when: mode matches cached mode AND no callbacks AND no signal provided (singleton pattern)
 * - New instance when: mode differs OR a signal or callbacks are provided (fresh per-request for SSE)
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

  const useCase = new ModifyArchitectureUseCase(deps);
  if (!callbacks && !signal) {
    cachedUseCase = useCase;
    cachedMode = mode;
  }
  return useCase;
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
