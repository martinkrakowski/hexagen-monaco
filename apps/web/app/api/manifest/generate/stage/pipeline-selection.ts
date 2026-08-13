import type {
  AssembledManifest,
  FullStagedGenerationCallbacks,
  PipelineState,
  StageTelemetry,
} from "@hexagen/agentic-interaction";
import { countManifestEntities } from "@hexagen/agentic-interaction";

/**
 * NDJSON event vocabulary for the stage route + the adapter that lets
 * `ExecuteFullStagedGenerationUseCase` speak it. A4 removed the stub and the
 * `selectPipeline` (STAGED_GENERATION_PIPELINE / FULL_PERCENT) cutover seam —
 * the full 0→6 pipeline is the only pipeline now.
 */

/** Stage labels for the full pipeline — must match the client hook's
 * `STAGE_LABELS` in `useStagedManifestGeneration.ts` (the client was built
 * for this 7-stage vocabulary). */
export const STAGE_LABELS: Record<number, string> = {
  0: "Prompt Normalization",
  1: "Domain Extraction",
  2: "Context Classification",
  3: "Port Mapping",
  4: "Adapter Assignment",
  5: "Manifest Assembly",
  6: "Validation Review",
};

/** The stage route's NDJSON event vocabulary. */
export type StageRouteEvent =
  | { type: "stage-start"; stage: number; label: string }
  | { type: "stage-complete"; stage: number; label: string; durationMs: number }
  | {
      type: "stage-telemetry";
      stage: number;
      telemetry: Record<string, unknown>;
    }
  | { type: "chunk"; stage: number; data: string }
  | { type: "validation-error"; stage: number; errors: string[] }
  // Early manifest (Part B-lite): emitted once, right after Stage-5 assembly,
  // while the Stage-6 review is still running. NON-terminal — `done` always
  // follows and its yaml supersedes this one. transactionId is "" here: the
  // transaction is only begun AFTER the review, so no id exists yet; the real
  // id arrives on `done`.
  | {
      type: "manifest";
      yaml: string;
      contextCount: number;
      portCount: number;
      adapterCount: number;
      transactionId: string;
    }
  | {
      type: "done";
      yaml: string;
      contextCount: number;
      portCount: number;
      adapterCount: number;
      transactionId: string;
      /**
       * Stage-6 review findings on the (successfully produced) manifest —
       * advisory, mirrors the /spec route's done event so both flows surface
       * the same report shape. OPTIONAL and ADDITIVE: older payloads without
       * it remain valid, and consumers must treat its absence as "no report"
       * — this is a backward-compatible extension of the NDJSON contract,
       * not a breaking change.
       */
      validation?: { errors: string[]; warnings: string[]; passed: boolean };
    }
  | { type: "error"; message: string };

/**
 * Builds the terminal `done` event from a successful pipeline run. Extracted
 * from the route handler so the counts + Stage-6 `validation` projection are
 * unit-testable without standing up the streaming/quota/rate-limit stack.
 *
 * `validation` is picked field-by-field (not passed by reference) so the wire
 * shape stays exactly `{errors, warnings, passed}` even if `ValidationReport`
 * grows server-only fields later. Omitted when the pipeline produced no
 * Stage-6 report (the field is optional/additive — see the type above).
 */
export function buildDoneEvent(
  state: PipelineState,
  transactionId: string,
): StageRouteEvent {
  const yaml = state.stage5?.yaml || "";
  const contextCount = state.stage2?.accepted.length ?? 0;
  const portCount =
    state.stage3?.contexts.reduce(
      (sum, c) => sum + c.in.length + c.out.length,
      0,
    ) ?? 0;
  const adapterCount =
    state.stage4?.contexts.reduce((sum, c) => sum + c.adapters.length, 0) ?? 0;

  return {
    type: "done",
    yaml,
    contextCount,
    portCount,
    adapterCount,
    transactionId,
    ...(state.stage6
      ? {
          validation: {
            errors: state.stage6.errors,
            warnings: state.stage6.warnings,
            passed: state.stage6.passed,
          },
        }
      : {}),
  };
}

/**
 * Builds the NON-terminal early `manifest` event (Part B-lite) from the
 * Stage-5 assembled manifest. Counts come from `countManifestEntities` — the
 * same shared counter the orchestrator records in transaction metadata, so
 * the frame and the transaction can't disagree. `transactionId` is "" by
 * design: at Stage-5 time no transaction exists yet (it is begun only after
 * the Stage-6 review); the real id arrives on `done`, and the client does not
 * consume transactionId from this frame.
 */
export function buildManifestEvent(
  manifest: AssembledManifest,
): StageRouteEvent {
  const { contextCount, portCount, adapterCount } = countManifestEntities(
    manifest.parsedObject,
  );
  return {
    type: "manifest",
    yaml: manifest.yaml || "",
    contextCount,
    portCount,
    adapterCount,
    transactionId: "",
  };
}

/**
 * Adapts `FullStagedGenerationCallbacks` to the route's NDJSON events.
 *
 * The orchestrator emits, per successful stage:
 *   `onProgress(stage, 0)` at start, then `onProgress(stage, duration)` at
 *   completion. The mapping is first-seen/second-seen per stage — NOT
 *   `durationMs === 0` — because the sync stage 5 can complete in 0ms.
 *
 * `onChunk` carries no stage in the full pipeline's callback surface, so
 * chunks are attributed to the most recently started stage.
 *
 * PRODUCER ORDERING CONTRACT: the orchestrator's first callback invocation
 * is ALWAYS `onProgress(0, 0)` — before any `onChunk` (see
 * execute-full-staged-generation.use-case.ts, stage 0 block: onProgress
 * precedes the banner chunk, and every stage repeats the pattern). A chunk
 * therefore never reaches the wire before its stage-start, so the client
 * reducer's `chunks: []` reset on stage-start cannot drop data. The
 * `currentStage = 0` default is fail-safe attribution for an input the
 * producer cannot generate — deliberately NOT a lazy stage-start emission,
 * which would synthesize a phase-transition event out of order.
 */
export function createFullPipelineEventAdapter(
  send: (event: StageRouteEvent) => void,
): FullStagedGenerationCallbacks {
  const started = new Set<number>();
  let currentStage = 0;

  return {
    onProgress: (stage, durationMs) => {
      const label = STAGE_LABELS[stage] ?? `Stage ${stage}`;
      if (!started.has(stage)) {
        started.add(stage);
        currentStage = stage;
        send({ type: "stage-start", stage, label });
      } else {
        send({ type: "stage-complete", stage, label, durationMs });
      }
    },
    onError: (stage, error) => {
      send({ type: "validation-error", stage, errors: [error] });
    },
    onChunk: (chunk) => {
      send({ type: "chunk", stage: currentStage, data: chunk });
    },
    onStageTelemetry: (telemetry: StageTelemetry) => {
      send({
        type: "stage-telemetry",
        stage: telemetry.stage,
        telemetry: telemetry as unknown as Record<string, unknown>,
      });
    },
    // Part B-lite: forward the Stage-5 manifest to the wire while the Stage-6
    // review runs. The orchestrator fires this before Stage 6 starts, so the
    // frame always precedes `done` / `error`.
    onManifestReady: (manifest) => {
      send(buildManifestEvent(manifest));
    },
  };
}
