import { test, describe } from "node:test";
import assert from "node:assert";
import { ExecuteValidationReviewUseCase } from "../../../src/application/use-cases/staged-generation/execute-validation-review.use-case.ts";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { StageMaxRetriesError } from "../../../src/domain/errors/stage-errors";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry";

const validValidationNdjson = '{"type":"result","passed":true}\n';

const createMockPipelineState = () => ({
  stage0: {
    intent: "Invoice system",
    explicitTechnologies: [],
    explicitPatterns: [],
    ambiguities: [],
    projectName: "invoice-app",
  },
  stage2: {
    accepted: [
      {
        name: "invoice-management",
        type: "core" as const,
        reasoning: "Manages invoices",
      },
    ],
    rejected: [],
    uncertain: [],
  },
  stage5: {
    yaml: "openapi: 3.0.0\ninfo:\n  title: Invoice System\n  version: 1.0.0",
    parsedObject: {},
    assemblyWarnings: [],
  },
  contextMappings: [],
});

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
        content: validValidationNdjson,
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

describe("ExecuteValidationReviewUseCase", () => {
  test("happy path: returns successful validation report", async () => {
    const mockLLM = createMockLLMPort(() =>
      createSuccessStream(validValidationNdjson),
    );

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, true);
      assert.deepStrictEqual(result.value.errors, []);
      assert.deepStrictEqual(result.value.warnings, []);
    }
  });

  test("retry path: fails 2x then succeeds", async () => {
    let attemptCount = 0;
    const mockLLM = createMockLLMPort(() => {
      attemptCount++;
      if (attemptCount <= 2) {
        return createMalformedStream();
      }
      return createSuccessStream(validValidationNdjson);
    });

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    assert.strictEqual(attemptCount, 3);
  });

  test("max retries exceeded: returns error", async () => {
    const mockLLM = createMockLLMPort(() => createMalformedStream());

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof Error);
    }
  });

  test("telemetry callback is invoked with validation metrics", async () => {
    const telemetryCalls: StageTelemetry[] = [];
    const onStageTelemetry = (telemetry: StageTelemetry) => {
      telemetryCalls.push(telemetry);
    };

    const mockLLM = createMockLLMPort(() =>
      createSuccessStream(validValidationNdjson),
    );

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    await useCase.execute(state, undefined, onStageTelemetry);

    assert.strictEqual(telemetryCalls.length, 1);
    assert.strictEqual(telemetryCalls[0].stage, 6);
    assert.strictEqual(telemetryCalls[0].label, "Validation Review");
    assert.ok(telemetryCalls[0].durationMs >= 0);
    assert.strictEqual(telemetryCalls[0].usedLLM, true);
    assert.ok(telemetryCalls[0].summary.includes("passed"));
  });

  test("handles NDJSON with errors and warnings", async () => {
    const ndjson =
      '{"type":"error","message":"Invalid port"}\n{"type":"warning","message":"Deprecated adapter"}\n{"type":"result","passed":false}\n';
    const mockLLM = createMockLLMPort(() => createSuccessStream(ndjson));

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, false);
      assert.strictEqual(result.value.errors.length, 1);
      assert.strictEqual(result.value.warnings.length, 1);
    }
  });

  test("handles LLM stream error", async () => {
    const mockLLM = createMockLLMPort(() =>
      createErrorStream(new Error("LLM request timeout")),
    );

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();

    const result = await useCase.execute(state);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test("retry fails on persistent stream error", async () => {
    const mockLLM = createMockLLMPort(() =>
      createErrorStream(new Error("Persistent timeout")),
    );

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test("handles malformed LLM response", async () => {
    const mockLLM = createMockLLMPort(() => createMalformedStream());

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof StageMaxRetriesError);
    }
  });

  test("returns validation failure with errors", async () => {
    const ndjson =
      '{"type":"result","passed":false,"errors":[{"rule":"R01","message":"Context uses technology"}]}\n';
    const mockLLM = createMockLLMPort(() => createSuccessStream(ndjson));

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, false);
      assert.ok(result.value.errors.length > 0);
      const errorsString = JSON.stringify(result.value.errors);
      assert.ok(errorsString.includes("R01"));
    }
  });
});
