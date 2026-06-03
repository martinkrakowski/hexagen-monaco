// JSDOM globals must exist before @testing-library/react is imported.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
});
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document as unknown as Document;
global.localStorage = dom.window.localStorage;

import { describe, it, afterEach, mock } from "node:test";
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
  globalThis.fetch = mock.fn(async () =>
    ndjsonResponse(events),
  ) as unknown as typeof fetch;
}

describe("useStagedManifestGeneration (cloud path)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.reset();
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
