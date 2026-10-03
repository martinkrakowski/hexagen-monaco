import { test, vi } from "vitest";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";

vi.mock("../persist-run-telemetry", () => ({
  persistStageTelemetry: vi.fn(),
}));

import { persistStageTelemetry } from "../persist-run-telemetry";
import { useStagedGenerationStream } from "../useStagedGenerationStream";

const originalFetch = global.fetch;

function createMockReadableStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < lines.length) {
        controller.enqueue(encoder.encode(lines[index] + "\n"));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/** Like createMockReadableStream but enqueues chunks EXACTLY as given — no
 * trailing newline appended — so a terminal frame can land in the residual
 * buffer instead of the in-loop line parser. */
function createRawChunkStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function mockFetchWithSSE(responseLines: string[], status = 200) {
  return async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      body: createMockReadableStream(responseLines),
    }) as unknown as Response;
}

test("parses stage-start event", async () => {
  const lines = [
    '{"type":"stage-start","stage":0,"label":"Context Extraction"}',
  ];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({
        endpoint: "/api/test",
        stageLabels: { 0: "Context Extraction" },
      }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    // The stage-start frame was parsed into stageProgress…
    assert.strictEqual(result.current.stageProgress[0]?.stage, 0);
    assert.strictEqual(
      result.current.stageProgress[0]?.label,
      "Context Extraction",
    );
    // …but this stream then ends WITHOUT a done/error frame, which is now a
    // failure (terminal-frame accounting) — previously the run resolved
    // silently parked on "stage-0".
    assert.strictEqual(generateResult?.phase, "failed");
  } finally {
    global.fetch = originalFetch;
  }
});

test("a stream that ends without a terminal frame fails with retry copy (was a silent hang)", async () => {
  // Server crash / proxy close mid-generation: the reader resolves done with
  // no `done`/`error` frame ever seen. The hook must surface a failed state
  // (React state included) instead of resolving as if still in flight.
  const lines = ['{"type":"stage-start","stage":3,"label":"Port Mapping"}'];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    assert.strictEqual(generateResult?.phase, "failed");
    assert.match(generateResult?.stepDetail || "", /ended unexpectedly/i);
    assert.match(generateResult?.stepDetail || "", /retry/i);
    // React state, not just the resolved result — the UI reads these.
    assert.strictEqual(result.current.phase, "failed");
    assert.match(result.current.generationError || "", /ended unexpectedly/i);
    assert.strictEqual(result.current.isGenerating, false);
    // The stepDetail STATE carries the failure copy too — ManifestGeneratingStep
    // renders stepDetail regardless of phase, so a stale stage label here would
    // show "Port Mapping..." next to a failed run.
    assert.match(result.current.stepDetail || "", /ended unexpectedly/i);
    // ImportProjectSpecPage special-cases this exact substring to reroute to
    // the description flow — the silent-death copy must never contain it.
    assert.ok(
      !(result.current.generationError || "").includes(
        "No cloud LLM API keys configured",
      ),
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("a residual done frame without a trailing newline still completes AND writes React state", async () => {
  // The terminal frame arrives in the final chunk with no trailing "\n", so it
  // never passes through the in-loop line parser — only the residual-buffer
  // flush sees it. The flush must mirror the in-loop branch including the
  // React state writes (previously it only filled the resolved result, leaving
  // the UI parked on the last stage).
  global.fetch = async () =>
    ({
      ok: true,
      status: 200,
      body: createRawChunkStream([
        '{"type":"stage-start","stage":0,"label":"Config Parse"}\n',
        '{"type":"done","yaml":"residual-manifest","contextCount":2,"portCount":3,"adapterCount":4,"validation":{"errors":[],"warnings":["[R02] heads up"],"passed":true}}',
      ]),
    }) as unknown as Response;

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    assert.strictEqual(generateResult?.phase, "complete");
    assert.strictEqual(generateResult?.generatedManifest, "residual-manifest");
    // React state written by the flush:
    assert.strictEqual(result.current.phase, "complete");
    assert.strictEqual(result.current.generatedManifest, "residual-manifest");
    assert.strictEqual(result.current.contextCount, 2);
    assert.strictEqual(result.current.portCount, 3);
    assert.strictEqual(result.current.adapterCount, 4);
    assert.deepStrictEqual(result.current.validationReport, {
      errors: [],
      warnings: ["[R02] heads up"],
      passed: true,
    });
    assert.strictEqual(result.current.generationError, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a residual error frame without a trailing newline fails the run (was dropped)", async () => {
  global.fetch = async () =>
    ({
      ok: true,
      status: 200,
      body: createRawChunkStream([
        '{"type":"error","message":"pipeline exploded"}',
      ]),
    }) as unknown as Response;

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    assert.strictEqual(generateResult?.phase, "failed");
    assert.strictEqual(generateResult?.stepDetail, "pipeline exploded");
    // The reported failure — not the generic missing-terminal-frame copy: the
    // residual error frame counts as a terminal frame.
    assert.strictEqual(result.current.generationError, "pipeline exploded");
    assert.strictEqual(result.current.phase, "failed");
    // The stepDetail STATE mirrors the failure message — before the error arm
    // synced it (applyTerminalFrame), the UI kept showing the prior stage
    // label even though the run had failed.
    assert.strictEqual(result.current.stepDetail, "pipeline exploded");
  } finally {
    global.fetch = originalFetch;
  }
});

test("watchdog inactivity cancel surfaces a distinct timeout message", async () => {
  vi.useFakeTimers();
  // A stream that never produces data: read() parks forever until the
  // watchdog's reader.cancel() resolves it with done (no throw — so no
  // reconnect attempt fires either).
  global.fetch = async () =>
    ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        pull: () => new Promise<never>(() => {}),
      }),
    }) as unknown as Response;

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generatePromise!: Promise<
      Awaited<ReturnType<typeof result.current.generate>>
    >;

    act(() => {
      generatePromise = result.current.generate({ description: "test" });
    });

    // Let the mocked fetch resolve, then advance past READ_TIMEOUT_MS (300s)
    // so a 5s watchdog tick observes the inactivity and cancels the reader.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(305001);
    });

    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;
    await act(async () => {
      generateResult = await generatePromise;
    });

    assert.strictEqual(generateResult?.phase, "failed");
    assert.match(
      generateResult?.stepDetail || "",
      /no data received for 300 seconds/i,
    );
    assert.match(
      result.current.generationError || "",
      /no data received for 300 seconds/i,
    );
    assert.strictEqual(result.current.phase, "failed");
  } finally {
    vi.useRealTimers();
    global.fetch = originalFetch;
  }
});

