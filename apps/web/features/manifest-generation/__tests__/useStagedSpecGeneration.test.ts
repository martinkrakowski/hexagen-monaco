import { test, describe, vi } from "vitest";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";
import {
  resolveExecutionStrategy,
  useStagedSpecGeneration,
} from "../useStagedSpecGeneration.ts";

// The hook resolves its engine through wire.client; stub it to the cloud path
// so retry tests exercise the streaming fetch (no WebLLM in jsdom).
vi.mock("../../../app/lib/wire.client", () => ({
  getClientSpecGenerationUseCase: () => {
    throw new Error("local path must not run in these tests");
  },
  isLocalLLMReady: () => false,
  hasServerLLMAccessKey: () => true,
}));

describe("resolveExecutionStrategy", () => {
  test("returns local when strategy is local and hasLocalLLM is true", () => {
    assert.strictEqual(resolveExecutionStrategy("local", true, false), "local");
  });

  test("returns none when strategy is local and hasLocalLLM is false", () => {
    assert.strictEqual(resolveExecutionStrategy("local", false, true), "none");
  });

  test("returns cloud when strategy is cloud and hasCloudKeys is true", () => {
    assert.strictEqual(resolveExecutionStrategy("cloud", false, true), "cloud");
  });

  test("returns none when strategy is cloud and hasCloudKeys is false", () => {
    assert.strictEqual(resolveExecutionStrategy("cloud", true, false), "none");
  });

  test("auto: prioritizes cloud when both capabilities present", () => {
    // Cloud-first: the server pipeline finishes in seconds; a loaded WebLLM
    // model must not silently win and burn minutes before falling back.
    assert.strictEqual(resolveExecutionStrategy("auto", true, true), "cloud");
  });

  test("explicit local strategy still wins over available cloud keys", () => {
    assert.strictEqual(resolveExecutionStrategy("local", true, true), "local");
  });

  test("auto: returns local when only local LLM available", () => {
    assert.strictEqual(resolveExecutionStrategy("auto", true, false), "local");
  });

  test("auto: returns cloud when only cloud keys available", () => {
    assert.strictEqual(resolveExecutionStrategy("auto", false, true), "cloud");
  });

  test("auto: returns none when no capabilities available", () => {
    assert.strictEqual(resolveExecutionStrategy("auto", false, false), "none");
  });
});

describe("useStagedSpecGeneration retry", () => {
  test("retry re-runs the last generation end-to-end (silent stream death → retry → success)", async () => {
    const originalFetch = global.fetch;
    const bodies: string[] = [];
    let call = 0;
    global.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      call++;
      bodies.push(String(init?.body));
      const encoder = new TextEncoder();
      // First request: stream dies after stage-start (no done/error frame).
      // Second request (the retry): healthy stream with a done frame.
      const lines =
        call === 1
          ? ['{"type":"stage-start","stage":0,"label":"Config Parse"}\n']
          : [
              '{"type":"done","yaml":"retried-manifest","contextCount":1,"portCount":1,"adapterCount":1}\n',
            ];
      let i = 0;
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            if (i < lines.length) {
              controller.enqueue(encoder.encode(lines[i++]));
            } else {
              controller.close();
            }
          },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    try {
      const { result } = renderHook(() => useStagedSpecGeneration());

      await act(async () => {
        await result.current.generateFromSpec("spec: content", {
          executionStrategy: "cloud",
        });
      });

      // The dead stream surfaced as a failed state with retry copy (the
      // stream hook's terminal-frame accounting, propagated through
      // executeCloudGeneration's failed branch).
      assert.strictEqual(result.current.phase, "failed");
      assert.match(result.current.generationError || "", /ended unexpectedly/i);

      let retryResult:
        | Awaited<ReturnType<typeof result.current.retry>>
        | undefined;
      await act(async () => {
        retryResult = await result.current.retry();
      });

      assert.strictEqual(call, 2, "retry issued a second request");
      // Same body replayed — retry re-runs the LAST invocation verbatim.
      assert.deepStrictEqual(JSON.parse(bodies[1]), JSON.parse(bodies[0]));
      assert.strictEqual(retryResult?.phase, "complete");
      assert.strictEqual(result.current.generatedManifest, "retried-manifest");
      assert.strictEqual(result.current.phase, "complete");
      assert.strictEqual(result.current.generationError, null);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("exposes the stream's early Stage-5 manifest, keeps it after completion, and clears it on the next run (Part B-lite)", async () => {
    const originalFetch = global.fetch;
    const encoder = new TextEncoder();
    let call = 0;
    global.fetch = (async () => {
      call++;
      // Run 1: early manifest frame, then a done with DIFFERENT yaml (the
      // Stage-7 repaired one). Run 2: no manifest frame at all.
      const lines =
        call === 1
          ? [
              '{"type":"manifest","yaml":"early: spec\\n","contextCount":1,"portCount":1,"adapterCount":1,"transactionId":""}\n',
              '{"type":"done","yaml":"repaired: spec\\n","contextCount":1,"portCount":1,"adapterCount":1}\n',
            ]
          : ['{"type":"done","yaml":"final: run2\\n"}\n'];
      let i = 0;
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            if (i < lines.length) {
              controller.enqueue(encoder.encode(lines[i++]));
            } else {
              controller.close();
            }
          },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    try {
      const { result } = renderHook(() => useStagedSpecGeneration());

      await act(async () => {
        await result.current.generateFromSpec("spec: content", {
          executionStrategy: "cloud",
        });
      });

      // Kept after completion (repair-diff seam): the import page compares it
      // against the final manifest for the "updated by validation repair"
      // note. Also pins the last-batch hazard — the manifest frame can land
      // in the same React batch as done, so the mirror is not gated on
      // isGenerating.
      assert.strictEqual(result.current.phase, "complete");
      assert.strictEqual(result.current.earlyManifest, "early: spec\n");
      assert.strictEqual(result.current.generatedManifest, "repaired: spec\n");

      // A new run without a manifest frame must not inherit the stale one.
      await act(async () => {
        await result.current.generateFromSpec("spec: content 2", {
          executionStrategy: "cloud",
        });
      });
      assert.strictEqual(result.current.earlyManifest, null);
      assert.strictEqual(result.current.generatedManifest, "final: run2\n");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("retry with no prior run is a no-op (resolves undefined, no fetch)", async () => {
    const originalFetch = global.fetch;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { result } = renderHook(() => useStagedSpecGeneration());
      let out: unknown = "sentinel";
      await act(async () => {
        out = await result.current.retry();
      });
      assert.strictEqual(out, undefined);
      assert.strictEqual(fetchSpy.mock.calls.length, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
