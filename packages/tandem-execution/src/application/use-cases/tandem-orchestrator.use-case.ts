import type { Result } from "@hexagen/shared";
import { ok, err } from "@hexagen/shared";
import type { EventBusPort } from "@hexagen/messaging";
import type {
  OrchestratorParams,
  OrchestratorResult,
  TandemOrchestratorPort,
} from "../ports/tandem-orchestrator.port.js";
import type { PreFlightValidatorPort } from "../ports/pre-flight-validator.port.js";
import type { TandemConfig } from "../../domain/index.js";
import { TANDEM_EVENT_TYPES, createTandemEvent } from "../../domain/index.js";
import type { Stage1LocalSpeculationUseCase } from "./stage1-local-speculation.use-case.js";
import type { Stage2PayloadConstructorUseCase } from "./stage2-payload-constructor.use-case.js";
import type { Stage3CloudDispatchUseCase } from "./stage3-cloud-dispatch.use-case.js";

// ---------------------------------------------------------------------------
// Extended OrchestratorParams with isStreamingRef
// ---------------------------------------------------------------------------

export interface TandemOrchestratorParams extends OrchestratorParams {
  /**
   * ADR-0016 streaming guard ref.
   * If provided, the orchestrator sets `isStreamingRef.current = true` at the
   * start of `executePipeline` and releases it in the `finally` block across
   * ALL exit paths (success, error, cancellation, terminal failure).
   * If not provided, the orchestrator manages an internal ref.
   */
  isStreamingRef?: { current: boolean };
  localModelState:
    | "NOT_DOWNLOADED"
    | "DOWNLOADING"
    | "DOWNLOADED"
    | "LOADING"
    | "ACTIVE"
    | "ERROR";
  cloudHealthState: "VALID" | "DEGRADED" | "UNAVAILABLE" | "UNVALIDATED";
  cloudContextLimit?: number;
  memoryThresholdGb?: number;
  byokCiphertext?: string;
  byokProvider?: string;
  onToken?: (chunk: string) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// TandemOrchestratorUseCase
// ---------------------------------------------------------------------------

/**
 * TandemOrchestratorUseCase
 *
 * Orchestrates the full tandem pipeline:
 *   Stage 0 — Pre-flight validation
 *   Stage 1 — Local speculation (fast draft)
 *   Stage 2 — Payload construction
 *   Stage 3 — Cloud dispatch (refinement)
 *   Stage 4 — Final output assembly
 *
 * ADR-0016 streaming guard: `isStreamingRef.current` is set to `true` at the
 * start of `executePipeline` and released in the `finally` block across ALL
 * exit paths (success, error, cancellation, terminal failure).
 *
 * ADR-0030: Stage 3 ALWAYS routes through `/api/llm/chat` — never directly
 * to a provider endpoint.
 */
export class TandemOrchestratorUseCase implements TandemOrchestratorPort {
  constructor(
    private readonly preFlightValidator: PreFlightValidatorPort,
    private readonly stage1: Stage1LocalSpeculationUseCase,
    private readonly stage2: Stage2PayloadConstructorUseCase,
    private readonly stage3: Stage3CloudDispatchUseCase,
    private readonly eventBus: EventBusPort,
    private readonly config: TandemConfig,
  ) {}

  async executePipeline(
    params: OrchestratorParams,
  ): Promise<Result<OrchestratorResult, Error>> {
    // Cast to extended params — callers using the full orchestrator should
    // pass TandemOrchestratorParams; the base port signature is preserved for
    // interface compliance.
    const extParams = params as TandemOrchestratorParams;

    // ADR-0016: Acquire isStreamingRef
    const isStreamingRef: { current: boolean } = extParams.isStreamingRef ?? {
      current: false,
    };
    isStreamingRef.current = true;

    try {
      return await this._runPipeline(extParams, isStreamingRef);
    } finally {
      // Release in ALL exit paths
      isStreamingRef.current = false;
    }
  }

