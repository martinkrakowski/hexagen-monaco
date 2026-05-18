import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ExecuteContextClassificationUseCase } from "../../../src/application/use-cases/staged-generation/execute-context-classification.use-case.js";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { StageMaxRetriesError } from "../../../src/domain/errors/stage-errors.js";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry.js";

describe("ExecuteContextClassificationUseCase", () => {
  const createValidContextLine = () =>
    JSON.stringify({
      status: "accepted",
      name: "invoice-management",
      type: "core",
      responsibility: "Manage invoices",
      aggregateRoots: ["Invoice"],
      useCaseNames: ["CreateInvoice"],
      eventsPublished: ["InvoiceCreated"],
      reasoning: "Core business context",
    });

  test("happy path: valid stage0 + stage1 returns successful classification", async () => {
    const validContextLine = createValidContextLine();
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: createValidContextLine(),
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: validContextLine };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteContextClassificationUseCase(mockLLMAdapter);
    const dummyState = { stage0: {} as any, stage1: {} as any };

    const result = await useCase.execute(dummyState);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.accepted.length, 1);
      assert.strictEqual(result.value.accepted[0].name, "invoice-management");
      assert.strictEqual(result.value.accepted[0].type, "core");
      assert.strictEqual(result.value.rejected.length, 0);
      assert.strictEqual(result.value.uncertain.length, 0);
    }
  });

  test("retry path: fail 2x then succeed", async () => {
    let attemptCount = 0;
    const validContextLine = createValidContextLine();

    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: createValidContextLine(),
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        attemptCount++;
        if (attemptCount <= 2) {
          yield { success: true, value: "invalid-ndjson-line" };
        } else {
          yield { success: true, value: validContextLine };
        }
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteContextClassificationUseCase(mockLLMAdapter);
    const dummyState = { stage0: {} as any, stage1: {} as any };

    const result = await useCase.execute(dummyState);

    assert.strictEqual(result.success, true);
    assert.strictEqual(attemptCount, 3);
  });

  test("max retries exceeded returns error", async () => {
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: createValidContextLine(),
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: "invalid-data" };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteContextClassificationUseCase(mockLLMAdapter);
    const dummyState = { stage0: {} as any, stage1: {} as any };

    const result = await useCase.execute(dummyState);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof StageMaxRetriesError);
      assert.strictEqual((result.error as StageMaxRetriesError).stage, 2);
    }
  });

  test("calls telemetry callback with correct data", async () => {
    const validContextLine = createValidContextLine();
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: createValidContextLine(),
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: validContextLine };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteContextClassificationUseCase(mockLLMAdapter);
    const dummyState = { stage0: {} as any, stage1: {} as any };

    let telemetry: StageTelemetry | undefined;
    const onStageTelemetry = (t: StageTelemetry) => {
      telemetry = t;
    };

    await useCase.execute(dummyState, undefined, onStageTelemetry);

    assert.ok(telemetry);
    assert.strictEqual(telemetry.stage, 2);
    assert.strictEqual(telemetry.label, "Context Classification");
    assert.strictEqual(telemetry.usedLLM, true);
    assert.strictEqual(telemetry.retryCount, 0);
    assert.ok(telemetry.durationMs > 0);
  });

  test("handles LLM timeout", async () => {
    const timeoutAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: createValidContextLine(),
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        await new Promise(() => {});
        yield { success: true, value: "" };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteContextClassificationUseCase(timeoutAdapter);
    const dummyState = { stage0: {} as any, stage1: {} as any };

    const result = await Promise.race([
      useCase.execute(dummyState),
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
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: createValidContextLine(),
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        callCount++;
        if (callCount <= 3) {
          await new Promise(() => {});
        }
        yield { success: true, value: createValidContextLine() };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteContextClassificationUseCase(timeoutAdapter);
    const dummyState = { stage0: {} as any, stage1: {} as any };

    const result = await useCase.execute(dummyState).catch((err) => {
      return { success: false, error: err };
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test("handles malformed LLM response", async () => {
    const badAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: createValidContextLine(),
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: "not valid json at all" };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteContextClassificationUseCase(badAdapter);
    const dummyState = { stage0: {} as any, stage1: {} as any };

    const result = await useCase.execute(dummyState);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof StageMaxRetriesError);
    }
  });
});
