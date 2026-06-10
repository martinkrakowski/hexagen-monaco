import { test, describe } from "node:test";
import assert from "node:assert";
import {
  selectPipeline,
  createFullPipelineEventAdapter,
  STAGE_LABELS,
  type StageRouteEvent,
} from "../pipeline-selection";

describe("selectPipeline", () => {
  test("defaults to stub when nothing is configured", () => {
    assert.strictEqual(selectPipeline({}), "stub");
  });

  test("STAGED_GENERATION_PIPELINE=full hard-pins full", () => {
    assert.strictEqual(
      selectPipeline({ STAGED_GENERATION_PIPELINE: "full" }),
      "full",
    );
  });

  test("STAGED_GENERATION_PIPELINE=stub hard-pins stub, overriding the canary percent (rollback lever)", () => {
    assert.strictEqual(
      selectPipeline(
        {
          STAGED_GENERATION_PIPELINE: "stub",
          STAGED_GENERATION_FULL_PERCENT: "100",
        },
        () => 0,
      ),
      "stub",
    );
  });

  test("canary percent routes the configured fraction to full", () => {
    const env = { STAGED_GENERATION_FULL_PERCENT: "25" };
    // random() < percent/100 → full
    assert.strictEqual(
      selectPipeline(env, () => 0.1),
      "full",
    );
    assert.strictEqual(
      selectPipeline(env, () => 0.249),
      "full",
    );
    assert.strictEqual(
      selectPipeline(env, () => 0.25),
      "stub",
    );
    assert.strictEqual(
      selectPipeline(env, () => 0.9),
      "stub",
    );
  });

  test("percent 0 (or unset) never routes to full", () => {
    assert.strictEqual(
      selectPipeline({ STAGED_GENERATION_FULL_PERCENT: "0" }, () => 0),
      "stub",
    );
    assert.strictEqual(
      selectPipeline({}, () => 0),
      "stub",
    );
  });

  test("percent 100 always routes to full", () => {
    assert.strictEqual(
      selectPipeline({ STAGED_GENERATION_FULL_PERCENT: "100" }, () => 0.999),
      "full",
    );
  });

  test("malformed / out-of-range percent values fail closed to stub", () => {
    for (const bad of ["abc", "-5", "NaN", ""]) {
      assert.strictEqual(
        selectPipeline({ STAGED_GENERATION_FULL_PERCENT: bad }, () => 0),
        "stub",
        `percent=${JSON.stringify(bad)} must fail closed`,
      );
    }
    // >100 clamps to 100 (always full), not to garbage behavior
    assert.strictEqual(
      selectPipeline({ STAGED_GENERATION_FULL_PERCENT: "150" }, () => 0.999),
      "full",
    );
  });

  test("unknown flag values are ignored (fall through to canary percent)", () => {
    assert.strictEqual(
      selectPipeline(
        {
          STAGED_GENERATION_PIPELINE: "fulll",
          STAGED_GENERATION_FULL_PERCENT: "100",
        },
        () => 0,
      ),
      "full",
    );
    assert.strictEqual(
      selectPipeline({ STAGED_GENERATION_PIPELINE: "fulll" }, () => 0),
      "stub",
    );
  });
});

describe("createFullPipelineEventAdapter", () => {
  // The orchestrator's emission contract per successful stage is:
  //   onProgress(stage, 0)        — stage start
  //   onChunk("Stage N · Label")  — banner chunk
  //   ...onChunk(token) during the stage...
  //   onProgress(stage, duration) — stage complete
  // The adapter must translate that into the route's stage-start /
  // stage-complete / chunk NDJSON events with the client's stage labels.

  function collect() {
    const events: StageRouteEvent[] = [];
    const adapter = createFullPipelineEventAdapter((e) => events.push(e));
    return { events, adapter };
  }

  test("first onProgress for a stage emits stage-start, second emits stage-complete", () => {
    const { events, adapter } = collect();
    adapter.onProgress?.(0, 0);
    adapter.onProgress?.(0, 1234);
    assert.deepStrictEqual(events, [
      { type: "stage-start", stage: 0, label: STAGE_LABELS[0] },
      {
        type: "stage-complete",
        stage: 0,
        label: STAGE_LABELS[0],
        durationMs: 1234,
      },
    ]);
  });

  test("a sync stage completing in 0ms still maps start/complete correctly", () => {
    // Stage 5 (Manifest Assembly) is pure TypeScript and can complete in 0ms —
    // the mapping must be first-seen/second-seen, NOT durationMs === 0.
    const { events, adapter } = collect();
    adapter.onProgress?.(5, 0);
    adapter.onProgress?.(5, 0);
    assert.strictEqual(events[0]?.type, "stage-start");
    assert.strictEqual(events[1]?.type, "stage-complete");
  });

  test("chunks are attributed to the most recently started stage", () => {
    const { events, adapter } = collect();
    adapter.onProgress?.(0, 0);
    adapter.onChunk?.("Stage 0 · Prompt Normalization");
    adapter.onProgress?.(0, 10);
    adapter.onProgress?.(1, 0);
    adapter.onChunk?.("token");
    const chunkEvents = events.filter((e) => e.type === "chunk");
    assert.deepStrictEqual(chunkEvents, [
      { type: "chunk", stage: 0, data: "Stage 0 · Prompt Normalization" },
      { type: "chunk", stage: 1, data: "token" },
    ]);
  });

  test("a chunk before any onProgress is attributed to stage 0", () => {
    const { events, adapter } = collect();
    adapter.onChunk?.("early");
    assert.deepStrictEqual(events, [
      { type: "chunk", stage: 0, data: "early" },
    ]);
  });

  test("onError maps to a validation-error event at the failing stage", () => {
    const { events, adapter } = collect();
    adapter.onProgress?.(2, 0);
    adapter.onError?.(2, "Stage 2 accepted no bounded contexts", 50);
    assert.deepStrictEqual(events[1], {
      type: "validation-error",
      stage: 2,
      errors: ["Stage 2 accepted no bounded contexts"],
    });
  });

  test("onStageTelemetry forwards the full telemetry object", () => {
    const { events, adapter } = collect();
    const telemetry = {
      stage: 3,
      label: "Port Mapping",
      durationMs: 99,
      usedLLM: true,
      retryCount: 0,
      inputTokensEstimate: 10,
      outputTokensActual: 20,
      servedFromCache: false,
      summary: "ok",
    };
    adapter.onStageTelemetry?.(telemetry);
    assert.deepStrictEqual(events[0], {
      type: "stage-telemetry",
      stage: 3,
      telemetry,
    });
  });

  test("full 7-stage walk produces a coherent start/complete sequence with client labels", () => {
    const { events, adapter } = collect();
    for (let stage = 0; stage <= 6; stage++) {
      adapter.onProgress?.(stage, 0);
      adapter.onProgress?.(stage, 5);
    }
    const starts = events.filter((e) => e.type === "stage-start");
    const completes = events.filter((e) => e.type === "stage-complete");
    assert.strictEqual(starts.length, 7);
    assert.strictEqual(completes.length, 7);
    // Labels must match the client hook's STAGE_LABELS vocabulary exactly.
    assert.deepStrictEqual(
      starts.map((e) => (e.type === "stage-start" ? e.label : "")),
      [
        "Prompt Normalization",
        "Domain Extraction",
        "Context Classification",
        "Port Mapping",
        "Adapter Assignment",
        "Manifest Assembly",
        "Validation Review",
      ],
    );
  });
});
