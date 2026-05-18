import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import { ExecuteDomainExtractionUseCase } from "../../../src/application/use-cases/staged-generation/execute-domain-extraction.use-case.js";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { PipelineState } from "../../../src/domain/value-objects/pipeline-state.js";
import { StageMaxRetriesError } from "../../../src/domain/errors/stage-errors.js";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry.js";

const validNdjson = [
  '{"type":"verb","value":"createUser"}',
  '{"type":"noun","value":"User"}',
  '{"type":"subdomain","value":"Identity"}',
  '{"type":"aggregateRoot","name":"User","subdomain":"Identity"}',
].join("\n");

const mockStage0State: Pick<PipelineState, "stage0"> = {
  stage0: { rawContent: "sample stage 0 output" } as any,
};

const createSuccessStream = (content: string) => {
  return {
    async *[Symbol.asyncIterator]() {
      yield { success: true, value: content };
    },
  } as AsyncIterable<{ success: boolean; value?: string; error?: unknown }>;
};

const createErrorStream = (error: Error) => {
  return {
    async *[Symbol.asyncIterator]() {
      yield { success: false, error };
    },
  } as AsyncIterable<{ success: boolean; value?: string; error?: unknown }>;
};

const createMockLLMPort = (
  streams: Array<
    AsyncIterable<{ success: boolean; value?: string; error?: unknown }>
  >,
) => {
  let callIdx = 0;
  return {
    sendRequest: async () => ({
      success: true as const,
      value: {
        id: "test",
        modelId: "gpt-4o-mini" as any,
        content: validNdjson,
        finishReason: "stop" as const,
        timestamp: Date.now(),
      },
    }),
    streamStructuredRequest: () => {
      const stream = streams[callIdx];
      callIdx++;
      return stream;
    },
  } as unknown as SendStructuredRequestPort;
};

describe("ExecuteDomainExtractionUseCase", () => {
  test("happy path: valid stage0 state returns DomainAnalysis", async () => {
    const mockPort = createMockLLMPort([createSuccessStream(validNdjson)]);
    const useCase = new ExecuteDomainExtractionUseCase(mockPort);
    const result = await useCase.execute(mockStage0State);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.value.verbs, ["createUser"]);
      assert.deepStrictEqual(result.value.nouns, ["User"]);
      assert.deepStrictEqual(result.value.subdomains, ["Identity"]);
      assert.deepStrictEqual(result.value.aggregateRoots, [
        { name: "User", subdomain: "Identity" },
      ]);
    }
  });

  test("retry path: fails 2 times then succeeds", async () => {
    const errorStream1 = createErrorStream(new Error("First fail"));
    const errorStream2 = createErrorStream(new Error("Second fail"));
    const successStream = createSuccessStream(validNdjson);
    const mockPort = createMockLLMPort([
      errorStream1,
      errorStream2,
      successStream,
    ]);
    const useCase = new ExecuteDomainExtractionUseCase(mockPort);
    const result = await useCase.execute(mockStage0State);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.value.verbs.length > 0);
    }
  });

  test("max retries exceeded: returns StageMaxRetriesError", async () => {
    let callCount = 0;
    const mockPort = {
      sendRequest: async () => {
        callCount++;
        if (callCount <= 3) {
          return {
            success: true as const,
            value: {
              id: "test",
              modelId: "gpt-4o-mini" as any,
              content: "invalid-json-line",
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
            content: validNdjson,
            finishReason: "stop" as const,
            timestamp: Date.now(),
          },
        };
      },
      streamStructuredRequest: async function* () {
        yield { success: true, value: validNdjson };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteDomainExtractionUseCase(mockPort);
    const result = await useCase.execute(mockStage0State);
    assert.strictEqual(result.success, false);
    const failureResult = result as { success: false; error: unknown };
    assert.ok(failureResult.error instanceof StageMaxRetriesError);
  });

  test("telemetry callback is invoked on success", async () => {
    const telemetryCalls: StageTelemetry[] = [];
    const mockPort = createMockLLMPort([createSuccessStream(validNdjson)]);
    const useCase = new ExecuteDomainExtractionUseCase(mockPort);
    const onStageTelemetry = (telemetry: StageTelemetry) => {
      telemetryCalls.push(telemetry);
    };
    await useCase.execute(mockStage0State, undefined, onStageTelemetry);
    assert.strictEqual(telemetryCalls.length, 1);
    const telemetry = telemetryCalls[0];
    assert.strictEqual(telemetry.stage, 1);
    assert.strictEqual(telemetry.label, "Domain Extraction");
    assert.ok(telemetry.durationMs >= 0);
    assert.strictEqual(telemetry.usedLLM, true);
    assert.strictEqual(telemetry.retryCount, 0);
  });

  test("handles LLM timeout", async () => {
    const timeoutAdapter = {
      sendRequest: async () => {
        throw new Error("LLM request timeout");
      },
      streamStructuredRequest: async function* () {
        yield { success: true, value: validNdjson };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteDomainExtractionUseCase(timeoutAdapter);

    const result = await useCase.execute(mockStage0State).catch((err) => {
      return { success: false, error: err };
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test("retry fails on persistent timeout", async () => {
    let callCount = 0;
    const timeoutAdapter = {
      sendRequest: async () => {
        callCount++;
        if (callCount <= 3) {
          throw new Error(`Attempt ${callCount} timed out`);
        }
        return {
          success: true as const,
          value: {
            id: "test",
            modelId: "gpt-4o-mini" as any,
            content: validNdjson,
            finishReason: "stop" as const,
            timestamp: Date.now(),
          },
        };
      },
      streamStructuredRequest: async function* () {
        yield { success: true, value: validNdjson };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteDomainExtractionUseCase(timeoutAdapter);
    const result = await useCase.execute(mockStage0State).catch((err) => {
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
          content: "not valid json at all",
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: "not valid json at all" };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteDomainExtractionUseCase(badAdapter);
    const result = await useCase.execute(mockStage0State);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(
        result.error instanceof StageMaxRetriesError ||
          result.error instanceof Error,
      );
    }
  });
});
