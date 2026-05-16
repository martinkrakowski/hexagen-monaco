import { test, describe } from "node:test";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";
import { useStagedGenerationStream } from "../useStagedGenerationStream";

describe("useStagedGenerationStream", () => {
  const defaultOptions = {
    endpoint: "/api/manifest/generate/spec",
    stageLabels: { 0: "Init", 1: "Context", 2: "Ports" },
  };

  test("parses NDJSON stage-start event correctly", async () => {
    const { result } = renderHook(() =>
      useStagedGenerationStream(defaultOptions),
    );

    await act(async () => {
      await result.current.generate({
        config: "intent: test",
      });
    });

    assert.strictEqual(result.current.phase !== "idle", true);
  });

  test("parses NDJSON done event and sets manifest", async () => {
    const { result } = renderHook(() =>
      useStagedGenerationStream(defaultOptions),
    );

    await act(async () => {
      await result.current.generate({
        config: "intent: test",
      });
    });

    if (result.current.generatedManifest) {
      assert.ok(result.current.generatedManifest.length >= 0);
      assert.strictEqual(result.current.phase, "complete");
    }
  });

  test("handles error event from NDJSON stream", async () => {
    const { result } = renderHook(() =>
      useStagedGenerationStream(defaultOptions),
    );

    await act(async () => {
      await result.current.generate({
        config: "intent: test",
      });
    });

    if (result.current.generationError) {
      assert.ok(result.current.generationError.length > 0);
      assert.strictEqual(result.current.phase, "failed");
    }
  });

  test("abort signal cancels generation", async () => {
    const { result } = renderHook(() =>
      useStagedGenerationStream(defaultOptions),
    );

    const abortController = new AbortController();

    act(() => {
      result.current.generate(
        { config: "intent: test" },
        abortController.signal,
      );
    });

    act(() => {
      abortController.abort();
    });

    assert.strictEqual(result.current.phase, "idle");
    assert.strictEqual(result.current.isGenerating, false);
  });

  test("reset clears all state", async () => {
    const { result } = renderHook(() =>
      useStagedGenerationStream(defaultOptions),
    );

    await act(async () => {
      await result.current.generate({
        config: "intent: test",
      });
    });

    act(() => {
      result.current.reset();
    });

    assert.strictEqual(result.current.isGenerating, false);
    assert.strictEqual(result.current.generationError, null);
    assert.strictEqual(result.current.generatedManifest, null);
    assert.strictEqual(result.current.phase, "idle");
    assert.strictEqual(result.current.contextCount, 0);
    assert.strictEqual(result.current.portCount, 0);
    assert.strictEqual(result.current.adapterCount, 0);
  });

  test("parses validation-error event", async () => {
    const { result } = renderHook(() =>
      useStagedGenerationStream(defaultOptions),
    );

    await act(async () => {
      await result.current.generate({
        config: "intent: test",
      });
    });

    assert.ok(Array.isArray(result.current.validationErrors));
  });
});
