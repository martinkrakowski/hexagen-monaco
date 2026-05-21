import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
});

Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true, writable: true },
  document: { value: dom.window.document, configurable: true, writable: true },
  Event: { value: dom.window.Event, configurable: true, writable: true },
  CustomEvent: {
    value: dom.window.CustomEvent,
    configurable: true,
    writable: true,
  },
});

import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";

import { useLooseSpecConversion } from "../useLooseSpecConversion.ts";

describe("useLooseSpecConversion", () => {
  it("Local path success", async () => {
    const mockUseCase = {
      execute: mock.fn(async () => {
        return { success: true, value: { configJson: '{"local": true}' } };
      }),
    };

    const deps = {
      getClientUseCase: () =>
        mockUseCase as unknown as ReturnType<
          typeof getClientLooseSpecConversionUseCase
        >,
      isLocalLLMReady: () => true,
      hasServerLLMAccessKey: () => false,
      fetchClient: mock.fn(),
    };

    const { result } = renderHook(() => useLooseSpecConversion(deps));

    let convertResult;
    await act(async () => {
      convertResult = await result.current.convert("local spec");
    });

    assert.strictEqual(mockUseCase.execute.mock.calls.length, 1);
    assert.strictEqual(deps.fetchClient.mock.calls.length, 0);
    assert.strictEqual(convertResult?.convertedConfig, '{"local": true}');
    assert.strictEqual(convertResult?.error, null);
    assert.strictEqual(result.current.convertedConfig, '{"local": true}');
    assert.strictEqual(result.current.isConverting, false);
    assert.strictEqual(result.current.error, null);
  });

  it("Cloud path success", async () => {
    const mockFetch = mock.fn(async () => {
      return {
        ok: true,
        body: {
          getReader: () => {
            let done = false;
            return {
              read: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                return {
                  done: false,
                  value: new TextEncoder().encode(
                    '{"type":"done","configJson":"{\\"cloud\\": true}"}\n',
                  ),
                };
              },
              cancel: mock.fn(),
            };
          },
        },
      };
    });

    const deps = {
      getClientUseCase: () => {
        throw new Error("Should not be called");
      },
      isLocalLLMReady: () => false,
      hasServerLLMAccessKey: () => true,
      fetchClient: mockFetch as unknown as typeof fetch,
    };

    const { result } = renderHook(() => useLooseSpecConversion(deps));

    let convertResult;
    await act(async () => {
      convertResult = await result.current.convert("cloud spec");
    });

    assert.strictEqual(mockFetch.mock.calls.length, 1);
    assert.strictEqual(convertResult?.convertedConfig, '{"cloud": true}');
    assert.strictEqual(convertResult?.error, null);
  });

  it("Local failure with cloud fallback", async () => {
    const mockUseCase = {
      execute: mock.fn(async () => {
        return { success: false, error: new Error("Local LLM failed") };
      }),
    };

    const mockFetch = mock.fn(async () => {
      return {
        ok: true,
        body: {
          getReader: () => {
            let done = false;
            return {
              read: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                return {
                  done: false,
                  value: new TextEncoder().encode(
                    '{"type":"done","configJson":"{\\"fallback\\": true}"}\n',
                  ),
                };
              },
              cancel: mock.fn(),
            };
          },
        },
      };
    });

    const deps = {
      getClientUseCase: () =>
        mockUseCase as unknown as ReturnType<
          typeof getClientLooseSpecConversionUseCase
        >,
      isLocalLLMReady: () => true,
      hasServerLLMAccessKey: () => true, // Cloud is available for fallback
      fetchClient: mockFetch as unknown as typeof fetch,
    };

    const { result } = renderHook(() => useLooseSpecConversion(deps));

    let convertResult;
    await act(async () => {
      convertResult = await result.current.convert("fallback spec");
    });

    assert.strictEqual(mockUseCase.execute.mock.calls.length, 1);
    assert.strictEqual(mockFetch.mock.calls.length, 1);
    assert.strictEqual(convertResult?.convertedConfig, '{"fallback": true}');
    assert.strictEqual(convertResult?.error, null);
  });

  it("Abort signal honoured", async () => {
    const controller = new AbortController();

    const mockUseCase = {
      execute: mock.fn(async () => {
        // simulate long task
        await new Promise((r) => setTimeout(r, 100));
        return { success: true, value: { configJson: '{"never": true}' } };
      }),
    };

    const deps = {
      getClientUseCase: () =>
        mockUseCase as unknown as ReturnType<
          typeof getClientLooseSpecConversionUseCase
        >,
      isLocalLLMReady: () => true,
      hasServerLLMAccessKey: () => false,
      fetchClient: mock.fn(),
    };

    const { result } = renderHook(() => useLooseSpecConversion(deps));

    let convertPromise;
    act(() => {
      convertPromise = result.current.convert("abort spec", {
        signal: controller.signal,
      });
    });

    // abort immediately
    controller.abort();

    let convertResult;
    await act(async () => {
      convertResult = await convertPromise;
    });

    assert.strictEqual(convertResult?.convertedConfig, null);
    assert.strictEqual(convertResult?.error, "Aborted");
  });
});
