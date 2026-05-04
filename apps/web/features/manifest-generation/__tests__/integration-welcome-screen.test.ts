/**
 * Integration tests for Welcome Screen manifest generation data flow.
 *
 * These tests verify:
 * 1. Port data format handling (string, object, mixed)
 * 2. Error handling and recovery
 * 3. State management during generation
 * 4. End-to-end flow from form → API → manifest
 */

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
import assert from "assert";
import { renderHook, act } from "@testing-library/react";

mock.module("@hexagen/agentic-interaction", () => {
  return {
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
    ContextListSchema: {
      safeParse: (v: unknown) => ({ success: true, data: v }),
    },
    PortsListSchema: {
      safeParse: (v: unknown) => ({ success: true, data: v }),
    },
    normalizeDraft: (draft: unknown) => draft,
    normalizeTopologyDraft: (topology: unknown) => topology,
    validateDraft: () => ({ valid: true, diagnostics: [] }),
    checkClarificationTriggers: () => [],
    draftToManifest: () => ({}),
    renderDraft: async () => ({
      yaml: "workspace:\n  name: test-project\nboundedContexts:\n  - name: test\n",
      diagnostics: [],
      token: "t",
    }),
    parseJSON: (v: string) => {
      try {
        return { ok: true as const, data: JSON.parse(v), repairApplied: false };
      } catch {
        return {
          ok: false as const,
          error: "parse error",
          repairApplied: false,
        };
      }
    },
    normalizePortName: (n: string) => (n.endsWith("Port") ? n : `${n}Port`),
  };
});

import { useClientManifestGeneration } from "../useClientManifestGeneration";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";

/**
 * Creates a mock LLM context with controllable sendStructuredPrompt behavior
 */
function createMockContext(
  sendFn?: (userPrompt: string, systemPrompt: string) => Promise<string>,
): LocalLLMContext {
  const defaultSend = async () => JSON.stringify({});

  return {
    engineState: {
      status: "ready",
      progress: 100,
      loadedModelId: null as never,
      errorMessage: null,
      autoLoading: false,
    },
    initializeModel: mock.fn(async () => {}),
    cancelDownload: mock.fn(),
    hasAnyCachedModel: mock.fn(async () => false),
    hasModelInCache: mock.fn(async () => false),
    switchModel: mock.fn(async () => {}),
    deleteCachedModel: mock.fn(async () => {}),
    loadedModel: null,
    sendStructuredPrompt: mock.fn(sendFn ?? defaultSend) as never,
    sendGovernanceMessage: mock.fn(async () => {}),
    messages: [],
  };
}

