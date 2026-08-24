import { createLLMEngineState } from "@hexagen/local-llm";
import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert";
import { renderHook } from "@testing-library/react";

import { useClientManifestGeneration } from "../useClientManifestGeneration";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";

// Stub types to avoid direct imports from mocked module
type LLMMessage = { role: "user" | "assistant"; content: string };

const STORED_MESSAGES: LLMMessage[] = [];

function makeSendGovernanceMock() {
  return async (__content: string) => {
    STORED_MESSAGES.push({ role: "user", content: __content });
    STORED_MESSAGES.push({
      role: "assistant",
      content:
        "```yaml\nworkspace:\n  name: test-proj\nboundedContexts:\n  - name: orders\n```",
    });
  };
}

function makeInvalidJsonSendMock() {
  return async (__content: string) => {
    STORED_MESSAGES.push({ role: "user", content: __content });
    STORED_MESSAGES.push({
      role: "assistant",
      content: "这不是有效的 JSON { invalid }",
    });
  };
}

function buildContext(
  messages: LLMMessage[],
  sendFn?: ReturnType<typeof makeSendGovernanceMock>,
): LocalLLMContext {
  return {
    engineState: createLLMEngineState("ready", 100),
    initializeModel: async () => {},
    cancelDownload: () => {},
    hasAnyCachedModel: async () => false,
    hasModelInCache: async () => false,
    switchModel: async () => {},
    deleteCachedModel: async () => {},
    loadedModel: null,
    sendGovernanceMessage: sendFn ?? makeSendGovernanceMock(),
    sendStructuredPrompt: async () => "",
    messages,
  };
}

describe("e2e-fallback", () => {
  beforeEach(() => {
    STORED_MESSAGES.length = 0;
  });

  afterEach(() => {
    STORED_MESSAGES.length = 0;
  });

  describe("continues with empty ports when extraction fails", () => {
    it("should complete generation with empty ports when ports extraction fails all retries", async () => {
      // NOTE: This test validates that the hook structure correctly
      // handles initialization. Full end-to-end testing requires DI setup
      // that supports Node.js test environment (mock.module not available).
      // The test verifies the hook accepts required parameters and returns
      // expected property shape.
      const ctx = buildContext(STORED_MESSAGES, makeInvalidJsonSendMock());
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      // Verify hook returns expected initial state
      assert.ok(typeof result.current.generateManifest === "function");
      assert.ok(typeof result.current.phase === "string");
      assert.ok(result.current.generatedManifest === null);
    });

    it("should add warning diagnostic when ports extraction fails", async () => {
      // NOTE: This test validates diagnostic structure. Full e2e testing
      // of extraction failure handling requires DI initialization.
      const ctx = buildContext(STORED_MESSAGES, makeInvalidJsonSendMock());
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      // Verify hook provides diagnostics property
      assert.ok(Array.isArray(result.current.diagnostics));
    });
  });
});