test("parses done event with manifest", async () => {
  const lines = [
    '{"type":"done","yaml":"test-manifest","contextCount":2,"portCount":3,"adapterCount":1}',
  ];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    assert.strictEqual(generateResult?.phase, "complete");
    assert.strictEqual(generateResult?.generatedManifest, "test-manifest");
    assert.strictEqual(generateResult?.contextCount, 2);
    assert.strictEqual(generateResult?.portCount, 3);
    assert.strictEqual(generateResult?.adapterCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("captures the Stage-6 validation report from the done event", async () => {
  const lines = [
    '{"type":"done","yaml":"m","contextCount":1,"portCount":1,"adapterCount":1,"validation":{"errors":["[R17] Foo/BarPort: weak"],"warnings":["[R02] heads up"],"passed":false}}',
  ];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );

    await act(async () => {
      await result.current.generate({ description: "test" });
    });

    assert.deepStrictEqual(result.current.validationReport, {
      errors: ["[R17] Foo/BarPort: weak"],
      warnings: ["[R02] heads up"],
      passed: false,
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("a stage-telemetry event without a prior stage-start yields a well-formed entry", async () => {
  // Stage 7 (repair) emits telemetry with no stage-start — the entry must still
  // carry stage/label/chunks (not a bare { telemetry }) so generic consumers of
  // stageProgress don't hit undefined.
  const lines = [
    '{"type":"stage-telemetry","stage":7,"telemetry":{"stage":7,"label":"Manifest Repair","durationMs":5,"usedLLM":true,"retryCount":0,"inputTokensEstimate":1,"outputTokensActual":1,"servedFromCache":false,"summary":"x","modelName":"openai/gpt-4o"}}',
    '{"type":"done","yaml":"m","contextCount":1,"portCount":1,"adapterCount":1}',
  ];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );

    await act(async () => {
      await result.current.generate({ description: "test" });
    });

    const entry = result.current.stageProgress[7];
    assert.ok(entry, "stage 7 progress entry exists");
    assert.strictEqual(entry.stage, 7);
    assert.strictEqual(entry.label, "Manifest Repair");
    assert.ok(Array.isArray(entry.chunks));
    assert.strictEqual(entry.telemetry?.modelName, "openai/gpt-4o");
  } finally {
    global.fetch = originalFetch;
  }
});

test("forwards generate-body tenantId to persistStageTelemetry, and omits it when absent", async () => {
  const persist = vi.mocked(persistStageTelemetry);
  persist.mockClear();
  const telemetry = {
    durationMs: 5,
    usedLLM: true,
    retryCount: 0,
    inputTokensEstimate: 1,
    outputTokensActual: 1,
    servedFromCache: false,
    summary: "x",
  };
  const lines = [
    `{"type":"stage-telemetry","telemetry":${JSON.stringify({ ...telemetry, stage: 0, label: "A" })}}`,
    '{"type":"done","yaml":"m","contextCount":1,"portCount":1,"adapterCount":1}',
  ];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    await act(async () => {
      await result.current.generate({
        description: "org run",
        tenantId: "org-acme",
        projectId: "proj-1",
      });
    });
    assert.equal(persist.mock.calls.length, 1);
    assert.equal(
      persist.mock.calls[0]?.[1]?.tenantId,
      "org-acme",
      "org generation must name its tenant or the server writes personal history",
    );
    assert.equal(persist.mock.calls[0]?.[1]?.projectId, "proj-1");

    persist.mockClear();
    await act(async () => {
      await result.current.generate({ description: "personal" });
    });
    assert.equal(persist.mock.calls.length, 1);
    assert.equal(
      persist.mock.calls[0]?.[1]?.tenantId,
      undefined,
      "the personal path must stay tenant-less",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("one generate() pass shares a single runId across stage-telemetry persists", async () => {
  const persist = vi.mocked(persistStageTelemetry);
  persist.mockClear();
  const telemetry = {
    durationMs: 5,
    usedLLM: true,
    retryCount: 0,
    inputTokensEstimate: 1,
    outputTokensActual: 1,
    servedFromCache: false,
    summary: "x",
  };
  const lines = [
    `{"type":"stage-telemetry","telemetry":${JSON.stringify({ ...telemetry, stage: 0, label: "A" })}}`,
    `{"type":"stage-telemetry","telemetry":${JSON.stringify({ ...telemetry, stage: 1, label: "B" })}}`,
    '{"type":"done","yaml":"m","contextCount":1,"portCount":1,"adapterCount":1}',
  ];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    await act(async () => {
      await result.current.generate({ description: "test" });
    });
    assert.equal(persist.mock.calls.length, 2);
    const first = persist.mock.calls[0]?.[1]?.runId;
    const second = persist.mock.calls[1]?.[1]?.runId;
    assert.equal(typeof first, "string");
    assert.ok(first);
    assert.equal(first, second);
  } finally {
    global.fetch = originalFetch;
  }
});

test("ignores a malformed Stage-6 validation payload (keeps it null)", async () => {
  // `validation` is present + truthy but the wrong shape (errors is not an
  // array). The boundary guard must reject it so the UI never dereferences a
  // non-array `.errors`/`.warnings` and throws during render.
  const lines = [
    '{"type":"done","yaml":"m","contextCount":1,"portCount":1,"adapterCount":1,"validation":{"errors":"oops"}}',
  ];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    assert.strictEqual(result.current.validationReport, null);
    assert.strictEqual(generateResult?.validationReport, null);
    // The manifest still completes — a bad report is advisory, not fatal.
    assert.strictEqual(generateResult?.phase, "complete");
  } finally {
    global.fetch = originalFetch;
  }
});

test("handles SSE error event", async () => {
  const lines = ['{"type":"error","message":"LLM generation failed"}'];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    assert.strictEqual(generateResult?.phase, "failed");
    assert.match(generateResult?.stepDetail || "", /LLM generation failed/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("handles HTTP error response", async () => {
  global.fetch = async () =>
    ({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    }) as unknown as Response;

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    assert.strictEqual(generateResult?.phase, "failed");
    assert.match(generateResult?.stepDetail || "", /Internal Server Error/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("aborts stream on cancel", async () => {
  let streamController: ReadableStreamDefaultController | null = null;

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
    },
  });

  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal as AbortSignal | undefined;
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          streamController?.close();
        },
        { once: true },
      );
    }
    return { ok: true, body: stream } as unknown as Response;
  };

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generatePromise: Promise<
      Awaited<ReturnType<typeof result.current.generate>>
    >;

    act(() => {
      generatePromise = result.current.generate({ description: "test" });
    });
    act(() => result.current.cancel());

    // The abort unwinds the read loop asynchronously and the hook writes its
    // final phase as the promise settles — awaiting it bare left that update
    // outside act(). Awaiting INSIDE an async act flushes it before the
    // assertion reads the result.
    let generateResult!: Awaited<typeof generatePromise>;
    await act(async () => {
      generateResult = await generatePromise!;
    });
    assert.strictEqual(generateResult.phase, "idle");
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolves after a terminal frame even when the server holds the stream open", async () => {
  // The stream enqueues a complete `done` frame but is NEVER closed — the
  // read loop must break on the terminal frame (and cancel the reader)
  // instead of parking on the next read() until the inactivity watchdog.
  // A regression here fails as a test timeout.
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode('{"type":"done","yaml":"system: x"}\n'),
      );
      // Deliberately no controller.close().
    },
    cancel() {
      cancelled = true;
    },
  });

  global.fetch = async () =>
    ({ ok: true, body: stream }) as unknown as Response;

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    assert.strictEqual(generateResult?.phase, "complete");
    assert.strictEqual(generateResult?.generatedManifest, "system: x");
    // The reader was cancelled so the held-open connection gets released.
    assert.strictEqual(cancelled, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a `manifest` frame is non-terminal: earlyManifest is set, reading continues, and done's yaml supersedes it (Part B-lite)", async () => {
  const lines = [
    '{"type":"manifest","yaml":"early: manifest","contextCount":1,"portCount":1,"adapterCount":1,"transactionId":""}',
    '{"type":"chunk","stage":6,"data":"Stage 6 · Validation Review"}',
    '{"type":"done","yaml":"final: manifest","contextCount":1,"portCount":1,"adapterCount":1}',
  ];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    // The manifest frame did not terminate the run — the done frame after it
    // was still consumed and completed the run.
    assert.strictEqual(generateResult?.phase, "complete");
    assert.strictEqual(generateResult?.earlyManifest, "early: manifest");
    assert.strictEqual(generateResult?.generatedManifest, "final: manifest");
    assert.strictEqual(result.current.earlyManifest, "early: manifest");
    // generatedManifest carries done's yaml — the early manifest is
    // superseded (consumers prefer generatedManifest once complete, and
    // compare the two to show the "updated by validation repair" note).
    assert.strictEqual(result.current.generatedManifest, "final: manifest");

    // reset() clears the early manifest with the rest of the run state.
    act(() => result.current.reset());
    assert.strictEqual(result.current.earlyManifest, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a stream ending after only a `manifest` frame still fails (manifest is not terminal-frame accounting)", async () => {
  const lines = [
    '{"type":"manifest","yaml":"early: manifest","contextCount":1,"portCount":1,"adapterCount":1,"transactionId":""}',
  ];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    // No done/error ever arrived — the run failed despite the early manifest.
    assert.strictEqual(generateResult?.phase, "failed");
    assert.match(generateResult?.stepDetail || "", /ended unexpectedly/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("an empty-yaml `manifest` frame is ignored (earlyManifest stays null)", async () => {
  const lines = [
    '{"type":"manifest","yaml":"","contextCount":0,"portCount":0,"adapterCount":0,"transactionId":""}',
    '{"type":"done","yaml":"final: manifest","contextCount":1,"portCount":1,"adapterCount":1}',
  ];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );

    await act(async () => {
      await result.current.generate({ description: "test" });
    });

    assert.strictEqual(result.current.earlyManifest, null);
    assert.strictEqual(result.current.generatedManifest, "final: manifest");
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolves after a terminal frame even when the server holds the stream open — with a preceding manifest frame", async () => {
  // Part B-lite guard on the PR-#432 regression: the non-terminal `manifest`
  // branch must not disturb the break-on-terminal-frame accounting. A
  // regression here fails as a test timeout.
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          '{"type":"manifest","yaml":"early: x","contextCount":1,"portCount":0,"adapterCount":0,"transactionId":""}\n',
        ),
      );
      controller.enqueue(
        encoder.encode('{"type":"done","yaml":"system: x"}\n'),
      );
      // Deliberately no controller.close().
    },
    cancel() {
      cancelled = true;
    },
  });

  global.fetch = async () =>
    ({ ok: true, body: stream }) as unknown as Response;

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    assert.strictEqual(generateResult?.phase, "complete");
    assert.strictEqual(generateResult?.generatedManifest, "system: x");
    assert.strictEqual(result.current.earlyManifest, "early: x");
    assert.strictEqual(cancelled, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a new generate() clears the previous run's earlyManifest", async () => {
  // Run 1 delivers an early manifest; run 2 never does. The stale early
  // manifest must not leak into run 2 (the pages early-enable Next on it).
  let call = 0;
  global.fetch = async () => {
    call++;
    const lines =
      call === 1
        ? [
            '{"type":"manifest","yaml":"early: run1","contextCount":1,"portCount":0,"adapterCount":0,"transactionId":""}',
            '{"type":"done","yaml":"final: run1"}',
          ]
        : ['{"type":"done","yaml":"final: run2"}'];
    return {
      ok: true,
      status: 200,
      body: createMockReadableStream(lines),
    } as unknown as Response;
  };

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );

    await act(async () => {
      await result.current.generate({ description: "run 1" });
    });
    assert.strictEqual(result.current.earlyManifest, "early: run1");

    await act(async () => {
      await result.current.generate({ description: "run 2" });
    });
    assert.strictEqual(result.current.earlyManifest, null);
    assert.strictEqual(result.current.generatedManifest, "final: run2");
  } finally {
    global.fetch = originalFetch;
  }
});