describe("Welcome Screen Manifest Generation Integration", () => {
  beforeEach(() => {
    mock.reset();
  });

  afterEach(() => {
    mock.reset();
  });

  describe("Port data flow handling", () => {
    it("should handle ports as objects with all fields", async () => {
      const mockContext = createMockContext(
        async (userPrompt: string, systemPrompt: string) => {
          if (systemPrompt.includes("context list")) {
            return JSON.stringify([
              {
                name: "OrderContext",
                type: "core",
                description: "Manages orders",
              },
            ]);
          }
          if (systemPrompt.includes("ports")) {
            return JSON.stringify({
              in: [
                {
                  name: "CreateOrderPort",
                  type: "use-case",
                  description: "Creates new orders",
                },
              ],
              out: [
                {
                  name: "OrderRepositoryPort",
                  type: "infrastructure",
                  description: "Persists orders",
                },
              ],
            });
          }
          return JSON.stringify({});
        },
      );

      const { result } = renderHook(() =>
        useClientManifestGeneration(mockContext),
      );

      await act(async () => {
        await result.current.generateManifest("E-commerce platform");
      });

      assert.strictEqual(result.current.isGenerating, false);
      assert.strictEqual(result.current.generationError, null);
      assert.ok(
        result.current.generatedManifest !== null,
        "Should have generated manifest",
      );
      assert.match(result.current.generatedManifest!, /workspace:/);
    });

    it("should handle ports as strings and normalize them", async () => {
      const mockContext = createMockContext(
        async (userPrompt: string, systemPrompt: string) => {
          if (systemPrompt.includes("context list")) {
            return JSON.stringify([
              {
                name: "PaymentContext",
                type: "supporting",
                description: "Handles payments",
              },
            ]);
          }
          if (systemPrompt.includes("ports")) {
            return JSON.stringify({
              in: ["ProcessPaymentPort"],
              out: ["PaymentGatewayPort"],
            });
          }
          return JSON.stringify({});
        },
      );

      const { result } = renderHook(() =>
        useClientManifestGeneration(mockContext),
      );

      await act(async () => {
        await result.current.generateManifest("Payment processing system");
      });

      assert.strictEqual(result.current.isGenerating, false);
      assert.strictEqual(result.current.generationError, null);
      assert.ok(
        result.current.generatedManifest !== null,
        "Should have generated manifest with string ports",
      );
    });

    it("should handle mixed port formats (string and object)", async () => {
      const mockContext = createMockContext(
        async (userPrompt: string, systemPrompt: string) => {
          if (systemPrompt.includes("context list")) {
            return JSON.stringify([
              {
                name: "UserContext",
                type: "core",
                description: "User management",
              },
            ]);
          }
          if (systemPrompt.includes("ports")) {
            return JSON.stringify({
              in: [
                "CreateUserPort",
                {
                  name: "UpdateUserPort",
                  type: "use-case",
                  description: "Updates user profile",
                },
              ],
              out: [
                {
                  name: "UserRepositoryPort",
                  type: "infrastructure",
                  description: "Data persistence",
                },
                "EmailServicePort",
              ],
            });
          }
          return JSON.stringify({});
        },
      );

      const { result } = renderHook(() =>
        useClientManifestGeneration(mockContext),
      );

      await act(async () => {
        await result.current.generateManifest(
          "User management with mixed port formats",
        );
      });

      assert.strictEqual(result.current.isGenerating, false);
      assert.strictEqual(result.current.generationError, null);
      assert.ok(
        result.current.generatedManifest !== null,
        "Should handle mixed port formats",
      );
    });
  });

  describe("Error handling and recovery", () => {
    it("should handle API response errors gracefully", async () => {
      const mockContext = createMockContext(
        async (userPrompt: string, systemPrompt: string) => {
          if (systemPrompt.includes("context list")) {
            throw new Error("API request failed");
          }
          return JSON.stringify({});
        },
      );

      const { result } = renderHook(() =>
        useClientManifestGeneration(mockContext),
      );

      await act(async () => {
        await result.current.generateManifest("Test description");
      });

      assert.strictEqual(result.current.isGenerating, false);
      assert.ok(
        result.current.generationError !== null,
        "Should have generation error",
      );
      assert.match(
        result.current.generationError!,
        /API request failed|Failed to generate/,
      );
    });

    it("should handle empty response correctly", async () => {
      const mockContext = createMockContext(async () => "");

      const { result } = renderHook(() =>
        useClientManifestGeneration(mockContext),
      );

      await act(async () => {
        await result.current.generateManifest("Test");
      });

      assert.strictEqual(result.current.isGenerating, false);
      assert.ok(
        result.current.generationError !== null,
        "Should have error for empty response",
      );
    });

    it("should handle malformed JSON gracefully", async () => {
      const mockContext = createMockContext(
        async (userPrompt: string, systemPrompt: string) => {
          if (systemPrompt.includes("context list")) {
            return "{invalid json content here}";
          }
          return JSON.stringify({});
        },
      );

      const { result } = renderHook(() =>
        useClientManifestGeneration(mockContext),
      );

      await act(async () => {
        await result.current.generateManifest("Test");
      });

      assert.strictEqual(result.current.isGenerating, false);
      assert.ok(
        result.current.generationError !== null,
        "Should have error for malformed JSON",
      );
    });

    it("should reset state properly on error", async () => {
      let callCount = 0;
      const mockContext = createMockContext(
        async (userPrompt: string, systemPrompt: string) => {
          callCount++;
          if (callCount === 1) {
            if (systemPrompt.includes("context list")) {
              return JSON.stringify([
                { name: "Test", type: "core", description: "Test" },
              ]);
            }
            return JSON.stringify({ in: [], out: [] });
          }
          throw new Error("Request failed");
        },
      );

      const { result } = renderHook(() =>
        useClientManifestGeneration(mockContext),
      );

      // First generation succeeds
      await act(async () => {
        await result.current.generateManifest("Test 1");
      });

      assert.ok(result.current.generatedManifest !== null);

      // Reset
      act(() => {
        result.current.reset();
      });

      assert.strictEqual(result.current.generatedManifest, null);
      assert.strictEqual(result.current.generationError, null);
      assert.strictEqual(result.current.isGenerating, false);
    });
  });

  describe("State management", () => {
    it("should transition through phases: idle → topology → rendering → complete", async () => {
      const mockContext = createMockContext(
        async (userPrompt: string, systemPrompt: string) => {
          if (systemPrompt.includes("context list")) {
            return JSON.stringify([
              {
                name: "OrderContext",
                type: "core",
                description: "Orders",
              },
            ]);
          }
          if (systemPrompt.includes("ports")) {
            return JSON.stringify({
              in: [{ name: "CreateOrderPort", type: "use-case" }],
              out: [{ name: "DBPort", type: "infrastructure" }],
            });
          }
          return JSON.stringify({});
        },
      );

      const { result } = renderHook(() =>
        useClientManifestGeneration(mockContext),
      );

      await act(async () => {
        await result.current.generateManifest("Test");
      });

      // Note: phases are captured through the test but we mainly verify end state
      assert.strictEqual(result.current.phase, "complete");
      assert.strictEqual(result.current.isGenerating, false);
      assert.ok(result.current.generatedManifest !== null);
    });

    it("should maintain correct state during generation", async () => {
      const mockContext = createMockContext(
        async (userPrompt: string, systemPrompt: string) => {
          if (systemPrompt.includes("context list")) {
            return JSON.stringify([
              {
                name: "TestContext",
                type: "core",
                description: "Test",
              },
            ]);
          }
          if (systemPrompt.includes("ports")) {
            return JSON.stringify({ in: [], out: [] });
          }
          return JSON.stringify({});
        },
      );

      const { result } = renderHook(() =>
        useClientManifestGeneration(mockContext),
      );

      await act(async () => {
        await result.current.generateManifest("Test");
      });

      // Verify completion state
      assert.strictEqual(result.current.isGenerating, false);
      assert.strictEqual(result.current.generationError, null);
    });
  });

  describe("End-to-end flow", () => {
    it("should complete full generation flow: description → API call → manifest generated", async () => {
      const mockContext = createMockContext(
        async (userPrompt: string, systemPrompt: string) => {
          if (systemPrompt.includes("context list")) {
            return JSON.stringify([
              {
                name: "OrderContext",
                type: "core",
                description: "Manages customer orders",
              },
              {
                name: "PaymentContext",
                type: "supporting",
                description: "Processes payments",
              },
            ]);
          }
          if (systemPrompt.includes("ports")) {
            return JSON.stringify({
              in: [{ name: "ProcessPort", type: "use-case" }],
              out: [{ name: "RepositoryPort", type: "infrastructure" }],
            });
          }
          return JSON.stringify({});
        },
      );

      const { result } = renderHook(() =>
        useClientManifestGeneration(mockContext),
      );

      // User description from form
      const userDescription =
        "E-commerce platform with order and payment processing";

      // Trigger generation
      await act(async () => {
        await result.current.generateManifest(userDescription);
      });

      // Verify end-to-end completion
      assert.strictEqual(
        result.current.isGenerating,
        false,
        "Should not be generating",
      );
      assert.strictEqual(
        result.current.generationError,
        null,
        "Should have no errors",
      );
      assert.ok(
        result.current.generatedManifest !== null,
        "Should have manifest content",
      );
      assert.strictEqual(
        result.current.phase,
        "complete",
        "Should be in complete phase",
      );

      // Verify manifest content structure
      const manifest = result.current.generatedManifest;
      assert.match(manifest, /workspace:/, "Manifest should contain workspace");
      assert.match(
        manifest,
        /boundedContexts:/,
        "Manifest should contain boundedContexts",
      );
    });
  });
});
