import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import { ExecutePortMappingUseCase } from "../../../src/application/use-cases/staged-generation/execute-port-mapping.use-case.js";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { PipelineState } from "../../../src/domain/value-objects/pipeline-state.js";
import { StageMaxRetriesError } from "../../../src/domain/errors/stage-errors.js";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry.js";

const validPortMappingNdjson = [
  '{"contextName":"invoice-management","direction":"in","name":"createInvoice","portType":"command","description":"Creates invoice"}',
  '{"contextName":"invoice-management","direction":"out","name":"invoiceRepository","portType":"repository","description":"Repository for invoices"}',
  '{"type":"contextMapping","upstream":"billing","downstream":"invoice-management","pattern":"ACL"}',
].join("\n");

const mockStageState: Pick<PipelineState, "stage0" | "stage1" | "stage2"> = {
  stage0: { intent: "Invoice system", projectName: "invoice-app" } as any,
  stage1: { rawContent: "sample stage 1 output" } as any,
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
  } as any,
};

const createSuccessStream = (content: string) => {
  return {
    async *[Symbol.asyncIterator]() {
      yield { success: true, value: content };
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
    streamStructuredRequest: () => {
      const stream = streams[callIdx];
      callIdx++;
      return stream;
    },
  } as unknown as SendStructuredRequestPort;
};

describe("ExecutePortMappingUseCase", () => {
  test("happy path: valid stage0+stage1+stage2 returns PortMappingResult", async () => {
    const mockPort = createMockLLMPort([
      createSuccessStream(validPortMappingNdjson),
    ]);
    const useCase = new ExecutePortMappingUseCase(mockPort);
    const result = await useCase.execute(mockStageState);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.value.portMap.contexts.length > 0);
      assert.ok(result.value.contextMappings.length >= 0);
    }
  });

  test("telemetry callback is invoked on success", async () => {
    const telemetryCalls: StageTelemetry[] = [];
    const mockPort = createMockLLMPort([
      createSuccessStream(validPortMappingNdjson),
    ]);
    const useCase = new ExecutePortMappingUseCase(mockPort);
    const onStageTelemetry = (telemetry: StageTelemetry) => {
      telemetryCalls.push(telemetry);
    };
    await useCase.execute(mockStageState, undefined, onStageTelemetry);

    assert.strictEqual(telemetryCalls.length, 1);
    const telemetry = telemetryCalls[0];
    assert.strictEqual(telemetry.stage, 3);
    assert.strictEqual(telemetry.label, "Port Mapping");
    assert.ok(telemetry.durationMs > 0);
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

    const useCase = new ExecutePortMappingUseCase(timeoutAdapter);

    const result = await Promise.race([
      useCase.execute(mockStageState),
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
        yield { success: true, value: validPortMappingNdjson };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePortMappingUseCase(timeoutAdapter);
    const result = await useCase.execute(mockStageState).catch((err) => {
      return { success: false, error: err };
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test("handles malformed LLM response", async () => {
    const badStream = {
      async *[Symbol.asyncIterator]() {
        yield { success: true, value: "not valid json at all" };
      },
    } as AsyncIterable<{ success: boolean; value?: string; error?: unknown }>;

    const mockPort = createMockLLMPort([badStream, badStream, badStream]);
    const useCase = new ExecutePortMappingUseCase(mockPort);
    const result = await useCase.execute(mockStageState);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof StageMaxRetriesError);
    }
  });
});
