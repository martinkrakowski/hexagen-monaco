import { test, vi } from "vitest";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";
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

  global.fetch = async (input: RequestInfo, init?: RequestInit) => {
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

    const generateResult = await generatePromise!;
    assert.strictEqual(generateResult.phase, "idle");
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
