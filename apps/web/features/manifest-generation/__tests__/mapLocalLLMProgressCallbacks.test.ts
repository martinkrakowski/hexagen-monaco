import { test, describe, vi } from "vitest";
import assert from "node:assert";
import type { Dispatch, SetStateAction } from "react";
import type { StagedPhase, StageProgress } from "../staged-generation-types.ts";
import type { StageTelemetry } from "@hexagen/agentic-interaction";

// The factory's ONLY runtime dependency on @hexagen/agentic-interaction is
// formatModelChip; stub it to a sentinel-driven function so each test controls
// whether a chip line is emitted without coupling to the real chip formatter.
vi.mock("@hexagen/agentic-interaction", () => ({
  formatModelChip: (t: { __chip?: string }) => t.__chip ?? "",
}));

import { createLocalProgressCallbacks } from "../mapLocalLLMProgressCallbacks.ts";

// Minimal label map — the factory only reads it by stage index. Stage 7 is
// deliberately absent so the `?? \`Stage N\`` fallback branch is exercised.
const STAGE_LABELS: Record<number, string> = {
  0: "Config Parse",
  3: "Port Mapping",
};

/** A synchronous stand-in for a React useState pair (value + updater). */
function stateOf<T>(initial: T) {
  let value = initial;
  const set: Dispatch<SetStateAction<T>> = (next) => {
    value = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
  };
  return { get: () => value, set };
}

function makeHarness(isCancelled: () => boolean = () => false) {
  const phase = stateOf<StagedPhase>("idle");
  const stepDetail = stateOf<string>("");
  const stageProgress = stateOf<Record<number, StageProgress>>({});
  const generationError = stateOf<string | null>(null);
  const verboseLog = stateOf<string[]>([]);
  const cbs = createLocalProgressCallbacks(
    {
      setPhase: phase.set,
      setStepDetail: stepDetail.set,
      setStageProgress: stageProgress.set,
      setGenerationError: generationError.set,
      setVerboseLog: verboseLog.set,
    },
    { stageLabels: STAGE_LABELS, isCancelled },
  );
  return { phase, stepDetail, stageProgress, generationError, verboseLog, cbs };
}

function telemetry(t: {
  stage: number;
  label: string;
  durationMs: number;
  __chip?: string;
}): StageTelemetry {
  return t as unknown as StageTelemetry;
}

describe("createLocalProgressCallbacks · onProgress", () => {
  test("sets phase, step detail, and a completed stage entry on a finished stage", () => {
    const h = makeHarness();
    h.cbs.onProgress(3, 1500);

    assert.strictEqual(h.phase.get(), "stage-3");
    assert.strictEqual(h.stepDetail.get(), "Port Mapping");
    assert.deepStrictEqual(h.stageProgress.get()[3], {
      stage: 3,
      label: "Port Mapping",
      durationMs: 1500,
      chunks: [],
      completed: true,
    });
  });

  test("durationMs===0 marks the stage in-progress and preserves the prior duration", () => {
    const h = makeHarness();
    h.cbs.onProgress(3, 900); // stage finishes once...
    h.cbs.onProgress(3, 0); // ...then a later 0-duration tick must not wipe it

    assert.deepStrictEqual(h.stageProgress.get()[3], {
      stage: 3,
      label: "Port Mapping",
      durationMs: 900,
      chunks: [],
      completed: false,
    });
  });

  test("falls back to `Stage N` for an unlabelled stage index", () => {
    const h = makeHarness();
    h.cbs.onProgress(7, 100);

    assert.strictEqual(h.stepDetail.get(), "Stage 7");
    assert.strictEqual(h.stageProgress.get()[7].label, "Stage 7");
  });

  test("writes nothing once cancelled", () => {
    const h = makeHarness(() => true);
    h.cbs.onProgress(3, 1500);

    assert.strictEqual(h.phase.get(), "idle");
    assert.strictEqual(h.stepDetail.get(), "");
    assert.deepStrictEqual(h.stageProgress.get(), {});
  });
});

describe("createLocalProgressCallbacks · onError", () => {
  test("records the error, fails the phase, and stamps the stage entry when a duration is given", () => {
    const h = makeHarness();
    h.cbs.onError(3, "boom", 500);

    assert.strictEqual(h.generationError.get(), "boom");
    assert.strictEqual(h.phase.get(), "failed");
    assert.strictEqual(h.stepDetail.get(), "Error in Port Mapping: boom");
    assert.deepStrictEqual(h.stageProgress.get()[3], {
      stage: 3,
      label: "Port Mapping",
      durationMs: 500,
      error: "boom",
      chunks: [],
      completed: true,
    });
  });

  test("omits the stage entry when no duration is supplied", () => {
    const h = makeHarness();
    h.cbs.onError(3, "boom");

    assert.strictEqual(h.generationError.get(), "boom");
    assert.strictEqual(h.phase.get(), "failed");
    assert.deepStrictEqual(h.stageProgress.get(), {});
  });

  test("writes nothing once cancelled", () => {
    const h = makeHarness(() => true);
    h.cbs.onError(3, "boom", 500);

    assert.strictEqual(h.generationError.get(), null);
    assert.strictEqual(h.phase.get(), "idle");
    assert.deepStrictEqual(h.stageProgress.get(), {});
  });
});

describe("createLocalProgressCallbacks · onChunk", () => {
  test("appends each message to the verbose log", () => {
    const h = makeHarness();
    h.cbs.onChunk("hello");
    h.cbs.onChunk("world");

    assert.deepStrictEqual(h.verboseLog.get(), ["hello", "world"]);
  });

  test("writes nothing once cancelled", () => {
    const h = makeHarness(() => true);
    h.cbs.onChunk("hello");

    assert.deepStrictEqual(h.verboseLog.get(), []);
  });
});

describe("createLocalProgressCallbacks · onStageTelemetry", () => {
  test("emits a model-chip verbose line and a completed stage entry when a chip is present", () => {
    const h = makeHarness();
    const tele = telemetry({
      stage: 3,
      label: "Port Mapping",
      durationMs: 2000,
      __chip: "GLM",
    });
    h.cbs.onStageTelemetry(tele);

    assert.deepStrictEqual(h.verboseLog.get(), [
      "Stage 3 · Port Mapping — GLM · 2.0s",
    ]);
    const entry = h.stageProgress.get()[3];
    assert.strictEqual(entry.stage, 3);
    assert.strictEqual(entry.label, "Port Mapping");
    assert.strictEqual(entry.durationMs, 2000);
    assert.strictEqual(entry.completed, true);
    assert.deepStrictEqual(entry.chunks, []);
    assert.strictEqual(entry.telemetry, tele);
  });

  test("skips the verbose line when the chip is empty but still records the stage", () => {
    const h = makeHarness();
    h.cbs.onStageTelemetry(
      telemetry({ stage: 7, label: "Whatever", durationMs: 1000 }),
    );

    assert.deepStrictEqual(h.verboseLog.get(), []);
    // Unlabelled stage → the map fallback wins over the telemetry's own label.
    assert.strictEqual(h.stageProgress.get()[7].label, "Stage 7");
  });

  test("writes nothing once cancelled", () => {
    const h = makeHarness(() => true);
    h.cbs.onStageTelemetry(
      telemetry({
        stage: 3,
        label: "Port Mapping",
        durationMs: 2000,
        __chip: "GLM",
      }),
    );

    assert.deepStrictEqual(h.verboseLog.get(), []);
    assert.deepStrictEqual(h.stageProgress.get(), {});
  });
});