  private async _runPipeline(
    params: TandemOrchestratorParams,
    _isStreamingRef: { current: boolean },
  ): Promise<Result<OrchestratorResult, Error>> {
    const {
      prompt,
      conversationId,
      history,
      deviceMemoryGb,
      localModelState,
      cloudHealthState,
      cloudContextLimit,
      byokCiphertext,
      byokProvider,
      onToken,
      signal,
    } = params;

    const memoryThresholdGb =
      params.memoryThresholdGb ?? this.config.memoryHeadroomMB / 1024;

    // -----------------------------------------------------------------------
    // Stage 0 — Pre-flight validation
    // -----------------------------------------------------------------------
    this.eventBus.publish(
      createTandemEvent(TANDEM_EVENT_TYPES.PRE_FLIGHT_STARTED, {
        prompt,
        conversationId,
      }),
    );

    const preFlightResult = this.preFlightValidator.validate(
      localModelState,
      cloudHealthState,
      {
        prompt,
        deviceMemoryGb,
        memoryThresholdGb,
        cloudContextLimit,
      },
    );

    if (!preFlightResult.success) {
      return err(new Error("Pre-flight validation failed"));
    }

    const validation = preFlightResult.value;

    // TERMINAL_FAILURE
    if (!validation.success) {
      return err(new Error("Both engines unavailable"));
    }

    // Determine outcome — both flags are set by PreFlightValidatorUseCase
    const isBypassLocal = validation.bypassLocal;
    const isBypassCloud = validation.bypassCloud ?? false;

    // -----------------------------------------------------------------------
    // BYPASS_LOCAL path — skip Stage 1 & 2, go directly to Stage 3
    // -----------------------------------------------------------------------
    if (isBypassLocal) {
      const stage3Result = await this.stage3.execute({
        payload: prompt,
        conversationId,
        refinementEngine: this.config.refinementEngine,
        byokCiphertext,
        byokProvider,
        onToken,
        signal,
        autoRetryEnabled: this.config.autoRetryEnabled,
      });

      if (
        stage3Result.errorType &&
        stage3Result.errorType !== "partial_stream"
      ) {
        return err(new Error(`Stage 3 failed: ${stage3Result.errorType}`));
      }

      this.eventBus.publish(
        createTandemEvent(TANDEM_EVENT_TYPES.FINAL_OUTPUT_COMPLETED, {
          conversationId,
          finalContent: stage3Result.content,
        }),
      );

      return ok({
        finalContent: stage3Result.content,
        bypassReason: validation.bypassReason ?? "none",
      }) as Result<OrchestratorResult, Error>;
    }

    // -----------------------------------------------------------------------
    // BYPASS_CLOUD path — skip Stage 2 & 3, return Stage 1 output
    // -----------------------------------------------------------------------
    if (isBypassCloud) {
      const stage1Result = await this.stage1.execute({
        prompt,
        conversationId,
        modelId: this.config.localModelId as Parameters<
          typeof this.stage1.execute
        >[0]["modelId"],
        timeoutSeconds: this.config.stageOneTimeoutSeconds,
        onToken,
        signal,
      });

      if (!stage1Result.qualityGatePassed) {
        return err(
          new Error(
            `Stage 1 quality gate failed: ${stage1Result.skipReason ?? "unknown"}`,
          ),
        );
      }

      this.eventBus.publish(
        createTandemEvent(TANDEM_EVENT_TYPES.FINAL_OUTPUT_COMPLETED, {
          conversationId,
          finalContent: stage1Result.draft,
          stage1Draft: stage1Result.draft,
        }),
      );

      return ok({
        finalContent: stage1Result.draft,
        stage1Draft: stage1Result.draft,
        bypassReason: "cloud_unavailable",
      }) as Result<OrchestratorResult, Error>;
    }

    // -----------------------------------------------------------------------
    // PROCEED_TANDEM — full pipeline
    // -----------------------------------------------------------------------

    // Stage 1
    const stage1Result = await this.stage1.execute({
      prompt,
      conversationId,
      modelId: this.config.localModelId as Parameters<
        typeof this.stage1.execute
      >[0]["modelId"],
      timeoutSeconds: this.config.stageOneTimeoutSeconds,
      onToken,
      signal,
    });

    // If quality gate failed, skip Stage 2 and go to Stage 3 with original prompt
    const stage2Input = stage1Result.qualityGatePassed
      ? stage1Result.draft
      : null;

    let stage3Payload: string;
    let truncatedDraft = false;
    let truncatedHistory = false;

    if (stage2Input !== null) {
      // Stage 2 — payload construction
      this.eventBus.publish(
        createTandemEvent(TANDEM_EVENT_TYPES.PAYLOAD_CONSTRUCTION_STARTED, {
          conversationId,
        }),
      );

      const stage2Result = this.stage2.constructPayload({
        userPrompt: prompt,
        localDraft: stage2Input,
        history,
        cloudContextLimit: cloudContextLimit ?? 4096,
      });

      if (!stage2Result.success) {
        return err(stage2Result.error);
      }

      stage3Payload = stage2Result.value.payload;
      truncatedDraft = stage2Result.value.truncatedDraft;
      truncatedHistory = stage2Result.value.truncatedHistory;

      this.eventBus.publish(
        createTandemEvent(TANDEM_EVENT_TYPES.PAYLOAD_CONSTRUCTION_COMPLETED, {
          conversationId,
          payloadLength: stage3Payload.length,
          truncatedDraft,
          truncatedHistory,
        }),
      );
    } else {
      // Quality gate failed — use original prompt for Stage 3
      stage3Payload = prompt;
    }

    // Stage 3 — cloud dispatch
    const stage3Result = await this.stage3.execute({
      payload: stage3Payload,
      conversationId,
      refinementEngine: this.config.refinementEngine,
      byokCiphertext,
      byokProvider,
      onToken,
      signal,
      autoRetryEnabled: this.config.autoRetryEnabled,
    });

    if (
      stage3Result.errorType &&
      stage3Result.errorType !== "partial_stream" &&
      stage3Result.errorType !== "cancelled"
    ) {
      return err(new Error(`Stage 3 failed: ${stage3Result.errorType}`));
    }

    // Stage 4 — assemble final output
    const finalContent = stage3Result.content;

    this.eventBus.publish(
      createTandemEvent(TANDEM_EVENT_TYPES.FINAL_OUTPUT_COMPLETED, {
        conversationId,
        finalContent,
        stage1Draft: stage1Result.draft || undefined,
      }),
    );

    return ok({
      finalContent,
      stage1Draft: stage1Result.draft || undefined,
      tokenMetadata: {
        stage1CompletionTokens: stage1Result.tokenCount,
      },
    }) as Result<OrchestratorResult, Error>;
  }
}
