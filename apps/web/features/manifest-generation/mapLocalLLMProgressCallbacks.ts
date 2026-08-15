import type { Dispatch, SetStateAction } from "react";
import type { StagedPhase, StageProgress } from "./staged-generation-types";
import type { StageTelemetry } from "@hexagen/agentic-interaction";
import { formatModelChip } from "@hexagen/agentic-interaction";

/**
 * The React state setters the local (WebLLM) generation path writes its
 * per-stage progress into. Extracted from `useStagedSpecGeneration` so the
 * mapping from the client use-case's callback events onto hook state is a
 * named, independently testable unit rather than 70 lines of inline closures.
 */
export interface LocalProgressSetters {
  setPhase: Dispatch<SetStateAction<StagedPhase>>;
  setStepDetail: Dispatch<SetStateAction<string>>;
  setStageProgress: Dispatch<SetStateAction<Record<number, StageProgress>>>;
  setGenerationError: Dispatch<SetStateAction<string | null>>;
  setVerboseLog: Dispatch<SetStateAction<string[]>>;
}

/** The non-setter dependencies the callbacks close over. */
export interface LocalProgressHelpers {
  /** Stage-index → human label (e.g. 3 → "Port Mapping"). */
  stageLabels: Record<number, string>;
  /**
   * Live cancellation check. Every callback returns early when this is true so
   * an aborted run stops mutating hook state mid-flight (the client use-case
   * may still emit a few trailing events after the abort is observed).
   */
  isCancelled: () => boolean;
}

/** The callback bag consumed by the client spec-generation use-case's execute(). */
export interface LocalProgressCallbacks {
  onProgress: (stage: number, durationMs: number) => void;
  onError: (stage: number, error: string, durationMs?: number) => void;
  onChunk: (message: string) => void;
  onStageTelemetry: (telemetry: StageTelemetry) => void;
}

/**
 * Build the progress callbacks the local generation path hands to
 * `useCase.execute()`. Behavior is identical to the previously-inline
 * closures — this only gives them a name and a seam. Cloud runs receive the
 * per-stage model line from the server (a stage -1 chunk); the local path has
 * no server, so `onStageTelemetry` emits the equivalent chip line itself.
 */
export function createLocalProgressCallbacks(
  setters: LocalProgressSetters,
  helpers: LocalProgressHelpers,
): LocalProgressCallbacks {
  const {
    setPhase,
    setStepDetail,
    setStageProgress,
    setGenerationError,
    setVerboseLog,
  } = setters;
  const { stageLabels, isCancelled } = helpers;

  return {
    onProgress: (stage: number, durationMs: number) => {
      if (isCancelled()) return;
      setPhase(`stage-${stage}` as StagedPhase);
      setStepDetail(stageLabels[stage] ?? `Stage ${stage}`);
      setStageProgress((prev) => {
        const existing = prev[stage] ?? {
          stage,
          label: "",
          durationMs: 0,
          chunks: [],
          completed: false,
        };
        return {
          ...prev,
          [stage]: {
            ...existing,
            label: stageLabels[stage] ?? `Stage ${stage}`,
            durationMs: durationMs > 0 ? durationMs : existing.durationMs,
            completed: durationMs > 0,
          },
        };
      });
    },
    onError: (stage: number, error: string, durationMs?: number) => {
      if (isCancelled()) return;
      // `stageLabels` is an injected, possibly-partial map (the hook passes a
      // 0–6 map, but nothing constrains a caller to that), so the step detail
      // needs the same `Stage N` fallback its sibling stage entry already uses
      // — otherwise an unlabelled stage renders "Error in undefined: ...".
      const label = stageLabels[stage] ?? `Stage ${stage}`;
      setGenerationError(error);
      setPhase("failed");
      setStepDetail(`Error in ${label}: ${error}`);
      // `!== undefined`, NOT truthiness: a stage that fails synchronously
      // reports `Date.now() - start === 0` (e.g. the structured-config Stage 0
      // parse throw in execute-structured-config-generation.use-case.ts), and a
      // truthiness check would drop exactly those immediate failures from
      // stage progress. Unlike `onProgress`, where 0 is the protocol's
      // "stage started" sentinel, `onError` fires once and only on failure.
      if (durationMs !== undefined) {
        setStageProgress((prev) => ({
          ...prev,
          [stage]: {
            stage,
            label,
            durationMs,
            error,
            chunks: [],
            completed: true,
          },
        }));
      }
    },
    onChunk: (message: string) => {
      if (isCancelled()) return;
      setVerboseLog((prev) => [...prev, message]);
    },
    onStageTelemetry: (telemetry: StageTelemetry) => {
      if (isCancelled()) return;
      // Cloud runs get the model line from the server (stage -1 chunk); the
      // local path emits its own equivalent here.
      const chip = formatModelChip(telemetry);
      if (chip) {
        const seconds = (telemetry.durationMs / 1000).toFixed(1);
        setVerboseLog((prev) => [
          ...prev,
          `Stage ${telemetry.stage} · ${telemetry.label} — ${chip} · ${seconds}s`,
        ]);
      }
      setStageProgress((prev) => ({
        ...prev,
        [telemetry.stage]: {
          stage: telemetry.stage,
          label: stageLabels[telemetry.stage] ?? `Stage ${telemetry.stage}`,
          durationMs: telemetry.durationMs,
          chunks: [],
          completed: true,
          telemetry,
        },
      }));
    },
  };
}
