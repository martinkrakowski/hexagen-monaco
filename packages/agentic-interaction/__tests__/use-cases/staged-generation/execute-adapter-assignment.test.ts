import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ExecuteAdapterAssignmentUseCase } from "../../../src/application/use-cases/staged-generation/execute-adapter-assignment.use-case.ts";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { StageMaxRetriesError } from "../../../src/domain/errors/stage-errors";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry";

class TimeoutError extends Error {
  constructor(message = "LLM request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

const validBindingLine = JSON.stringify({
  contextName: "invoice-management",
  adapterName: "InMemoryInvoiceAdapter",
  adapterType: "Repository",
  implements: "InvoiceRepository",
});

const mockState = {
  stage0: { projectName: "test-project" },
  stage2: { contexts: [{ name: "invoice-management" }] },
  stage3: { entities: [] },
  contextMappings: {},
} as any;

const mockVariables = {} as any;

describe("ExecuteAdapterAssignmentUseCase", () => {
  test("happy path: returns valid adapter bindings", async () => {
    const mockPort = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: validBindingLine,
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: validBindingLine };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteAdapterAssignmentUseCase(mockPort);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.contexts.length, 1);
      assert.strictEqual(
        result.value.contexts[0].contextName,
        "invoice-management",
      );
      assert.strictEqual(result.value.contexts[0].adapters.length, 1);
      assert.strictEqual(
        result.value.contexts[0].adapters[0].name,
        "InMemoryInvoiceAdapter",
      );
    }
  });

  test("retry path: fails 2x then succeeds", async () => {
    let callCount = 0;
    const mockPort = {
      sendRequest: async () => {
        callCount++;
        if (callCount <= 2) {
          return {
            success: true as const,
            value: {
              id: "test",
              modelId: "gpt-4o-mini" as any,
              content: "invalid json",
              finishReason: "stop" as const,
              timestamp: Date.now(),
            },
          };
        }
        return {
          success: true as const,
          value: {
            id: "test",
            modelId: "gpt-4o-mini" as any,
            content: validBindingLine,
            finishReason: "stop" as const,
            timestamp: Date.now(),
          },
        };
      },
      streamStructuredRequest: async function* () {
        yield { success: true, value: validBindingLine };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteAdapterAssignmentUseCase(mockPort);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, true);
    assert.strictEqual(callCount, 3);
  });

  test("max retries exceeded: returns error", async () => {
    const mockPort = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: "invalid json",
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: "invalid json" };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteAdapterAssignmentUseCase(mockPort);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof StageMaxRetriesError);
    }
  });

  test("calls telemetry callback with correct data", async () => {
    const mockPort = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: validBindingLine,
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: validBindingLine };
      },
    } as unknown as SendStructuredRequestPort;

    const telemetryCalls: StageTelemetry[] = [];
    const onStageTelemetry = (t: StageTelemetry) => telemetryCalls.push(t);

    const useCase = new ExecuteAdapterAssignmentUseCase(mockPort);
    await useCase.execute(
      mockState,
      mockVariables,
      undefined,
      onStageTelemetry,
    );

    assert.strictEqual(telemetryCalls.length, 1);
    const telemetry = telemetryCalls[0];
    assert.strictEqual(telemetry.stage, 4);
    assert.strictEqual(telemetry.label, "Adapter Assignment");
    assert.strictEqual(telemetry.usedLLM, true);
    assert.strictEqual(telemetry.retryCount, 0);
  });

  test("handles LLM timeout", async () => {
    const timeoutAdapter = {
      sendRequest: async (request: any) => {
        // Check if abort was already called
        if (request.signal?.aborted) {
          throw new TimeoutError("Request already aborted");
        }
        // Simulate a long operation that will be aborted
        return new Promise<any>((resolve, reject) => {
          let completed = false;
          // Simulate long operation
          const operationTimer = setTimeout(() => {
            if (!completed) {
              completed = true;
              resolve({
                success: true as const,
                value: {
                  id: "test",
                  modelId: "gpt-4o-mini" as any,
                  content: validBindingLine,
                  finishReason: "stop" as const,
                  timestamp: Date.now(),
                },
              });
            }
          }, 100000);

          // Listen for abort
          if (request.signal) {
            request.signal.addEventListener("abort", () => {
              if (!completed) {
                completed = true;
                clearTimeout(operationTimer);
                reject(new TimeoutError("LLM request timeout"));
              }
            });
          }
        });
      },
      streamStructuredRequest: async function* () {
        yield { success: true, value: validBindingLine };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteAdapterAssignmentUseCase(timeoutAdapter);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, false);
    assert.ok(
      result.error instanceof TimeoutError,
      "Expected TimeoutError for LLM timeout",
    );
  });

  test("retry fails on persistent timeout", async () => {
    let callCount = 0;
    const timeoutAdapter = {
      sendRequest: async () => {
        callCount++;
        if (callCount <= 3) {
          throw new TimeoutError(`Attempt ${callCount} timed out`);
        }
        return {
          success: true as const,
          value: {
            id: "test",
            modelId: "gpt-4o-mini" as any,
            content: validBindingLine,
            finishReason: "stop" as const,
            timestamp: Date.now(),
          },
        };
      },
      streamStructuredRequest: async function* () {
        yield { success: true, value: validBindingLine };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteAdapterAssignmentUseCase(timeoutAdapter);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, false);
    assert.ok(
      result.error instanceof TimeoutError,
      "Expected TimeoutError for persistent timeout",
    );
    assert.strictEqual(callCount, 3);
  });

  test("handles malformed LLM response", async () => {
    const badAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: "not valid json at all",
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: "not valid json at all" };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteAdapterAssignmentUseCase(badAdapter);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof StageMaxRetriesError);
    }
  });
});
