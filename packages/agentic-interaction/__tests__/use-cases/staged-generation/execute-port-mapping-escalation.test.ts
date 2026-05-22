import { test, describe } from "node:test";
import assert from "node:assert";
import { ExecutePortMappingUseCase } from "../../../src/application/use-cases/staged-generation/execute-port-mapping.use-case.ts";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { PipelineState } from "../../../src/domain/value-objects/pipeline-state";
import type { LLMRequest } from "@hexagen/local-llm/client";
import { STAGE3_ESCALATION_CONFIG } from "../../../src/application/use-cases/staged-generation/retry-with-escalation.ts";

const validPortMappingNdjson = [
  '{"contextName":"invoice-management","direction":"in","name":"createInvoice","portType":"command","description":"Creates invoice"}',
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

describe("Stage 3 Escalation", () => {
  test("escalates to preferredCloudModel when default model returns no objects", async () => {
    const requestedModels: (string | undefined)[] = [];

    const mockPort: SendStructuredRequestPort = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "test-model" as any,
          content: "",
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: (req: LLMRequest) => {
        requestedModels.push(req.preferredCloudModel);

        async function* stream() {
          if (!req.preferredCloudModel) {
            yield { success: true, value: "not valid json" };
          } else {
            yield { success: true, value: validPortMappingNdjson };
          }
        }
        return stream();
      },
    } as unknown as SendStructuredRequestPort;

    const config = {
      maxDefaultRetries: 2,
      maxEscalatedRetries: 2,
      escalationModel: "gpt-4o",
    };

    const useCase = new ExecutePortMappingUseCase(mockPort, config);
    const result = await useCase.execute(mockStageState);

    assert.strictEqual(result.success, true);
    assert.ok(
      requestedModels.some((m) => m === "gpt-4o"),
      `Expected escalation to gpt-4o, got models: ${JSON.stringify(requestedModels)}`,
    );
    if (result.success) {
      assert.ok(
        result.value.portMap.contexts.length > 0,
        "Expected port mappings after escalation",
      );
    }
  });

  test("does not escalate when escalationModel is undefined", async () => {
    const requestedModels: (string | undefined)[] = [];

    const mockPort: SendStructuredRequestPort = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "test-model" as any,
          content: "",
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: (req: LLMRequest) => {
        requestedModels.push(req.preferredCloudModel);

        async function* stream() {
          yield { success: true, value: "not valid json" };
        }
        return stream();
      },
    } as unknown as SendStructuredRequestPort;

    const config = {
      maxDefaultRetries: 2,
      maxEscalatedRetries: 2,
      escalationModel: undefined,
    };

    const useCase = new ExecutePortMappingUseCase(mockPort, config);
    await useCase.execute(mockStageState);

    assert.ok(
      requestedModels.length > 0,
      "Expected at least one streaming request",
    );
    assert.ok(
      requestedModels.every((m) => m === undefined),
      `Expected no escalationModel, got: ${JSON.stringify(requestedModels)}`,
    );
  });

  test("default STAGE3_ESCALATION_CONFIG has no hardcoded escalationModel", () => {
    // Intentionally undefined so non-OpenAI providers don't 404 on retry.
    // The wiring layer injects an escalation model via env (LLM_ESCALATION_MODEL)
    // when it knows the configured provider supports it.
    assert.strictEqual(STAGE3_ESCALATION_CONFIG.escalationModel, undefined);
    assert.strictEqual(STAGE3_ESCALATION_CONFIG.maxDefaultRetries, 3);
    assert.strictEqual(STAGE3_ESCALATION_CONFIG.maxEscalatedRetries, 3);
  });
});
