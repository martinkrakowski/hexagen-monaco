import { test, describe } from "node:test";
import assert from "node:assert";
import { ExecuteAdapterAssignmentUseCase } from "../../../src/application/use-cases/staged-generation/execute-adapter-assignment.use-case.ts";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { StageMaxRetriesError } from "../../../src/domain/errors/stage-errors";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry";

const validBindingLine = JSON.stringify({
  contextName: "invoice-management",
  name: "InMemoryInvoiceAdapter",
  adapterType: "Repository",
  implements: "InvoiceRepository",
});

const mockState = {
  stage0: { projectName: "test-project" },
  stage2: {
    accepted: [{ name: "invoice-management", type: "core", reasoning: "test" }],
  },
  stage3: {
    contexts: [
      {
        contextName: "invoice-management",
        in: [
          {
            name: "ProcessBillingPort",
            type: "command",
            description: "Process billing",
          },
        ],
        out: [
          {
            name: "BillingRepositoryPort",
            type: "repository",
            description: "Persist billing",
          },
        ],
      },
    ],
  },
  contextMappings: [],
} as any;

const mockVariables = {} as any;

function createMockLLMPort(
  streamFn: () => AsyncIterable<{
    success: boolean;
    value?: string;
    error?: unknown;
  }>,
): SendStructuredRequestPort {
  return {
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
    streamStructuredRequest: () => streamFn(),
  } as unknown as SendStructuredRequestPort;
}

async function* createSuccessStream(content: string) {
  yield { success: true, value: content };
}

async function* createErrorStream(error: unknown) {
  yield { success: false, error };
}

async function* createMalformedStream() {
  yield { success: true, value: "not valid json at all" };
}

describe("ExecuteAdapterAssignmentUseCase", () => {
  test("happy path: returns valid adapter bindings", async () => {
    const mockPort = createMockLLMPort(() =>
      createSuccessStream(validBindingLine),
    );

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
    let attemptCount = 0;
    const mockPort = createMockLLMPort(() => {
      attemptCount++;
      if (attemptCount <= 2) {
        return createMalformedStream();
      }
      return createSuccessStream(validBindingLine);
    });

    const useCase = new ExecuteAdapterAssignmentUseCase(mockPort);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, true);
    assert.strictEqual(attemptCount, 3);
  });

  test("max retries exceeded: returns error", async () => {
    const mockPort = createMockLLMPort(() => createMalformedStream());

    const useCase = new ExecuteAdapterAssignmentUseCase(mockPort);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof StageMaxRetriesError);
    }
  });

  test("calls telemetry callback with correct data", async () => {
    const mockPort = createMockLLMPort(() =>
      createSuccessStream(validBindingLine),
    );

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

  test("handles LLM stream error", async () => {
    const mockPort = createMockLLMPort(() =>
      createErrorStream(new Error("LLM request timeout")),
    );

    const useCase = new ExecuteAdapterAssignmentUseCase(mockPort);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, false);
    assert.ok(result.error instanceof Error);
  });

  test("retry fails on persistent stream error", async () => {
    const mockPort = createMockLLMPort(() =>
      createErrorStream(new Error("Persistent timeout")),
    );

    const useCase = new ExecuteAdapterAssignmentUseCase(mockPort);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, false);
    assert.ok(result.error instanceof Error);
  });

  test("handles malformed LLM response", async () => {
    const mockPort = createMockLLMPort(() => createMalformedStream());

    const useCase = new ExecuteAdapterAssignmentUseCase(mockPort);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof StageMaxRetriesError);
    }
  });
});
