/**
 * Full staged generation orchestrator (A1) — chains the LLM pipeline 0→6:
 *
 *   0 Prompt Normalization   (LLM)  userDescription → NormalizedPrompt
 *   1 Domain Extraction      (LLM)  stage0 → DomainAnalysis
 *   2 Context Classification (LLM)  stage0+stage1 → ClassificationResult
 *   3 Port Mapping           (LLM)  stage0..2 → PortMap + contextMappings
 *   4 Adapter Assignment     (LLM)  stage0,2,3 → AdapterBindings
 *   5 Manifest Assembly      (sync) stage0..4 → AssembledManifest
 *   6 Validation Review      (LLM)  stage0..3,5 → ValidationReport
 *
 * This is the free-text counterpart of ExecuteStructuredConfigGenerationUseCase
 * (the blueprint): same callback surface, same per-stage progress/error
 * protocol, same begin→speculative transaction ending. Where the blueprint
 * derives stages 0–2 deterministically from a structured config, this
 * orchestrator runs the per-stage LLM use-cases that were written for the
 * staged pipeline but never wired (normalizer-rewire dev plan, A1).
 *
 * NOT yet routed: the live /api/manifest/generate/stage route still runs the
 * inline-prompt stub (ExecuteStagedGenerationUseCase). Cutover is A3
 * (feature flag + canary); this class ships dark in A1.
 */
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
import type {
  AssembledManifest,
  PipelineState,
} from "../../../domain/value-objects/pipeline-state";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import {
  buildGreenfieldArchitectureContext,
  type ArchitectureContext,
} from "../../../domain/prompts/build-architecture-context";
import { countManifestEntities } from "../../../domain/manifest/count-manifest-entities";
import { dedupeAdapterNames } from "../../../domain/manifest/dedupe-adapter-names";
import { ExecutePromptNormalizationUseCase } from "./execute-prompt-normalization.use-case";
import { ExecuteDomainExtractionUseCase } from "./execute-domain-extraction.use-case";
import type { Stage1RefinementConfig } from "./execute-domain-extraction.use-case";
import { ExecuteContextClassificationUseCase } from "./execute-context-classification.use-case";
import { ExecutePortMappingUseCase } from "./execute-port-mapping.use-case";
import { ExecuteAdapterAssignmentUseCase } from "./execute-adapter-assignment.use-case";
import { ExecuteManifestAssemblyUseCase } from "./execute-manifest-assembly.use-case";
import {
  ExecuteValidationReviewUseCase,
  type Stage6ReviewerConfig,
} from "./execute-validation-review.use-case";
import { STAGE3_ESCALATION_CONFIG } from "./retry-with-escalation";

/** Same shape as StructuredConfigGenerationCallbacks — kept as its own
 * interface so the two orchestrators can evolve independently. */
export interface FullStagedGenerationCallbacks {
  onProgress?: (stage: number, durationMs: number) => void;
  onError?: (stage: number, error: string, durationMs?: number) => void;
  onChunk?: (chunk: string) => void;
  /** Called at completion of each stage with full telemetry. */
  onStageTelemetry?: (telemetry: StageTelemetry) => void;
}

export interface FullStagedGenerationOptions {
  /** Overrides the Stage 3 escalation model (see STAGE3_ESCALATION_CONFIG). */
  escalationModel?: string;
  /** Overrides the `<architecture>` block injected into the Stage 0 prompt.
   * Defaults to the greenfield static contract (T2b).
   *
   * SECURITY: this is injected into the prompt UNESCAPED (it is trusted
   * static configuration, set once at construction). Never thread user
   * input or other untrusted data through this option — user text belongs
   * in `userDescription`, which goes through the XML-wrapping injection
   * protections in generate-manifest.prompt.ts. */
  architectureContext?: ArchitectureContext;
  /** Stage-1 draft→refine cascade (e.g. mercury draft → gpt-4o refine).
   * Off when omitted — zero behavior change. */
  stage1Refinement?: Stage1RefinementConfig;
  /** Dedicated Stage-6 validation reviewer — a separate model + token budget
   * from the main pipeline LLM (e.g. nemotron-3-ultra via OpenRouter). Off when
   * omitted ⇒ Stage 6 runs on the main pipeline model at 800, unchanged. */
  stage6Reviewer?: Stage6ReviewerConfig;
}