test("attempts reconnection on reader error", async () => {
  let fetchCount = 0;

  global.fetch = async () => {
    fetchCount++;
    if (fetchCount === 1) {
      return {
        ok: true,
        body: new ReadableStream({
          pull() {
            throw new Error("Connection lost");
          },
        }),
      } as unknown as Response;
    }
    return {
      ok: true,
      body: createMockReadableStream(['{"type":"done","yaml":"test"}']),
    } as unknown as Response;
  };

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );
    let generateResult:
      | Awaited<ReturnType<typeof result.current.generate>>
      | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: "test" });
    });

    assert.strictEqual(fetchCount, 2);
    assert.strictEqual(generateResult?.phase, "complete");
  } finally {
    global.fetch = originalFetch;
  }
});

test("an abort mid-stream never reconnects — no backoff timers outlive unmount (#723)", async () => {
  // The counterpart to "attempts reconnection on reader error": that one proves
  // a genuinely lost connection is retried, this one proves an ABORT is not.
  // An aborted body errors the pending read(), which used to land in the same
  // catch and start a reconnect — so unmounting mid-stream refetched a run
  // nobody was watching and left the 1s/2s/4s backoff timers running with it.
  vi.useFakeTimers();
  let fetchCount = 0;
  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      controller.enqueue(
        encoder.encode(
          '{"type":"stage-start","stage":6,"label":"Validation Review"}\n',
        ),
      );
      // Held open: the run is parked on the next read() when the abort lands.
    },
  });

  global.fetch = (async (_input: unknown, init?: RequestInit) => {
    fetchCount++;
    const signal = init?.signal ?? undefined;
    if (signal) {
      // What a real aborted fetch body does: the pending read() rejects.
      const abortBody = () => {
        streamController.error(new DOMException("aborted", "AbortError"));
      };
      if (signal.aborted) {
        abortBody();
      } else {
        signal.addEventListener("abort", abortBody, { once: true });
      }
    }
    if (fetchCount > 1) {
      // A reconnect attempt must never get this far; if it does, fail loudly
      // rather than letting the run "succeed" and hide the extra request.
      return {
        ok: false,
        status: 500,
        text: async () => "reconnected after abort",
      } as unknown as Response;
    }
    return { ok: true, body: stream } as unknown as Response;
  }) as typeof fetch;

  try {
    const { result, unmount } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );

    let generatePromise!: ReturnType<typeof result.current.generate>;
    await act(async () => {
      generatePromise = result.current.generate({ description: "test" });
      // Let the fetch resolve and Stage 6 start; generate() stays parked on the
      // next read() because the stream is held open.
      await vi.advanceTimersByTimeAsync(0);
    });
    assert.strictEqual(fetchCount, 1, "the run issued exactly one request");
    assert.strictEqual(result.current.phase, "stage-6");

    // Unmount mid-stream: the cleanup aborts the request, which errors the
    // parked read.
    unmount();

    let generateResult!: Awaited<typeof generatePromise>;
    await act(async () => {
      // Far enough to fire every reconnect backoff (1s, 2s, 4s) if one were
      // still being started.
      await vi.advanceTimersByTimeAsync(30_000);
      generateResult = await generatePromise;
    });

    assert.strictEqual(
      fetchCount,
      1,
      "an aborted stream must not reconnect — no request may outlive the abort",
    );
    // The aborted run resolves on its idle contract, not as a failure. Its
    // REACT state is deliberately not asserted: an unmounted hook never
    // re-renders, so `result.current` is frozen at its last committed render
    // and says nothing about how the run ended.
    assert.strictEqual(generateResult.phase, "idle");
  } finally {
    vi.useRealTimers();
    global.fetch = originalFetch;
  }
});

