import { test, describe } from "vitest";
import assert from "node:assert";
import type {
  AssembledManifest,
  PipelineState,
} from "@hexagen/agentic-interaction";
import { stageSummary } from "@hexagen/agentic-interaction";
import {
  buildDoneEvent,
  buildManifestEvent,
  createFullPipelineEventAdapter,
  STAGE_LABELS,
  type StageRouteEvent,
} from "../pipeline-selection";

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

  test("a chunk before any onProgress is attributed to stage 0 (defensive — the producer cannot emit this ordering)", () => {
    // The orchestrator ALWAYS calls onProgress(0, 0) before its first
    // onChunk (see the producer-ordering contract in pipeline-selection.ts).
    // This pins the fail-safe attribution for that impossible input, NOT an
    // expected production sequence.
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
      summary: stageSummary`ok`,
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

describe("buildManifestEvent (Part B-lite)", () => {
  // The NON-terminal early `manifest` frame, emitted between Stage-5 assembly
  // and the Stage-6 review. `done` always follows and supersedes its yaml.

  const assembled = {
    yaml: "workspace:\n  name: early\n",
    // countManifestEntities reads the LAYERED shape assembly emits
    // (layers.application.ports / layers.infrastructure.adapters).
    parsedObject: {
      bounded_contexts: [
        {
          name: "billing",
          layers: {
            application: {
              ports: {
                in: [{ name: "CreateInvoicePort" }],
                out: [{ name: "InvoiceRepositoryPort" }],
              },
            },
            infrastructure: {
              adapters: [{ name: "InvoiceRepositoryAdapter" }],
            },
          },
        },
        { name: "notifications" },
      ],
    },
  } as unknown as AssembledManifest;

  test("carries the Stage-5 yaml, shared-counter counts, and an empty transactionId", () => {
    // transactionId is "" BY DESIGN: no transaction exists at Stage-5 time
    // (it is begun only after the review passes); the real id arrives on
    // `done`, and the client does not read the field from this frame.
    assert.deepStrictEqual(buildManifestEvent(assembled), {
      type: "manifest",
      yaml: "workspace:\n  name: early\n",
      contextCount: 2,
      portCount: 2,
      adapterCount: 1,
      transactionId: "",
    });
  });

  test("degrades to empty yaml / zero counts on a sparse manifest", () => {
    const event = buildManifestEvent({
      yaml: "",
      parsedObject: {},
    } as AssembledManifest);
    assert.deepStrictEqual(event, {
      type: "manifest",
      yaml: "",
      contextCount: 0,
      portCount: 0,
      adapterCount: 0,
      transactionId: "",
    });
  });

  test("the event adapter forwards onManifestReady as a `manifest` frame in stream position", () => {
    // Simulate the orchestrator's surrounding protocol: stage-5 completes,
    // the hook fires, stage 6 starts. The frame must land between them —
    // i.e. before any terminal event the route would emit afterwards.
    const events: StageRouteEvent[] = [];
    const adapter = createFullPipelineEventAdapter((e) => events.push(e));
    adapter.onProgress?.(5, 0);
    adapter.onProgress?.(5, 0);
    adapter.onManifestReady?.(assembled);
    adapter.onProgress?.(6, 0);

    assert.deepStrictEqual(
      events.map((e) => e.type),
      ["stage-start", "stage-complete", "manifest", "stage-start"],
    );
    const manifestEvent = events[2];
    assert.strictEqual(
      manifestEvent.type === "manifest" ? manifestEvent.yaml : "",
      "workspace:\n  name: early\n",
    );
  });
});

describe("buildDoneEvent", () => {
  // The terminal `done` event for a successful run: yaml + counts as before,
  // plus the previously-dropped Stage-6 report as an OPTIONAL, ADDITIVE
  // `validation` field mirroring the /spec route's done-event shape.

  function successState(overrides?: Partial<PipelineState>): PipelineState {
    return {
      stage2: {
        accepted: [
          {
            name: "billing",
            type: "core",
            reasoning: "core revenue",
          },
          {
            name: "notifications",
            type: "supporting",
            reasoning: "sends emails",
          },
        ],
        rejected: [],
        uncertain: [],
      },
      stage3: {
        contexts: [
          {
            contextName: "billing",
            in: [
              {
                name: "CreateInvoicePort",
                type: "command",
                description: "create",
              },
            ],
            out: [
              {
                name: "InvoiceRepositoryPort",
                type: "repository",
                description: "persist",
              },
            ],
          },
          {
            contextName: "notifications",
            in: [
              { name: "NotifyPort", type: "command", description: "notify" },
            ],
            out: [],
          },
        ],
      },
      stage4: {
        contexts: [
          {
            contextName: "billing",
            adapters: [
              {
                name: "InvoiceRepositoryAdapter",
                type: "Repository",
                implements: "InvoiceRepositoryPort",
              },
            ],
          },
        ],
      },
      stage5: {
        yaml: "workspace:\n  name: my-system\n",
        parsedObject: {},
      },
      ...overrides,
    };
  }

  test("includes the Stage-6 report as `validation` with exact {errors, warnings, passed} shape", () => {
    const event = buildDoneEvent(
      successState({
        stage6: {
          errors: ["[R02] Context 'billing' has no inbound port."],
          warnings: ["Consider a query port for reads."],
          passed: false,
        },
      }),
      "txn-1",
    );
    assert.deepStrictEqual(event, {
      type: "done",
      yaml: "workspace:\n  name: my-system\n",
      contextCount: 2,
      portCount: 3,
      adapterCount: 1,
      transactionId: "txn-1",
      validation: {
        errors: ["[R02] Context 'billing' has no inbound port."],
        warnings: ["Consider a query port for reads."],
        passed: false,
      },
    });
  });

  test("omits `validation` entirely when the pipeline produced no Stage-6 report (additive contract)", () => {
    const event = buildDoneEvent(successState(), "txn-2");
    assert.strictEqual(event.type, "done");
    // OMITTED, not null/undefined-valued: older consumers must see a payload
    // indistinguishable from the pre-validation contract.
    assert.ok(!("validation" in event));
    assert.strictEqual(
      event.type === "done" ? event.transactionId : "",
      "txn-2",
    );
  });

  test("counts and yaml match the previous inline computation (parity guard)", () => {
    const event = buildDoneEvent(successState(), "txn-3");
    assert.deepStrictEqual(event, {
      type: "done",
      yaml: "workspace:\n  name: my-system\n",
      contextCount: 2,
      portCount: 3,
      adapterCount: 1,
      transactionId: "txn-3",
    });
  });

  test("defaults for a sparse state: empty yaml and zero counts", () => {
    const event = buildDoneEvent({}, "txn-4");
    assert.deepStrictEqual(event, {
      type: "done",
      yaml: "",
      contextCount: 0,
      portCount: 0,
      adapterCount: 0,
      transactionId: "txn-4",
    });
  });

  test("a passing Stage-6 report with no findings is still forwarded", () => {
    // The client keys its findings panel on report CONTENT, not presence —
    // but the route must not second-guess that and drop an empty report.
    const event = buildDoneEvent(
      successState({ stage6: { errors: [], warnings: [], passed: true } }),
      "txn-5",
    );
    assert.deepStrictEqual(event.type === "done" ? event.validation : null, {
      errors: [],
      warnings: [],
      passed: true,
    });
  });
});
