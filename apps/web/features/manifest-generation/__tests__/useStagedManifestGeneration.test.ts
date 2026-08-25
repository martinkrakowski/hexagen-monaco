import { describe, it, afterEach, vi } from "vitest";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";
import { useStagedManifestGeneration } from "../useStagedManifestGeneration";

// These tests exercise the cloud path, which runs through useStagedGenerationStream
// -> fetch(). Mocking the global fetch with a streamed NDJSON Response lets us drive
// the whole hook deterministically without module mocking. The local WebLLM path
// (getClientManifestGenerationUseCase) would need module mocking and is not covered
// here.
type StreamEvent = Record<string, unknown>;

function ndjsonResponse(events: StreamEvent[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}

function mockFetchWith(events: StreamEvent[]) {
  globalThis.fetch = vi.fn(async () =>
    ndjsonResponse(events),
  ) as unknown as typeof fetch;
}

describe("useStagedManifestGeneration (cloud path)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("mirrors an in-stream failure into generationError", async () => {
    // Regression: the staged stream resolves (it does not throw) on an
    // NDJSON {type:"error"} event, so the cloud branch must set generationError
    // itself. Otherwise GenerateWithAi's `!generationError` guard never flips and
    // the generating screen is stuck blank with no retry UI.
    mockFetchWith([{ type: "error", message: "boom" }]);
    const { result } = renderHook(() => useStagedManifestGeneration());

    await act(async () => {
      await result.current.generateManifest("build a todo app", {
        preferLocal: false,
      });
    });

    assert.strictEqual(result.current.phase, "failed");
    assert.strictEqual(result.current.generationError, "boom");
  });

  it("surfaces a stream that dies without a terminal frame as a failed run", async () => {
    // The prompt flow's true forever-hang: GenerateWithAi gates its generating
    // screen only on generationError, so a stream that ends mid-run with no
    // done/error frame used to park it in "generating" indefinitely. The
    // stream hook's terminal-frame accounting now fails the run; this hook
    // must propagate that into generationError so the Try Again card renders.
    mockFetchWith([{ type: "stage-start", stage: 2, label: "Contexts" }]);
    const { result } = renderHook(() => useStagedManifestGeneration());

    await act(async () => {
      await result.current.generateManifest("build a todo app", {
        preferLocal: false,
      });
    });

    assert.strictEqual(result.current.phase, "failed");
    assert.match(result.current.generationError || "", /ended unexpectedly/i);
  });

  it("maps a successful cloud generation into state", async () => {
    mockFetchWith([
      { type: "stage-start", stage: 0, label: "Prompt Normalization" },
      {
        type: "done",
        yaml: "workspace:\n  name: x\n",
        contextCount: 3,
        portCount: 5,
        adapterCount: 2,
        transactionId: "t",
      },
    ]);
    const { result } = renderHook(() => useStagedManifestGeneration());

    await act(async () => {
      await result.current.generateManifest("desc", { preferLocal: false });
    });

    assert.strictEqual(result.current.phase, "complete");
    assert.strictEqual(
      result.current.generatedManifest,
      "workspace:\n  name: x\n",
    );
    assert.strictEqual(result.current.contextCount, 3);
    assert.strictEqual(result.current.portCount, 5);
    assert.strictEqual(result.current.adapterCount, 2);
    assert.strictEqual(result.current.generationError, null);
  });

  it("puts tenantId on the cloud generate body so telemetry can follow the org", async () => {
    mockFetchWith([
      {
        type: "done",
        yaml: "workspace: {}\n",
        contextCount: 1,
        portCount: 0,
        adapterCount: 0,
        transactionId: "t",
      },
    ]);
    const { result } = renderHook(() => useStagedManifestGeneration());

    await act(async () => {
      await result.current.generateManifest("desc", {
        preferLocal: false,
        tenantId: "org-acme",
      });
    });

    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { tenantId?: string };
    assert.equal(body.tenantId, "org-acme");
  });

  it("accumulates streamed chunks into the verbose log", async () => {
    mockFetchWith([
      { type: "stage-start", stage: 1, label: "Domain Extraction" },
      { type: "chunk", stage: 1, data: "hello " },
      { type: "chunk", stage: 1, data: "world" },
      {
        type: "done",
        yaml: "workspace: {}\n",
        contextCount: 1,
        portCount: 0,
        adapterCount: 0,
        transactionId: "t",
      },
    ]);
    const { result } = renderHook(() => useStagedManifestGeneration());

    await act(async () => {
      await result.current.generateManifest("desc", { preferLocal: false });
    });

    const log = result.current.verboseLog.join("\n");
    assert.match(log, /Stage 1/);
    // Both chunks are joined into continuous text — including the final chunk,
    // which can arrive in the same React batch as the "done" event.
    assert.match(log, /hello world/);
  });

  it("exposes the done event's Stage-6 `validation` report as validationReport", async () => {
    // The /stage route now mirrors /spec by attaching the Stage-6 report to
    // its done event; this hook previously dropped it even though the stream
    // hook parsed it (plan §3.5 — /stage route parity).
    mockFetchWith([
      { type: "stage-start", stage: 6, label: "Validation Review" },
      {
        type: "done",
        yaml: "workspace:\n  name: x\n",
        contextCount: 1,
        portCount: 1,
        adapterCount: 1,
        transactionId: "t",
        validation: {
          errors: ["[R02] Context 'billing' has no inbound port."],
          warnings: ["Consider a query port for reads."],
          passed: false,
        },
      },
    ]);
    const { result } = renderHook(() => useStagedManifestGeneration());

    await act(async () => {
      await result.current.generateManifest("desc", { preferLocal: false });
    });

    assert.strictEqual(result.current.phase, "complete");
    assert.deepStrictEqual(result.current.validationReport, {
      errors: ["[R02] Context 'billing' has no inbound port."],
      warnings: ["Consider a query port for reads."],
      passed: false,
    });
  });

  it("leaves validationReport null when the done event omits `validation` (older payloads)", async () => {
    // `validation` is optional/additive on the NDJSON contract — a server
    // without it must not break or fake a report.
    mockFetchWith([
      {
        type: "done",
        yaml: "workspace:\n  name: x\n",
        contextCount: 1,
        portCount: 0,
        adapterCount: 0,
        transactionId: "t",
      },
    ]);
    const { result } = renderHook(() => useStagedManifestGeneration());

    await act(async () => {
      await result.current.generateManifest("desc", { preferLocal: false });
    });

    assert.strictEqual(result.current.phase, "complete");
    assert.strictEqual(result.current.validationReport, null);
  });

  it("reset() clears validationReport", async () => {
    mockFetchWith([
      {
        type: "done",
        yaml: "workspace:\n  name: x\n",
        contextCount: 1,
        portCount: 0,
        adapterCount: 0,
        transactionId: "t",
        validation: { errors: [], warnings: ["w"], passed: true },
      },
    ]);
    const { result } = renderHook(() => useStagedManifestGeneration());

    await act(async () => {
      await result.current.generateManifest("desc", { preferLocal: false });
    });
    assert.ok(result.current.validationReport);

    act(() => {
      result.current.reset();
    });

    assert.strictEqual(result.current.validationReport, null);
  });

  it("exposes the stream's early Stage-5 manifest and KEEPS it after completion (repair-diff seam, Part B-lite)", async () => {
    // The early `manifest` frame arrives mid-run; `done` then carries a
    // DIFFERENT yaml (Stage-7 repair). earlyManifest must survive completion —
    // GenerateWithAi compares it against the final manifest to show the
    // "updated by validation repair" note. This also pins the last-batch
    // hazard: the frame can land in the same React batch as `done`, so the
    // mirror must not be gated on isGenerating.
    mockFetchWith([
      {
        type: "manifest",
        yaml: "early: x\n",
        contextCount: 1,
        portCount: 1,
        adapterCount: 1,
        transactionId: "",
      },
      {
        type: "done",
        yaml: "repaired: x\n",
        contextCount: 1,
        portCount: 1,
        adapterCount: 1,
        transactionId: "t",
      },
    ]);
    const { result } = renderHook(() => useStagedManifestGeneration());

    await act(async () => {
      await result.current.generateManifest("desc", { preferLocal: false });
    });

    assert.strictEqual(result.current.phase, "complete");
    assert.strictEqual(result.current.earlyManifest, "early: x\n");
    assert.strictEqual(result.current.generatedManifest, "repaired: x\n");
  });

  it("a new run clears the previous run's earlyManifest; reset() clears it too", async () => {
    mockFetchWith([
      {
        type: "manifest",
        yaml: "early: run1\n",
        contextCount: 1,
        portCount: 0,
        adapterCount: 0,
        transactionId: "",
      },
      { type: "done", yaml: "final: run1\n", transactionId: "t1" },
    ]);
    const { result } = renderHook(() => useStagedManifestGeneration());

    await act(async () => {
      await result.current.generateManifest("run 1", { preferLocal: false });
    });
    assert.strictEqual(result.current.earlyManifest, "early: run1\n");

    // Run 2 never emits a manifest frame — the stale early manifest from run 1
    // must not leak (the pages would early-enable Next on it).
    mockFetchWith([
      { type: "done", yaml: "final: run2\n", transactionId: "t2" },
    ]);
    await act(async () => {
      await result.current.generateManifest("run 2", { preferLocal: false });
    });
    assert.strictEqual(result.current.earlyManifest, null);

    // And reset() clears it after a run that did set it.
    mockFetchWith([
      {
        type: "manifest",
        yaml: "early: run3\n",
        contextCount: 1,
        portCount: 0,
        adapterCount: 0,
        transactionId: "",
      },
      { type: "done", yaml: "final: run3\n", transactionId: "t3" },
    ]);
    await act(async () => {
      await result.current.generateManifest("run 3", { preferLocal: false });
    });
    assert.strictEqual(result.current.earlyManifest, "early: run3\n");
    act(() => {
      result.current.reset();
    });
    assert.strictEqual(result.current.earlyManifest, null);
  });

  it("reset() clears generationError, verboseLog and phase", async () => {
    mockFetchWith([{ type: "error", message: "boom" }]);
    const { result } = renderHook(() => useStagedManifestGeneration());

    await act(async () => {
      await result.current.generateManifest("desc", { preferLocal: false });
    });
    assert.strictEqual(result.current.generationError, "boom");

    act(() => {
      result.current.reset();
    });

    assert.strictEqual(result.current.generationError, null);
    assert.deepStrictEqual(result.current.verboseLog, []);
    assert.strictEqual(result.current.phase, "idle");
  });
});
