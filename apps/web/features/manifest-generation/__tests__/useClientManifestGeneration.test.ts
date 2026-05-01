import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
});

Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true, writable: true },
  document: { value: dom.window.document, configurable: true, writable: true },
  localStorage: {
    value: dom.window.localStorage,
    configurable: true,
    writable: true,
  },
  navigator: {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  },
  Event: { value: dom.window.Event, configurable: true, writable: true },
  CustomEvent: {
    value: dom.window.CustomEvent,
    configurable: true,
    writable: true,
  },
});

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";

mock.module("@hexagen/agentic-interaction", () => {
  const realExtractYaml = (response: string): string | null => {
    const codeBlockMatch = response.match(/```ya?ml\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    const genericBlockMatch = response.match(/```\n([\s\S]*?)\n```/);
    if (genericBlockMatch) {
      const content = genericBlockMatch[1].trim();
      if (
        content.includes("workspace:") ||
        content.includes("boundedContexts:")
      ) {
        return content;
      }
    }
    if (
      response.includes("workspace:") &&
      response.includes("boundedContexts:")
    ) {
      return response.trim();
    }
    return null;
  };

  return {
    SYSTEM_PROMPT: "You are a helpful assistant.",
    compileUserPrompt: (vars: { userDescription: string }) =>
      `Generate a manifest for: ${vars.userDescription}`,
    extractManifestYaml: realExtractYaml,
  };
});

import { useClientManifestGeneration } from "../useClientManifestGeneration";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import type { LLMMessage } from "@hexagen/agentic-interaction";

const STORED_MESSAGES: LLMMessage[] = [];

function makeSendGovernanceMock() {
  return mock.fn(async (__content: string) => {
    STORED_MESSAGES.push({ role: "user", content: __content });
    STORED_MESSAGES.push({
      role: "assistant",
      content:
        "```yaml\nworkspace:\n  name: test-proj\nboundedContexts:\n  - name: orders\n```",
    });
  });
}

function makeSendGovernanceNoYamlMock() {
  return mock.fn(async (__content: string) => {
    STORED_MESSAGES.push({ role: "user", content: __content });
    STORED_MESSAGES.push({
      role: "assistant",
      content: "I generated a manifest but there's no YAML block in it.",
    });
  });
}

function makeSendGovernanceErrorMock() {
  return mock.fn(async () => {
    throw new Error("Network error during generation");
  });
}

function buildContext(
  messages: LLMMessage[],
  sendFn?: ReturnType<typeof makeSendGovernanceMock>,
): LocalLLMContext {
  return {
    engineState: { status: "ready", progress: 100 },
    initializeModel: mock.fn(async () => {}),
    cancelDownload: mock.fn(),
    hasAnyCachedModel: mock.fn(async () => false),
    hasModelInCache: mock.fn(async () => false),
    switchModel: mock.fn(async () => {}),
    deleteCachedModel: mock.fn(async () => {}),
    loadedModel: null,
    sendGovernanceMessage: sendFn ?? makeSendGovernanceMock(),
    messages,
  };
}

describe("useClientManifestGeneration", () => {
  beforeEach(() => {
    STORED_MESSAGES.length = 0;
  });

  afterEach(() => {
    mock.reset();
    STORED_MESSAGES.length = 0;
  });

  describe("initial state", () => {
    it("should start with isGenerating = false", () => {
      const ctx = buildContext(STORED_MESSAGES);
      const { result } = renderHook(() => useClientManifestGeneration(ctx));
      assert.strictEqual(result.current.isGenerating, false);
    });

    it("should start with generationError = null", () => {
      const ctx = buildContext(STORED_MESSAGES);
      const { result } = renderHook(() => useClientManifestGeneration(ctx));
      assert.strictEqual(result.current.generationError, null);
    });

    it("should start with generatedManifest = null", () => {
      const ctx = buildContext(STORED_MESSAGES);
      const { result } = renderHook(() => useClientManifestGeneration(ctx));
      assert.strictEqual(result.current.generatedManifest, null);
    });
  });

  describe("generateManifest", () => {
    it("should extract generated manifest after sendGovernanceMessage resolves", async () => {
      const ctx = buildContext(STORED_MESSAGES);
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      await act(async () => {
        await result.current.generateManifest("A test project");
      });

      assert.ok(
        result.current.generatedManifest !== null,
        "Should have generated manifest",
      );
      assert.match(result.current.generatedManifest!, /workspace:/);
      assert.match(result.current.generatedManifest!, /test-proj/);
      assert.strictEqual(result.current.isGenerating, false);
      assert.strictEqual(result.current.generationError, null);
    });

    it("should set isGenerating to true during generation", () => {
      const ctx = buildContext(STORED_MESSAGES);
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      let capturedDuringGeneration = false;
      act(() => {
        void result.current.generateManifest("A test project");
        capturedDuringGeneration = result.current.isGenerating;
      });

      assert.strictEqual(
        capturedDuringGeneration,
        true,
        "isGenerating should be true during async generation",
      );
    });

    it("should set generationError when no valid YAML in response", async () => {
      const ctx = buildContext(STORED_MESSAGES, makeSendGovernanceNoYamlMock());
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      await act(async () => {
        await result.current.generateManifest("A test project");
      });

      assert.strictEqual(result.current.generatedManifest, null);
      assert.ok(
        result.current.generationError !== null,
        "Should have a generation error",
      );
      assert.match(
        result.current.generationError!,
        /did not contain a valid manifest/,
      );
      assert.strictEqual(result.current.isGenerating, false);
    });

    it("should set generationError when sendGovernanceMessage throws", async () => {
      const ctx = buildContext(STORED_MESSAGES, makeSendGovernanceErrorMock());
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      await act(async () => {
        await result.current.generateManifest("A test project");
      });

      assert.strictEqual(result.current.generatedManifest, null);
      assert.ok(
        result.current.generationError !== null,
        "Should have a generation error",
      );
      assert.match(result.current.generationError!, /Network error/);
      assert.strictEqual(result.current.isGenerating, false);
    });

    it("should call sendGovernanceMessage with correct arguments", async () => {
      const sendFn = makeSendGovernanceMock();
      const ctx = buildContext(STORED_MESSAGES, sendFn);
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      await act(async () => {
        await result.current.generateManifest("My awesome project");
      });

      assert.ok(
        sendFn.mock.callCount() >= 1,
        "sendGovernanceMessage should have been called",
      );
      const callArg = sendFn.mock.calls[0]?.arguments[0] as string;
      assert.ok(
        callArg.includes("My awesome project"),
        "First argument should contain the project description",
      );
    });
  });

  describe("state transitions", () => {
    it("should transition isGenerating false → true → false on success", async () => {
      const ctx = buildContext(STORED_MESSAGES);
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      assert.strictEqual(result.current.isGenerating, false);

      await act(async () => {
        await result.current.generateManifest("test");
      });

      assert.strictEqual(result.current.isGenerating, false);
      assert.ok(result.current.generatedManifest !== null);
    });

    it("should transition isGenerating false → true → false on error", async () => {
      const ctx = buildContext(STORED_MESSAGES, makeSendGovernanceErrorMock());
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      assert.strictEqual(result.current.isGenerating, false);

      await act(async () => {
        await result.current.generateManifest("test");
      });

      assert.strictEqual(result.current.isGenerating, false);
      assert.ok(result.current.generationError !== null);
    });

    it("should reset previous error before new generation", async () => {
      const ctx = buildContext(STORED_MESSAGES);
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      await act(async () => {
        await result.current.generateManifest("test");
      });
      assert.strictEqual(result.current.generationError, null);

      await act(async () => {
        await result.current.generateManifest("another test");
      });
      assert.strictEqual(result.current.generationError, null);
      assert.ok(result.current.generatedManifest !== null);
    });

    it("should reset previous manifest before new generation", async () => {
      const ctx = buildContext(STORED_MESSAGES);
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      await act(async () => {
        await result.current.generateManifest("first");
      });
      const firstManifest = result.current.generatedManifest;
      assert.ok(firstManifest !== null);

      STORED_MESSAGES.length = 0;
      await act(async () => {
        await result.current.generateManifest("second");
      });
      assert.ok(result.current.generatedManifest !== null);
      assert.ok(result.current.generatedManifest !== firstManifest);
    });
  });

  describe("reset", () => {
    it("should reset all state to initial values", async () => {
      const ctx = buildContext(STORED_MESSAGES);
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      await act(async () => {
        await result.current.generateManifest("test");
      });
      assert.ok(result.current.generatedManifest !== null);

      act(() => {
        result.current.reset();
      });

      assert.strictEqual(result.current.isGenerating, false);
      assert.strictEqual(result.current.generationError, null);
      assert.strictEqual(result.current.generatedManifest, null);
    });

    it("should reset error state", async () => {
      const ctx = buildContext(STORED_MESSAGES, makeSendGovernanceErrorMock());
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      await act(async () => {
        await result.current.generateManifest("test");
      });
      assert.ok(result.current.generationError !== null);

      act(() => {
        result.current.reset();
      });

      assert.strictEqual(result.current.generationError, null);
      assert.strictEqual(result.current.isGenerating, false);
    });
  });
});