test("an aborted old run does not reset the phase of the run that replaced it (#723)", async () => {
  // retry() = reset() + generate(). reset() aborts the in-flight run, whose
  // unwinding catch/finally then wrote phase "idle" and nulled abortRef over
  // whichever run had already claimed them — so a run that had COMPLETED was
  // left showing "idle", and its abort controller reference was dropped. The
  // shared state belongs to the run that owns it, not to whichever one is
  // unwinding.
  vi.useFakeTimers();
  let call = 0;
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });

  global.fetch = (async (_input: unknown, init?: RequestInit) => {
    call++;
    if (call === 1) {
      const signal = init?.signal ?? undefined;
      if (signal) {
        // A real aborted body rejects the read on a LATER task, not inside
        // abort() itself — so the old run is still unwinding after the new one
        // has already finished, which is the ordering this bug needs.
        signal.addEventListener(
          "abort",
          () => {
            setTimeout(() => {
              streamController.error(new DOMException("aborted", "AbortError"));
            }, 0);
          },
          { once: true },
        );
      }
      return { ok: true, body: stream } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      body: createMockReadableStream(['{"type":"done","yaml":"second"}']),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );

    let firstRun!: ReturnType<typeof result.current.generate>;
    await act(async () => {
      firstRun = result.current.generate({ description: "run 1" });
      await vi.advanceTimersByTimeAsync(0);
    });
    assert.strictEqual(call, 1);
    assert.strictEqual(result.current.phase, "stage-0");

    // retry() aborts run 1 and starts run 2, which completes on microtasks
    // alone (no timers), so the new run's terminal frame lands first.
    let retryPromise!: Promise<void>;
    await act(async () => {
      retryPromise = result.current.retry();
      // A rejected retry must not become an unhandled rejection mid-test.
      retryPromise.catch(() => {});
      await retryPromise;
    });
    assert.strictEqual(call, 2, "retry issued exactly one new request");
    assert.strictEqual(result.current.generatedManifest, "second");
    assert.strictEqual(result.current.phase, "complete");

    // NOW the superseded run's aborted body surfaces and it unwinds for real.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
      await firstRun;
    });

    // The assertions: run 2 owns the state and must still be showing it. Today
    // the old run's catch/finally land last and reset the phase to "idle".
    assert.strictEqual(result.current.phase, "complete");
    assert.strictEqual(result.current.generatedManifest, "second");
    assert.strictEqual(
      result.current.stepDetail,
      "Manifest generation complete",
      "the completed run's own step detail survives the old run's unwind",
    );
  } finally {
    vi.useRealTimers();
    global.fetch = originalFetch;
  }
});