export class ExecuteFullStagedGenerationUseCase {
  private readonly stage0: ExecutePromptNormalizationUseCase;
  private readonly stage1: ExecuteDomainExtractionUseCase;
  private readonly stage2: ExecuteContextClassificationUseCase;
  private readonly stage3: ExecutePortMappingUseCase;
  private readonly stage4: ExecuteAdapterAssignmentUseCase;
  private readonly stage5: ExecuteManifestAssemblyUseCase;
  private readonly stage6: ExecuteValidationReviewUseCase;

  constructor(
    llmPort: SendStructuredRequestPort,
    private readonly transactionManager: TransactionManagerPort,
    options?: FullStagedGenerationOptions,
  ) {
    // T2b: the architecture context is built ONCE here (it is pure/static),
    // then constructor-injected into Stage 0 — never rebuilt per execute().
    const architectureContext =
      options?.architectureContext ?? buildGreenfieldArchitectureContext();
    this.stage0 = new ExecutePromptNormalizationUseCase(
      llmPort,
      architectureContext,
    );
    this.stage1 = new ExecuteDomainExtractionUseCase(
      llmPort,
      options?.stage1Refinement,
    );
    this.stage2 = new ExecuteContextClassificationUseCase(llmPort);
    const stage3Config = options?.escalationModel
      ? {
          ...STAGE3_ESCALATION_CONFIG,
          escalationModel: options.escalationModel,
        }
      : STAGE3_ESCALATION_CONFIG;
    this.stage3 = new ExecutePortMappingUseCase(llmPort, stage3Config);
    this.stage4 = new ExecuteAdapterAssignmentUseCase(llmPort);
    this.stage5 = new ExecuteManifestAssemblyUseCase();
    this.stage6 = options?.stage6Reviewer
      ? new ExecuteValidationReviewUseCase(
          options.stage6Reviewer.port,
          options.stage6Reviewer.maxTokens,
        )
      : new ExecuteValidationReviewUseCase(llmPort);
  }

