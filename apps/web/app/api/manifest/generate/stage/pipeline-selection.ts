import type {
  FullStagedGenerationCallbacks,
  StageTelemetry,
} from "@hexagen/agentic-interaction";

/**
 * A3 cutover seam: stub vs full pipeline selection + the event adapter that
 * lets `ExecuteFullStagedGenerationUseCase` speak the route's NDJSON dialect.
 *
 * Flag semantics (see docs/planning/normalizer-rewire-development-plan.md, A3):
 * - `STAGED_GENERATION_PIPELINE=full`  → hard-pin the full pipeline.
 * - `STAGED_GENERATION_PIPELINE=stub`  → hard-pin the stub. This OVERRIDES the
 *   canary percent — it is the one-flip rollback lever.
 * - unset (or any other value)         → canary: `STAGED_GENERATION_FULL_PERCENT`
 *   (0–100) of requests go to the full pipeline. Defaults to 0 = ship dark.
 *   Malformed or negative percents fail closed to the stub.
 */

export type PipelineChoice = "full" | "stub";

export interface PipelineSelectionEnv {
  STAGED_GENERATION_PIPELINE?: string;
  STAGED_GENERATION_FULL_PERCENT?: string;
}

export function selectPipeline(
  env: PipelineSelectionEnv,
  random: () => number = Math.random,
): PipelineChoice {
  if (env.STAGED_GENERATION_PIPELINE === "full") return "full";
  if (env.STAGED_GENERATION_PIPELINE === "stub") return "stub";

  const raw = env.STAGED_GENERATION_FULL_PERCENT;
  const parsed = raw === undefined || raw === "" ? 0 : Number(raw);
  // Fail closed: NaN / negative → 0; >100 clamps to 100.
  const percent = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), 100)
    : 0;

  return random() * 100 < percent ? "full" : "stub";
}

/** Stage labels for the full pipeline — must match the client hook's
 * `STAGE_LABELS` in `useStagedManifestGeneration.ts` (the client was built
 * for this 7-stage vocabulary; the stub's 4 passes reuse a subset). */
export const STAGE_LABELS: Record<number, string> = {
  0: "Prompt Normalization",
  1: "Domain Extraction",
  2: "Context Classification",
  3: "Port Mapping",
  4: "Adapter Assignment",
  5: "Manifest Assembly",
  6: "Validation Review",
};

/** The stage route's NDJSON event vocabulary (shared by both pipelines). */
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
  | {
      type: "done";
      yaml: string;
      contextCount: number;
      portCount: number;
      adapterCount: number;
      transactionId: string;
      /** Which pipeline served this request — canary comparison key. */
      pipeline: PipelineChoice;
    }
  | { type: "error"; message: string };

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
  };
}