test("a run's reconnect carries THAT run's signal, never the next run's (#723)", async () => {
  // The signal half of the backoff bug. attemptReconnect read
  // `abortRef.current?.signal`, and by the time a backoff expires that ref
  // belongs to whatever run started most recently — so a parked run reconnected
  // on a DIFFERENT run's authority, and once that run finished (its finally
  // nulled the ref) the request went out with no signal at all: nothing could
  // cancel it. The signal a run reconnects on must be the one it started with.
  vi.useFakeTimers();
  const signals: (AbortSignal | null | undefined)[] = [];
  let call = 0;

  global.fetch = (async (_input: unknown, init?: RequestInit) => {
    call++;
    signals.push(init?.signal ?? undefined);
    if (call === 1) {
      return {
        ok: true,
        body: new ReadableStream({
          pull() {
            throw new Error("Connection lost");
          },
        }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      body: createMockReadableStream(['{"type":"done","yaml":"run"}']),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );

    // Run 1 loses its connection and parks in the 1s backoff (no timer advance).
    let firstRun!: ReturnType<typeof result.current.generate>;
    await act(async () => {
      firstRun = result.current.generate({ description: "run 1" });
    });
    assert.strictEqual(call, 1);
    assert.ok(signals[0], "the first request carries its own signal");

    // Run 2 starts (nothing aborts run 1 on a bare generate — a bare supersede
    // is not a cancellation) and completes, nulling the ref on its way out.
    let secondRun!: ReturnType<typeof result.current.generate>;
    await act(async () => {
      secondRun = result.current.generate({ description: "run 2" });
      secondRun.catch(() => {});
      await secondRun;
    });
    assert.strictEqual(call, 2);

    // The parked run's backoff now expires and it reconnects.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await firstRun.catch(() => {});
    });

    assert.strictEqual(call, 3, "the parked run did reconnect");
    assert.strictEqual(
      signals[2],
      signals[0],
      "the reconnect must ride run 1's own signal",
    );
    assert.notStrictEqual(
      signals[2],
      signals[1],
      "and never the newer run's signal",
    );
    assert.ok(signals[2], "nor a missing signal once the ref is null");
  } finally {
    vi.useRealTimers();
    global.fetch = originalFetch;
  }
});

test("a superseded run whose backoff expires never reconnects at all (#723)", async () => {
  // attemptReconnect used to pass `signal: abortRef.current?.signal` — whatever
  // run held the ref when the backoff WOKE, not the run that is backing off.
  // So a run parked in backoff while retry() replaced it came back to life on
  // the new run's live signal (or, once the new run finished, on no signal at
  // all): a zombie read loop racing the live run for the same endpoint. Each
  // run must abort only itself.
  vi.useFakeTimers();
  let call = 0;

  global.fetch = (async () => {
    call++;
    if (call === 1) {
      return {
        ok: true,
        body: new ReadableStream({
          pull() {
            throw new Error("Connection lost");
          },
        }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      body: createMockReadableStream(['{"type":"done","yaml":"second"}']),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    const { result } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );

    // Run 1 loses its connection and parks in the 1s backoff. No timer is
    // advanced yet, so it stays there.
    let firstRun!: ReturnType<typeof result.current.generate>;
    await act(async () => {
      firstRun = result.current.generate({ description: "run 1" });
    });
    assert.strictEqual(call, 1);

    // retry() = reset() + generate(): reset() aborts run 1, and run 2 claims
    // the ref. Run 2 completes on microtasks alone.
    let retryPromise!: Promise<void>;
    await act(async () => {
      retryPromise = result.current.retry();
      // A rejected retry must not become an unhandled rejection mid-test.
      retryPromise.catch(() => {});
      await retryPromise;
    });
    assert.strictEqual(call, 2);
    assert.strictEqual(result.current.phase, "complete");

    // Now let the superseded run's backoff expire. It must find its OWN signal
    // aborted and stop — instead of today, where it wakes on run 2's dead/null
    // signal and fires a third request.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await firstRun;
    });

    assert.strictEqual(
      call,
      2,
      "a superseded run must not reconnect once its own abort landed",
    );
    assert.strictEqual(result.current.phase, "complete");
  } finally {
    vi.useRealTimers();
    global.fetch = originalFetch;
  }
});

test("an abort during the reconnect backoff ends it immediately — no further tiers (#723)", async () => {
  // An abort that lands WHILE the backoff sleeps still let the timer fire and
  // the next fetch fail with an AbortError, which the catch counted as a
  // reconnect failure: it climbed to the next tier, so 1s/2s/4s timers stayed
  // alive for about 7 seconds after the component was gone. An AbortError is
  // the abort, not a lost connection.
  vi.useFakeTimers();
  let call = 0;

  global.fetch = (async () => {
    call++;
    if (call === 1) {
      return {
        ok: true,
        body: new ReadableStream({
          pull() {
            throw new Error("Connection lost");
          },
        }),
      } as unknown as Response;
    }
    // What a fetch against a dead signal does. Today the backoff reads this as
    // "connection still lost" and tries again at 2s, then 4s.
    return Promise.reject(
      new DOMException("This operation was aborted", "AbortError"),
    );
  }) as typeof fetch;

  try {
    const { result, unmount } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );

    let run!: ReturnType<typeof result.current.generate>;
    await act(async () => {
      run = result.current.generate({ description: "test" });
    });
    assert.strictEqual(call, 1, "parked in the first backoff tier");

    // Unmount while the backoff is still sleeping.
    unmount();

    await act(async () => {
      // Enough time for every remaining tier to have fired.
      await vi.advanceTimersByTimeAsync(60_000);
    });

    assert.strictEqual(
      call,
      1,
      "an abort during backoff must issue no further request",
    );
    // The run's own result is the observable contract here; the hook's React
    // state is frozen at its last render because the component is gone.
    let runResult!: Awaited<typeof run>;
    await act(async () => {
      runResult = await run;
    });
    assert.strictEqual(runResult.phase, "idle");
  } finally {
    vi.useRealTimers();
    global.fetch = originalFetch;
  }
});

test("unmounting mid-stream aborts the in-flight request (review fix)", async () => {
  // Early-enable makes unmount-mid-stream a routine path: the user can
  // navigate away on the `manifest` frame while Stage 6/7 still stream.
  // Without the unmount cleanup the read loop and its inactivity watchdog
  // keep running until the server closes the stream.
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      controller.enqueue(
        encoder.encode(
          '{"type":"manifest","yaml":"early: x","contextCount":1,"portCount":0,"adapterCount":0,"transactionId":""}\n',
        ),
      );
      // Deliberately no close — the server is still streaming Stage 6/7.
    },
  });
  let capturedSignal: AbortSignal | undefined;
  global.fetch = (async (_input: unknown, init?: RequestInit) => {
    capturedSignal = init?.signal ?? undefined;
    return { ok: true, body: stream } as unknown as Response;
  }) as typeof fetch;

  try {
    const { result, unmount } = renderHook(() =>
      useStagedGenerationStream({ endpoint: "/api/test", stageLabels: {} }),
    );

    let generatePromise!: ReturnType<typeof result.current.generate>;
    await act(async () => {
      generatePromise = result.current.generate({ description: "test" });
      // Let the fetch resolve and the manifest frame land; the stream stays
      // open, so generate() is still parked on the next read().
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.strictEqual(result.current.earlyManifest, "early: x");
    assert.ok(capturedSignal, "the request carries the hook's abort signal");
    assert.strictEqual(capturedSignal.aborted, false);

    unmount();
    assert.strictEqual(
      capturedSignal.aborted,
      true,
      "unmount must abort the in-flight request",
    );

    // Wind the parked read loop down cleanly: the aborted run resolves
    // without surfacing a failure (the hook's aborted-run contract).
    streamController.close();
    const generateResult = await generatePromise;
    assert.notStrictEqual(generateResult.phase, "failed");
  } finally {
    global.fetch = originalFetch;
  }
});
