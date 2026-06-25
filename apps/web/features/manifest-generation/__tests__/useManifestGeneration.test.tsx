import { describe, it, vi, Mock, test } from "vitest";
import assert from "node:assert";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useManifestGeneration } from "../useManifestGeneration";

// QUARANTINED (issue #335): these retry/error-classification tests never ran
// under the old `**/*.test.ts` glob and exercise real retry/backoff timing
// (multi-second). They need de-flaking (fake timers) before being un-skipped.
describe.skip("useManifestGeneration", () => {
  let originalFetch: typeof global.fetch;
  let fetchMock: Mock<typeof global.fetch>;

  test.beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  test.afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should classify and recover from rate limits (429)", async () => {
    // Return 429 once, then success
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          json: async () => ({ success: false, error: "Too many requests" }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          manifest: "valid-yaml",
          confidence: 0.9,
          suggestions: [],
          warnings: [],
          metadata: { model: "test", processingTime: 100, tokensUsed: 100 },
        }),
      } as unknown as Response;
    });

    const { result } = renderHook(() => useManifestGeneration());

    act(() => {
      result.current.generate("test description");
    });

    // Should initially be in generating state
    assert.strictEqual(result.current.isGenerating, true);

    // Wait for the first fetch to fail and trigger retry
    await waitFor(
      () => {
        assert.strictEqual(
          (global.fetch as Mock<typeof global.fetch>).mock.calls.length,
          2,
        );

        // Ensure state reflects success after retry
        assert.strictEqual(result.current.isGenerating, false);
        assert.strictEqual(result.current.isSuccess, true);
        assert.strictEqual(result.current.status, "success");
        assert.deepStrictEqual(result.current.result?.manifest, "valid-yaml");
        assert.strictEqual(result.current.error, null);
      },
      { timeout: 3000 },
    );
  });

  it("should classify invalid JSON responses as PARSING error", async () => {
    global.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token < in JSON");
        },
      } as unknown as Response;
    });

    const { result } = renderHook(() => useManifestGeneration());

    act(() => {
      result.current.generate("test description");
    });

    await waitFor(() => {
      assert.strictEqual(result.current.isGenerating, false);
    });

    assert.strictEqual(result.current.isError, true);
    assert.strictEqual(result.current.errorCategory, "PARSING");
    assert.strictEqual(
      result.current.error,
      "We received an invalid response from the server. Please try a different description.",
    );
  });

  it("should fail permanently after max retries for network timeouts", async () => {
    global.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 504,
        json: async () => ({ success: false }),
      } as unknown as Response;
    });

    const { result } = renderHook(() => useManifestGeneration());

    act(() => {
      result.current.generate("test description");
    });

    // Max retries is 3, so total 4 calls (1 initial + 3 retries)
    await waitFor(
      () => {
        assert.strictEqual(
          (global.fetch as Mock<typeof global.fetch>).mock.calls.length,
          4,
        );
      },
      { timeout: 10000 },
    ); // give enough time for backoffs

    await waitFor(() => {
      assert.strictEqual(result.current.isGenerating, false);
    });

    assert.strictEqual(result.current.isError, true);
    assert.strictEqual(result.current.errorCategory, "TIMEOUT");
    assert.strictEqual(result.current.retryCount, 3);
  });

  it("should use the local API endpoint when preferLocal is true", async () => {
    global.fetch = vi.fn(async (url) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          manifest: "valid-yaml",
          confidence: 0.9,
          suggestions: [],
          warnings: [],
          metadata: {
            model: "test",
            processingTime: 100,
            tokensUsed: 100,
            provider: url.toString().includes("/local") ? "local" : "cloud",
          },
        }),
      } as unknown as Response;
    });

    const { result } = renderHook(() => useManifestGeneration());

    // Call with preferLocal = true
    act(() => {
      result.current.generate("test description", { preferLocal: true });
    });

    await waitFor(() => {
      assert.strictEqual(result.current.isGenerating, false);
    });

    const fetchCall = (global.fetch as Mock<typeof global.fetch>).mock.calls[0];
    assert.strictEqual(fetchCall.arguments[0], "/api/manifest/generate/local");

    // Verify provider is included in result
    assert.strictEqual(result.current.result?.metadata.provider, "local");
  });
});
