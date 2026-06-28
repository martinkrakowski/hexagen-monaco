import { test, describe } from "vitest";
import assert from "node:assert";
import { ExecutePortMappingUseCase } from "../../../src/application/use-cases/staged-generation/execute-port-mapping.use-case.ts";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { PipelineState } from "../../../src/domain/value-objects/pipeline-state";
import type { LLMRequest } from "@hexagen/local-llm/client";
import { STAGE3_ESCALATION_CONFIG } from "../../../src/application/use-cases/staged-generation/retry-with-escalation.ts";

const validPortMappingNdjson = [
  '{"contextName":"invoice-management","direction":"in","name":"createInvoice","portType":"command","description":"Creates invoice"}',
].join("\n");

const mockStageState: Required<
  Pick<PipelineState, "stage0" | "stage1" | "stage2">
> = {
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

  test("default STAGE3_ESCALATION_CONFIG is escalation-only (no hardcoded model, no same-model re-runs)", () => {
    // escalationModel intentionally undefined so non-OpenAI providers don't 404
    // on retry; the wiring layer injects one via env when the provider supports
    // it. maxDefault/maxEscalated are 1 because runSingleAttempt already retries
    // the same model internally (MAX_RETRY_ATTEMPTS) — this wrapper only switches
    // models, so >1 here re-runs the whole inner loop (3×3 = 9 calls/context).
    assert.strictEqual(STAGE3_ESCALATION_CONFIG.escalationModel, undefined);
    assert.strictEqual(STAGE3_ESCALATION_CONFIG.maxDefaultRetries, 1);
    assert.strictEqual(STAGE3_ESCALATION_CONFIG.maxEscalatedRetries, 1);
  });

  test("a persistently-failing context makes only the inner-loop attempts, not the nested 3×3", async () => {
    // Regression: runSingleAttempt's own MAX_RETRY_ATTEMPTS loop was ALSO wrapped
    // by retryWithEscalation's default retries (3), so one hard-failing context
    // burned 3×3 = 9 calls and logged the exhaustion banner 3×. With the wrapper
    // escalation-only (maxDefaultRetries: 1) it's just the inner attempts, once.
    let calls = 0;
    const mockPort = {
      streamStructuredRequest: () => {
        calls++;
        async function* stream() {
          yield { success: true, value: "not valid json" };
        }
        return stream();
      },
    } as unknown as SendStructuredRequestPort;

    let exhaustionBanners = 0;
    const useCase = new ExecutePortMappingUseCase(
      mockPort,
      STAGE3_ESCALATION_CONFIG,
    );
    const result = await useCase.execute(mockStageState, (chunk) => {
      if (chunk.includes("attempts exhausted")) exhaustionBanners++;
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(
      calls,
      3,
      `expected 3 inner attempts, not the nested 9; got ${calls}`,
    );
    assert.strictEqual(
      exhaustionBanners,
      1,
      "exhaustion banner must log once, not once per outer retry",
    );
  });

  test("accumulates inner retries across the default AND escalated model chains", async () => {
    // The reported retryCount must sum same-model retries from EVERY
    // runSingleAttempt chain, not just the last. Here the default model exhausts
    // its inner loop (2 retries) and the escalation model succeeds first try (0
    // inner retries) → 2 inner + 1 escalation switch = 3. Storing only the last
    // chain's count would report 1.
    const mockPort = {
      streamStructuredRequest: (req: LLMRequest) => {
        async function* stream() {
          if (req.preferredCloudModel) {
            yield { success: true, value: validPortMappingNdjson };
          } else {
            yield { success: true, value: "not valid json" };
          }
        }
        return stream();
      },
    } as unknown as SendStructuredRequestPort;

    const config = {
      maxDefaultRetries: 1,
      maxEscalatedRetries: 1,
      escalationModel: "gpt-4o",
    };
    let reportedRetryCount: number | undefined;
    const useCase = new ExecutePortMappingUseCase(mockPort, config);
    const result = await useCase.execute(mockStageState, undefined, (t) => {
      reportedRetryCount = t.retryCount;
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(
      reportedRetryCount,
      3,
      "2 default-chain inner retries + 1 escalation switch (escalated chain succeeded first try)",
    );
  });
});
