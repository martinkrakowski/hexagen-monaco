import { test, describe } from "node:test";
import assert from "node:assert";
import { ExecutePortMappingUseCase } from "../../../src/application/use-cases/staged-generation/execute-port-mapping.use-case.ts";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { PipelineState } from "../../../src/domain/value-objects/pipeline-state";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry";

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
      {
        name: "billing",
        type: "core" as const,
        reasoning: "Manages billing",
      },
    ],
    rejected: [],
    uncertain: [],
  } as any,
};

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
        content: validPortMappingNdjson,
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

describe("ExecutePortMappingUseCase", () => {
  test("happy path: valid stage0+stage1+stage2 returns PortMappingResult", async () => {
    const mockPort = createMockLLMPort(() =>
      createSuccessStream(validPortMappingNdjson),
    );
    const useCase = new ExecutePortMappingUseCase(mockPort);
    const result = await useCase.execute(mockStageState);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.value.portMap.contexts.length > 0);
      assert.ok(
        result.value.contextMappings.length > 0,
        "Expected non-empty context mappings",
      );
      assert.ok(
        result.value.contextMappings.some(
          (m) =>
            m.upstream === "billing" && m.downstream === "invoice-management",
        ),
        "Expected context mapping between billing and invoice-management",
      );
    }
  });

  test("telemetry callback is invoked on success", async () => {
    const telemetryCalls: StageTelemetry[] = [];
    const mockPort = createMockLLMPort(() =>
      createSuccessStream(validPortMappingNdjson),
    );
    const useCase = new ExecutePortMappingUseCase(mockPort);
    const onStageTelemetry = (telemetry: StageTelemetry) => {
      telemetryCalls.push(telemetry);
    };
    await useCase.execute(mockStageState, undefined, onStageTelemetry);

    assert.strictEqual(telemetryCalls.length, 1);
    const telemetry = telemetryCalls[0];
    assert.strictEqual(telemetry.stage, 3);
    assert.strictEqual(telemetry.label, "Port Mapping");
    assert.ok(telemetry.durationMs >= 0);
    assert.strictEqual(telemetry.usedLLM, true);
    assert.strictEqual(telemetry.retryCount, 0);
  });

  test("handles stream error from LLM", async () => {
    const mockPort = createMockLLMPort(() =>
      createErrorStream(new Error("LLM request timeout")),
    );

    const useCase = new ExecutePortMappingUseCase(mockPort);
    const result = await useCase.execute(mockStageState);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.portMap.contexts.length, 0);
    }
  });

  test("returns empty port map on persistent stream errors", async () => {
    const mockPort = createMockLLMPort(() =>
      createErrorStream(new Error("Persistent timeout")),
    );

    const useCase = new ExecutePortMappingUseCase(mockPort);
    const result = await useCase.execute(mockStageState);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.portMap.contexts.length, 0);
    }
  });

  test("handles malformed LLM response", async () => {
    const mockPort = createMockLLMPort(() => createMalformedStream());

    const useCase = new ExecutePortMappingUseCase(mockPort);
    const result = await useCase.execute(mockStageState);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.portMap.contexts.length, 0);
    }
  });
});
