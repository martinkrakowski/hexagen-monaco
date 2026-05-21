import { test, describe } from "node:test";
import assert from "node:assert";
import { ExecuteLooseSpecConversionUseCase } from "../../../src/application/use-cases/staged-generation/execute-loose-spec-conversion.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";

describe("ExecuteLooseSpecConversionUseCase", () => {
  const validJsonResponse = `{
    "bounded_contexts": [
      {
        "name": "core-domain",
        "description": "Core business logic",
        "type": "core"
      }
    ]
  }`;

  test("Stub LLM returns valid JSON -> success path with parsed config", async () => {
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: validJsonResponse,
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteLooseSpecConversionUseCase(mockLLMAdapter);
    const result = await useCase.execute("Build a core domain");

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(
        result.value.config.bounded_contexts[0].name,
        "core-domain",
      );
    }
  });

  test("Stub LLM returns malformed JSON -> repaired via json-repair -> success", async () => {
    const malformedJsonResponse = `{
      "bounded_contexts": [
        {
          "name": "core-domain",
          "description": "Core business logic",
          "type": "core"
        }
      ]
      // Missing closing brace! Wait, json-repair can fix this:
    `;

    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: malformedJsonResponse,
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteLooseSpecConversionUseCase(mockLLMAdapter);
    const result = await useCase.execute("Build a core domain");

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(
        result.value.config.bounded_contexts[0].name,
        "core-domain",
      );
    }
  });

  test("Stub LLM returns shape-invalid JSON -> retry with error injection -> success on attempt 2", async () => {
    let callCount = 0;
    const mockLLMAdapter = {
      sendRequest: async (request: any) => {
        callCount++;
        if (callCount === 1) {
          // Attempt 1: Valid JSON, but missing bounded_contexts
          return {
            success: true as const,
            value: {
              id: "test",
              modelId: "gpt-4o-mini" as any,
              content: `{"some_other_field": "test"}`,
              finishReason: "stop" as const,
              timestamp: Date.now(),
            },
          };
        }
        // Attempt 2: Should have retry prompt in system/user, return valid JSON
        assert.ok(request.messages[1].content.includes("CORRECTION REQUIRED"));
        return {
          success: true as const,
          value: {
            id: "test",
            modelId: "gpt-4o-mini" as any,
            content: validJsonResponse,
            finishReason: "stop" as const,
            timestamp: Date.now(),
          },
        };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteLooseSpecConversionUseCase(mockLLMAdapter);
    const result = await useCase.execute("Build a core domain");

    assert.strictEqual(result.success, true);
    assert.strictEqual(callCount, 2);
  });

  test("Three consecutive failures -> returns { success: false }", async () => {
    let callCount = 0;
    const mockLLMAdapter = {
      sendRequest: async () => {
        callCount++;
        return {
          success: true as const,
          value: {
            id: "test",
            modelId: "gpt-4o-mini" as any,
            content: `{"invalid_shape": true}`,
            finishReason: "stop" as const,
            timestamp: Date.now(),
          },
        };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteLooseSpecConversionUseCase(mockLLMAdapter);
    const result = await useCase.execute("Build a core domain");

    assert.strictEqual(result.success, false);
    assert.strictEqual(callCount, 3);
  });

  test("Oversized input -> fails before LLM is called", async () => {
    let callCount = 0;
    const mockLLMAdapter = {
      sendRequest: async () => {
        callCount++;
        return { success: false, error: new Error("Should not be called") };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteLooseSpecConversionUseCase(mockLLMAdapter);
    const largeInput = "A".repeat(200_001);
    const result = await useCase.execute(largeInput);

    assert.strictEqual(result.success, false);
    assert.strictEqual(callCount, 0);
  });

  test("External abort signal fires mid-call -> returns abort error", async () => {
    const mockLLMAdapter = {
      sendRequest: async (request: any) => {
        return new Promise((_resolve, reject) => {
          if (request.signal) {
            request.signal.addEventListener("abort", () => {
              const e = new Error("AbortError");
              e.name = "AbortError";
              reject(e);
            });
          }
        });
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteLooseSpecConversionUseCase(mockLLMAdapter);
    const controller = new AbortController();
    // Abort shortly after the call starts.
    setTimeout(() => controller.abort(), 10);

    const result = await useCase.execute("Build a core domain", {
      signal: controller.signal,
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof Error);
      assert.strictEqual(result.error.name, "AbortError");
    }
  });

  test("Already-aborted signal -> fails before LLM is called", async () => {
    let callCount = 0;
    const mockLLMAdapter = {
      sendRequest: async () => {
        callCount++;
        return {
          success: true as const,
          value: {
            id: "test",
            modelId: "gpt-4o-mini" as any,
            content: validJsonResponse,
            finishReason: "stop" as const,
            timestamp: Date.now(),
          },
        };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteLooseSpecConversionUseCase(mockLLMAdapter);
    const controller = new AbortController();
    controller.abort();

    const result = await useCase.execute("Build a core domain", {
      signal: controller.signal,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(callCount, 0);
    if (!result.success) {
      assert.strictEqual((result.error as Error).name, "AbortError");
    }
  });
});
