import { test, describe } from "vitest";
import assert from "node:assert";
import { ExecutePortMappingUseCase } from "../../../src/application/use-cases/staged-generation/execute-port-mapping.use-case.ts";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { PipelineState } from "../../../src/domain/value-objects/pipeline-state";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry";
import { STAGE3_PORTS_SYSTEM_PROMPT } from "../../../src/domain/prompts/generate-manifest.prompt.ts";

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

  test("telemetry reports the model resolved via the streaming side-channel", async () => {
    // Streaming stages have no in-band metadata channel (bare string chunks),
    // so the adapter reports the served model through request.onModelResolved
    // — the use case must wire its capture into every dispatched request.
    const mockPort = {
      streamStructuredRequest: (request: {
        onModelResolved?: (info: { provider: string; model: string }) => void;
      }) => {
        request.onModelResolved?.({
          provider: "inception",
          model: "mercury-2",
        });
        return createSuccessStream(validPortMappingNdjson);
      },
    } as unknown as SendStructuredRequestPort;

    const telemetryCalls: StageTelemetry[] = [];
    const useCase = new ExecutePortMappingUseCase(mockPort);
    const result = await useCase.execute(mockStageState, undefined, (t) =>
      telemetryCalls.push(t),
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(telemetryCalls.length, 1);
    assert.strictEqual(telemetryCalls[0].modelName, "mercury-2");
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

  test("parser captures justification field from NDJSON", async () => {
    const ndjsonWithJustification = [
      '{"contextName":"invoice-management","direction":"in","name":"CreateInvoicePort","portType":"command","description":"Creates a new invoice for a customer order","justification":"Invoice aggregate requires a command entry point to initiate invoice lifecycle from order placement events"}',
    ].join("\n");
    const mockPort = createMockLLMPort(() =>
      createSuccessStream(ndjsonWithJustification),
    );
    const useCase = new ExecutePortMappingUseCase(mockPort);
    const result = await useCase.execute(mockStageState);

    assert.strictEqual(result.success, true);
    if (result.success) {
      const ctx = result.value.portMap.contexts.find(
        (c) => c.contextName === "invoice-management",
      );
      assert.ok(ctx, "Expected invoice-management context");
      const port = ctx.in.find((p) => p.name === "CreateInvoicePort");
      assert.ok(port, "Expected CreateInvoicePort");
      assert.strictEqual(
        port.justification,
        "Invoice aggregate requires a command entry point to initiate invoice lifecycle from order placement events",
      );
    }
  });

  test("parser handles NDJSON without justification (optional field)", async () => {
    const ndjsonWithoutJustification = [
      '{"contextName":"invoice-management","direction":"in","name":"CreateInvoicePort","portType":"command","description":"Creates a new invoice for a customer order"}',
    ].join("\n");
    const mockPort = createMockLLMPort(() =>
      createSuccessStream(ndjsonWithoutJustification),
    );
    const useCase = new ExecutePortMappingUseCase(mockPort);
    const result = await useCase.execute(mockStageState);

    assert.strictEqual(result.success, true);
    if (result.success) {
      const ctx = result.value.portMap.contexts.find(
        (c) => c.contextName === "invoice-management",
      );
      assert.ok(ctx, "Expected invoice-management context");
      const port = ctx.in.find((p) => p.name === "CreateInvoicePort");
      assert.ok(port, "Expected CreateInvoicePort");
      assert.strictEqual(port.justification, undefined);
    }
  });
});

describe("Stage 3 Prompt Shape", () => {
  test("STAGE3_PORTS_SYSTEM_PROMPT contains PORT JUSTIFICATION block", () => {
    assert.ok(
      STAGE3_PORTS_SYSTEM_PROMPT.includes("PORT JUSTIFICATION"),
      "Stage 3 prompt must include PORT JUSTIFICATION instruction block",
    );
  });

  test("STAGE3_PORTS_SYSTEM_PROMPT includes justification field in NDJSON example", () => {
    assert.ok(
      STAGE3_PORTS_SYSTEM_PROMPT.includes('"justification"'),
      'Stage 3 prompt NDJSON example must include "justification" field',
    );
  });

  test("STAGE3_PORTS_SYSTEM_PROMPT describes good vs bad justification examples", () => {
    assert.ok(
      STAGE3_PORTS_SYSTEM_PROMPT.includes("BAD:") &&
        STAGE3_PORTS_SYSTEM_PROMPT.includes("GOOD:"),
      "Stage 3 prompt must include BAD/GOOD justification examples",
    );
  });
});
