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
    WORKSPACE_SYSTEM_PROMPT: "You are a helpful assistant.",
    compileWorkspacePrompt: (vars: { userDescription: string }) =>
      `Generate a manifest for: ${vars.userDescription}`,
    CONTEXT_LIST_SYSTEM_PROMPT: "Return context list.",
    compileContextListPrompt: (vars: { userDescription: string }) =>
      `Contexts for: ${vars.userDescription}`,
    PORTS_LIST_SYSTEM_PROMPT: "Return ports list.",
    compilePortsPrompt: (contextName: string) => `Ports for: ${contextName}`,
    ADAPTER_SYSTEM_PROMPT: "Return adapters.",
    compileAdapterUserPrompt: (vars: {
      validatedPortInventory: string[];
      contextName: string;
    }) => `Adapters for: ${vars.contextName}`,
    ContextListSchema: { parse: (v: unknown) => v },
    PortsListSchema: { parse: (v: unknown) => v },
    normalizeDraft: () => ({}),
    normalizeTopologyDraft: () => ({}),
    validateDraft: () => ({ valid: true, diagnostics: [] }),
    checkClarificationTriggers: () => [],
    draftToManifest: () => ({}),
    renderDraft: () => ({ yaml: "", diagnostics: [], token: "t" }),
    parseJSON: (v: string) => {
      try {
        return { ok: true as const, data: JSON.parse(v) };
      } catch {
        return { ok: false as const, error: "parse error" };
      }
    },
    normalizePortName: (n: string) => (n.endsWith("Port") ? n : `${n}Port`),
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

function makeInvalidJsonSendMock() {
  return mock.fn(async (__content: string) => {
    STORED_MESSAGES.push({ role: "user", content: __content });
    return {
      role: "assistant",
      content: "这不是有效的 JSON { invalid }",
    };
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

describe("e2e-fallback", () => {
  beforeEach(() => {
    STORED_MESSAGES.length = 0;
  });

  afterEach(() => {
    mock.reset();
    STORED_MESSAGES.length = 0;
  });

  afterEach(() => {
    mock.reset();
    STORED_MESSAGES.length = 0;
  });

  describe("continues with empty ports when extraction fails", () => {
    it("should complete generation with empty ports when ports extraction fails all retries", async () => {
      const ctx = buildContext(STORED_MESSAGES, makeInvalidJsonSendMock());
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      await act(async () => {
        await result.current.generateManifest("E-commerce platform");
      });

      assert.strictEqual(result.current.phase, "complete");
      assert.ok(
        result.current.generatedManifest !== null,
        "Should have generated manifest",
      );
      assert.strictEqual(result.current.generationError, null);
    });

    it("should add warning diagnostic when ports extraction fails", async () => {
      const ctx = buildContext(STORED_MESSAGES, makeInvalidJsonSendMock());
      const { result } = renderHook(() => useClientManifestGeneration(ctx));

      await act(async () => {
        await result.current.generateManifest("E-commerce platform");
      });

      assert.ok(
        result.current.diagnostics.length > 0,
        "Should have diagnostics",
      );
      const portWarning = result.current.diagnostics.find(
        (d: { code?: string }) => d.code === "PORTS_EXTRACTION_FAILED",
      );
      assert.ok(
        portWarning !== undefined,
        "Should have PORTS_EXTRACTION_FAILED warning",
      );
    });
  });
});
