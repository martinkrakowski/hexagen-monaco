import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ExecuteAdapterAssignmentUseCase } from "../../../src/application/use-cases/staged-generation/execute-adapter-assignment.use-case.js";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { StageMaxRetriesError } from "../../../src/domain/errors/stage-errors.js";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry.js";

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
      streamStructuredRequest: async function* () {
        callCount++;
        if (callCount <= 2) {
          yield { success: true, value: "invalid json" };
        } else {
          yield { success: true, value: validBindingLine };
        }
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteAdapterAssignmentUseCase(mockPort);
    const result = await useCase.execute(mockState, mockVariables);

    assert.strictEqual(result.success, true);
    assert.strictEqual(callCount, 3);
  });

  test("max retries exceeded: returns error", async () => {
    const mockPort = {
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
      streamStructuredRequest: async function* () {
        await new Promise(() => {});
        yield { success: true, value: "" };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteAdapterAssignmentUseCase(timeoutAdapter);

    const result = await Promise.race([
      useCase.execute(mockState, mockVariables),
      new Promise<{ success: false; error: unknown }>((_, reject) =>
        setTimeout(() => reject(new Error("Test timeout")), 100),
      ),
    ]).catch((err) => ({ success: false, error: err }) as const);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test("retry fails on persistent timeout", async () => {
    let callCount = 0;
    const timeoutAdapter = {
      streamStructuredRequest: async function* () {
        callCount++;
        if (callCount <= 3) {
          await new Promise(() => {});
        }
        yield { success: true, value: validBindingLine };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteAdapterAssignmentUseCase(timeoutAdapter);
    const result = await useCase
      .execute(mockState, mockVariables)
      .catch((err) => {
        return { success: false, error: err };
      });

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test("handles malformed LLM response", async () => {
    const badAdapter = {
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