  async execute(
    userDescription: string,
    variables?: PromptVariables,
    callbacks?: FullStagedGenerationCallbacks,
  ): Promise<
    | {
        success: true;
        value: AssembledManifest;
        state: PipelineState;
        transactionId: string;
      }
    | { success: false; error: unknown }
  > {
    // Stage 0: Prompt Normalization
    const s0Start = Date.now();
    callbacks?.onProgress?.(0, 0);
    callbacks?.onChunk?.("Stage 0 · Prompt Normalization");
    const s0 = await this.stage0.execute(
      userDescription,
      variables,
      callbacks?.onChunk,
      callbacks?.onStageTelemetry,
    );
    const s0Duration = Date.now() - s0Start;
    if (!s0.success) {
      callbacks?.onError?.(0, String(s0.error), s0Duration);
      return { success: false, error: s0.error };
    }
    callbacks?.onProgress?.(0, s0Duration);

    // Stage 1: Domain Extraction
    const s1Start = Date.now();
    callbacks?.onProgress?.(1, 0);
    callbacks?.onChunk?.("Stage 1 · Domain Extraction");
    const s1 = await this.stage1.execute(
      { stage0: s0.value },
      callbacks?.onChunk,
      callbacks?.onStageTelemetry,
    );
    const s1Duration = Date.now() - s1Start;
    if (!s1.success) {
      callbacks?.onError?.(1, String(s1.error), s1Duration);
      return { success: false, error: s1.error };
    }
    callbacks?.onProgress?.(1, s1Duration);

    // Stage 2: Context Classification
    const s2Start = Date.now();
    callbacks?.onProgress?.(2, 0);
    callbacks?.onChunk?.("Stage 2 · Context Classification");
    const s2 = await this.stage2.execute(
      { stage0: s0.value, stage1: s1.value },
      callbacks?.onChunk,
      callbacks?.onStageTelemetry,
    );
    const s2Duration = Date.now() - s2Start;
    if (!s2.success) {
      callbacks?.onError?.(2, String(s2.error), s2Duration);
      return { success: false, error: s2.error };
    }
    // Empty-accepted guard: stage 3 tolerates zero accepted contexts (it
    // early-returns an empty port map), but stage 4 would still burn a real
    // LLM call on a degenerate prompt and the run would end as an empty
    // speculative transaction (contextCount: 0). The blueprint can't hit this
    // (its config validation requires contexts); this orchestrator is the
    // first place empty-accepted meets stages 3–6, so fail here, attributed
    // to the stage where the emptiness arose.
    if (s2.value.accepted.length === 0) {
      callbacks?.onError?.(
        2,
        "Stage 2 accepted no bounded contexts",
        s2Duration,
      );
      return {
        success: false,
        error: new Error("No accepted bounded contexts — nothing to assemble"),
      };
    }
    callbacks?.onProgress?.(2, s2Duration);

    // Stage 3: Port Mapping
    const s3Start = Date.now();
    callbacks?.onProgress?.(3, 0);
    callbacks?.onChunk?.("Stage 3 · Port Mapping");
    const s3 = await this.stage3.execute(
      { stage0: s0.value, stage1: s1.value, stage2: s2.value },
      callbacks?.onChunk,
      callbacks?.onStageTelemetry,
    );
    const s3Duration = Date.now() - s3Start;
    if (!s3.success) {
      callbacks?.onError?.(3, String(s3.error), s3Duration);
      return { success: false, error: s3.error };
    }
    const portMap = s3.value.portMap;
    const contextMappings = s3.value.contextMappings ?? [];
    callbacks?.onProgress?.(3, s3Duration);

    // Stage 4: Adapter Assignment
    const s4Start = Date.now();
    callbacks?.onProgress?.(4, 0);
    callbacks?.onChunk?.("Stage 4 · Adapter Assignment");
    const s4 = await this.stage4.execute(
      {
        stage0: s0.value,
        stage2: s2.value,
        stage3: portMap,
        contextMappings,
      },
      variables ?? { userDescription },
      callbacks?.onChunk,
      callbacks?.onStageTelemetry,
    );
    const s4Duration = Date.now() - s4Start;
    if (!s4.success) {
      callbacks?.onError?.(4, String(s4.error), s4Duration);
      return { success: false, error: s4.error };
    }
    callbacks?.onProgress?.(4, s4Duration);

    // R12: make adapter names globally unique before assembly (Stage 4 can give
    // the same generic name to multiple contexts that share a technology). Only
    // `.name` changes — `implements` is untouched, so the bindings still ground
    // R04/R05/R06. Mirrors the structured-config orchestrator. (The R03
    // repository-port synthesis net is the separate /stage fast-follow.)
    const adapterDedup = dedupeAdapterNames(s4.value);
    const dedupedAdapters = adapterDedup.adapterBindings;
    const adapterRenameWarnings = adapterDedup.renamed.map(
      (r) =>
        `Renamed adapter '${r.from}' in context '${r.contextName}' to '${r.to}' to keep adapter names globally unique (R12).`,
    );
    for (const warning of adapterRenameWarnings) {
      callbacks?.onChunk?.(`Stage 5 · ${warning}`);
    }

    // Stage 5: Manifest Assembly (synchronous, returns AssembledManifest directly)
    const s5Start = Date.now();
    callbacks?.onProgress?.(5, 0);
    callbacks?.onChunk?.("Stage 5 · Manifest Assembly");
    const assembledManifest = this.stage5.execute({
      stage0: s0.value,
      stage1: s1.value,
      stage2: s2.value,
      stage3: portMap,
      stage4: dedupedAdapters,
      contextMappings,
    });
    callbacks?.onProgress?.(5, Date.now() - s5Start);

    // Schema-gate outcomes (enforce-manifest-schema.ts): drops/coercions are
    // Stage-5 adjustment chunks; a residual issue means the accept screen's
    // strict ManifestSchema parse would reject the manifest, so it's surfaced
    // and merged into the report as an error below — never swallowed.
    for (const advisory of assembledManifest.schemaAdvisories ?? []) {
      callbacks?.onChunk?.(`Stage 5 · ${advisory}`);
    }
    const schemaIssueErrors = (assembledManifest.schemaIssues ?? []).map(
      (issue) => `Manifest schema violation: ${issue}`,
    );
    if (schemaIssueErrors.length > 0) {
      callbacks?.onChunk?.(
        `Stage 5 · ⚠ Manifest failed schema validation after sanitization: ${(assembledManifest.schemaIssues ?? []).join("; ")}`,
      );
    }

    // Stage 6: Validation Review
    const s6Start = Date.now();
    callbacks?.onProgress?.(6, 0);
    callbacks?.onChunk?.("Stage 6 · Validation Review");
    const s6 = await this.stage6.execute(
      {
        stage0: s0.value,
        stage1: s1.value,
        stage2: s2.value,
        stage3: portMap,
        stage4: dedupedAdapters,
        stage5: assembledManifest,
        contextMappings,
      },
      callbacks?.onChunk,
      callbacks?.onStageTelemetry,
    );
    const s6Duration = Date.now() - s6Start;
    if (!s6.success) {
      callbacks?.onError?.(6, String(s6.error), s6Duration);
      return { success: false, error: s6.error };
    }
    callbacks?.onProgress?.(6, s6Duration);

    const state: PipelineState = {
      stage0: s0.value,
      stage1: s1.value,
      stage2: s2.value,
      stage3: portMap,
      stage4: dedupedAdapters,
      stage5: assembledManifest,
      stage6: (() => {
        const extraWarnings = [
          ...adapterRenameWarnings,
          ...(assembledManifest.schemaAdvisories ?? []),
        ];
        if (extraWarnings.length === 0 && schemaIssueErrors.length === 0) {
          return s6.value;
        }
        return {
          ...s6.value,
          warnings: [...s6.value.warnings, ...extraWarnings],
          errors: [...s6.value.errors, ...schemaIssueErrors],
          passed: s6.value.passed && schemaIssueErrors.length === 0,
        };
      })(),
      contextMappings,
    };

    // Create transaction for the generated manifest — same begin→speculative
    // protocol (and metadata shape) as the structured-config orchestrator.
    // Deliberately not extracted into a shared helper in this PR: A1 must not
    // touch the live blueprint file (one concern per PR).
    // Transaction failures below return {success:false} WITHOUT firing
    // onError (matches the blueprint): onError's stage param is 0–6 and no
    // route consumer exists yet to define a post-pipeline stage index.
    // Revisit with the A4 helper extraction once A3 wires the route.
    const intentId = `desc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const yaml = assembledManifest.yaml || "";
    const parsed =
      (assembledManifest.parsedObject as Record<string, unknown>) || {};
    // Ports/adapters are nested under layers.application.ports /
    // layers.infrastructure.adapters; countManifestEntities reads that path —
    // the shared counter, so this and the structured-config pipeline can't drift
    // (see its doc for the always-0 context-root-read trap).
    const { contextCount, portCount, adapterCount } =
      countManifestEntities(parsed);

    let transaction: Awaited<ReturnType<TransactionManagerPort["begin"]>>;
    try {
      transaction = await this.transactionManager.begin(intentId, {
        intentId,
        origin: "full-staged-generation",
        yaml,
        contextCount,
        portCount,
        adapterCount,
      });
    } catch (beginError) {
      return { success: false, error: beginError };
    }

    try {
      // The port contract signals failure by returning null (not only by
      // throwing) — treat both as a failed transition.
      const transitioned = await this.transactionManager.transition(
        transaction.id,
        "speculative",
      );
      if (transitioned == null) {
        await this.transactionManager.rollback(
          transaction.id,
          "transition to speculative returned null",
        );
        return {
          success: false,
          error: new Error(
            `Transaction ${transaction.id} could not transition to "speculative"`,
          ),
        };
      }
    } catch (transitionError) {
      await this.transactionManager.rollback(transaction.id);
      return { success: false, error: transitionError };
    }

    return {
      success: true,
      value: assembledManifest,
      state,
      transactionId: transaction.id,
    };
  }
}
