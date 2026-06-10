import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import { ExecuteDomainExtractionUseCase } from "../../../src/application/use-cases/staged-generation/execute-domain-extraction.use-case.ts";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { PipelineState } from "../../../src/domain/value-objects/pipeline-state";
import { StageMaxRetriesError } from "../../../src/domain/errors/stage-errors";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry";
import { estimateTokenCount } from "../../../src/domain/value-objects/stage-telemetry";
import { compileStage1Prompt } from "../../../src/domain/index";
import { compileStage1RefinementUserPrompt } from "../../../src/domain/prompts/generate-manifest.prompt";

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

  test("recovers implied subdomains from aggregateRoot and useCase lines", async () => {
    // Mercury-2 probes: the model under-emits standalone "subdomain" lines
    // (sometimes one, sometimes a DISJOINT one) while still assigning every
    // aggregate/use case a subdomain. The parser unions them back: declared
    // lines first, implied appended in encounter order, exact-string dedupe.
    const underReportedNdjson = [
      '{"type":"subdomain","value":"Customer Notification"}',
      '{"type":"aggregateRoot","name":"Product","subdomain":"Catalog Management"}',
      '{"type":"aggregateRoot","name":"Order","subdomain":"Ordering"}',
      '{"type":"useCase","name":"Pay Invoice","subdomain":"Payments"}',
      '{"type":"useCase","name":"Notify Customer","subdomain":"Customer Notification"}',
    ].join("\n");
    const mockPort = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: underReportedNdjson,
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: underReportedNdjson };
      },
    } as unknown as SendStructuredRequestPort;
    const useCase = new ExecuteDomainExtractionUseCase(mockPort);
    const result = await useCase.execute(mockStage0State);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.value.subdomains, [
        "Customer Notification",
        "Catalog Management",
        "Ordering",
        "Payments",
      ]);
    }
  });

  // Collapse soft-retry fixtures: a "rich" domain (3 aggregates) crammed into
  // one subdomain vs the properly decomposed equivalent.
  const collapsedRichNdjson = [
    '{"type":"subdomain","value":"Shop Management"}',
    '{"type":"aggregateRoot","name":"Product","subdomain":"Shop Management"}',
    '{"type":"aggregateRoot","name":"Order","subdomain":"Shop Management"}',
    '{"type":"aggregateRoot","name":"Payment","subdomain":"Shop Management"}',
  ].join("\n");
  const decomposedNdjson = [
    '{"type":"subdomain","value":"Catalog"}',
    '{"type":"subdomain","value":"Ordering"}',
    '{"type":"subdomain","value":"Payments"}',
    '{"type":"aggregateRoot","name":"Product","subdomain":"Catalog"}',
    '{"type":"aggregateRoot","name":"Order","subdomain":"Ordering"}',
    '{"type":"aggregateRoot","name":"Payment","subdomain":"Payments"}',
  ].join("\n");

  const createSequencedPort = (contents: string[]) => {
    let calls = 0;
    const port = {
      sendRequest: async () => {
        const content = contents[Math.min(calls, contents.length - 1)];
        calls++;
        return {
          success: true as const,
          value: {
            id: "test",
            modelId: "gpt-4o-mini" as any,
            content,
            finishReason: "stop" as const,
            timestamp: Date.now(),
          },
        };
      },
    } as unknown as SendStructuredRequestPort;
    return { port, callCount: () => calls };
  };

  test("soft-retries when a rich domain collapses to one subdomain", async () => {
    const { port, callCount } = createSequencedPort([
      collapsedRichNdjson,
      decomposedNdjson,
    ]);
    const useCase = new ExecuteDomainExtractionUseCase(port);
    const result = await useCase.execute(mockStage0State);
    assert.strictEqual(callCount(), 2);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.value.subdomains, [
        "Catalog",
        "Ordering",
        "Payments",
      ]);
    }
  });

  test("accepts the collapsed result when decomposition retries are exhausted", async () => {
    // Every attempt collapses — return the last valid result rather than
    // failing the run (a single-context manifest can still be coherent).
    const { port, callCount } = createSequencedPort([collapsedRichNdjson]);
    const useCase = new ExecuteDomainExtractionUseCase(port);
    const result = await useCase.execute(mockStage0State);
    assert.strictEqual(callCount(), 3); // MAX_RETRY_ATTEMPTS
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.value.subdomains, ["Shop Management"]);
      assert.strictEqual(result.value.aggregateRoots?.length, 3);
    }
  });

  test("falls back to the collapsed result when retry attempts fail to parse", async () => {
    // Attempt 1 collapses, attempts 2-3 return garbage: the collapsed-but-
    // valid attempt must win over StageMaxRetriesError (pre-retry behavior
    // returned it immediately, so erroring here would be a regression).
    const { port, callCount } = createSequencedPort([
      collapsedRichNdjson,
      "not json at all",
      "still not json",
    ]);
    const useCase = new ExecuteDomainExtractionUseCase(port);
    const result = await useCase.execute(mockStage0State);
    assert.strictEqual(callCount(), 3);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.value.subdomains, ["Shop Management"]);
    }
  });

  test("does not retry a small domain with a single subdomain", async () => {
    // 2 aggregates is below the multi-capability threshold (3+ aggregates or
    // 4+ use cases) — a single subdomain is plausible, accept first attempt.
    const smallDomain = [
      '{"type":"subdomain","value":"Library"}',
      '{"type":"aggregateRoot","name":"Book","subdomain":"Library"}',
      '{"type":"aggregateRoot","name":"Member","subdomain":"Library"}',
    ].join("\n");
    const { port, callCount } = createSequencedPort([smallDomain]);
    const useCase = new ExecuteDomainExtractionUseCase(port);
    const result = await useCase.execute(mockStage0State);
    assert.strictEqual(callCount(), 1);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.value.subdomains, ["Library"]);
    }
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

  describe("stage-1 refinement cascade", () => {
    // The refiner's (better) take on the decomposed shop domain — one more
    // subdomain than the draft.
    const enrichedNdjson = [
      '{"type":"subdomain","value":"Catalog"}',
      '{"type":"subdomain","value":"Ordering"}',
      '{"type":"subdomain","value":"Payments"}',
      '{"type":"subdomain","value":"Customer Accounts"}',
      '{"type":"aggregateRoot","name":"Product","subdomain":"Catalog"}',
      '{"type":"aggregateRoot","name":"Order","subdomain":"Ordering"}',
      '{"type":"aggregateRoot","name":"Payment","subdomain":"Payments"}',
      '{"type":"aggregateRoot","name":"Customer","subdomain":"Customer Accounts"}',
    ].join("\n");

    test("always mode refines a successful draft", async () => {
      const draft = createSequencedPort([decomposedNdjson]);
      const refiner = createSequencedPort([enrichedNdjson]);
      const telemetryCalls: StageTelemetry[] = [];
      const useCase = new ExecuteDomainExtractionUseCase(draft.port, {
        port: refiner.port,
        mode: "always",
      });
      const result = await useCase.execute(mockStage0State, undefined, (t) =>
        telemetryCalls.push(t),
      );
      assert.strictEqual(draft.callCount(), 1);
      assert.strictEqual(refiner.callCount(), 1);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.value.subdomains, [
          "Catalog",
          "Ordering",
          "Payments",
          "Customer Accounts",
        ]);
      }
      assert.ok(telemetryCalls[0].summary.includes("cascade refined 3→4"));
    });

    test("telemetry counts the refinement request's input and output tokens", async () => {
      // Baseline: same draft, no refiner configured.
      const baselineTelemetry: StageTelemetry[] = [];
      await new ExecuteDomainExtractionUseCase(
        createSequencedPort([decomposedNdjson]).port,
      ).execute(mockStage0State, undefined, (t) => baselineTelemetry.push(t));

      const cascadeTelemetry: StageTelemetry[] = [];
      const useCase = new ExecuteDomainExtractionUseCase(
        createSequencedPort([decomposedNdjson]).port,
        { port: createSequencedPort([enrichedNdjson]).port, mode: "always" },
      );
      await useCase.execute(mockStage0State, undefined, (t) =>
        cascadeTelemetry.push(t),
      );

      const expectedExtraInput = estimateTokenCount(
        compileStage1RefinementUserPrompt(
          compileStage1Prompt(mockStage0State),
          decomposedNdjson,
        ),
      );
      assert.strictEqual(
        cascadeTelemetry[0].inputTokensEstimate,
        (baselineTelemetry[0].inputTokensEstimate ?? 0) + expectedExtraInput,
      );
      assert.strictEqual(
        cascadeTelemetry[0].outputTokensActual,
        (baselineTelemetry[0].outputTokensActual ?? 0) +
          estimateTokenCount(enrichedNdjson),
      );
    });

    test("rejects a refined output that loses subdomains", async () => {
      // The refiner must never DESTROY decomposition: a refined output with
      // fewer post-union subdomains than the draft is discarded.
      const collapsedRefinerOutput = [
        '{"type":"subdomain","value":"Shop Management"}',
        '{"type":"aggregateRoot","name":"Shop","subdomain":"Shop Management"}',
      ].join("\n");
      const draft = createSequencedPort([decomposedNdjson]);
      const refiner = createSequencedPort([collapsedRefinerOutput]);
      const useCase = new ExecuteDomainExtractionUseCase(draft.port, {
        port: refiner.port,
        mode: "always",
      });
      const result = await useCase.execute(mockStage0State);
      assert.strictEqual(refiner.callCount(), 1);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.value.subdomains, [
          "Catalog",
          "Ordering",
          "Payments",
        ]);
      }
    });

    test("keeps the draft when the refiner throws", async () => {
      const draft = createSequencedPort([decomposedNdjson]);
      const throwingRefiner = {
        sendRequest: async () => {
          throw new Error("refiner provider down");
        },
      } as unknown as SendStructuredRequestPort;
      const useCase = new ExecuteDomainExtractionUseCase(draft.port, {
        port: throwingRefiner,
        mode: "always",
      });
      const result = await useCase.execute(mockStage0State);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.value.subdomains, [
          "Catalog",
          "Ordering",
          "Payments",
        ]);
      }
    });

    test("keeps the draft when the refiner returns garbage", async () => {
      const draft = createSequencedPort([decomposedNdjson]);
      const refiner = createSequencedPort(["not ndjson at all"]);
      const useCase = new ExecuteDomainExtractionUseCase(draft.port, {
        port: refiner.port,
        mode: "always",
      });
      const result = await useCase.execute(mockStage0State);
      assert.strictEqual(refiner.callCount(), 1);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.value.subdomains, [
          "Catalog",
          "Ordering",
          "Payments",
        ]);
      }
    });

    test("escalation mode skips refinement on a multi-subdomain draft", async () => {
      const draft = createSequencedPort([decomposedNdjson]);
      const refiner = createSequencedPort([enrichedNdjson]);
      const useCase = new ExecuteDomainExtractionUseCase(draft.port, {
        port: refiner.port,
        mode: "escalation",
      });
      const result = await useCase.execute(mockStage0State);
      assert.strictEqual(refiner.callCount(), 0);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.value.subdomains, [
          "Catalog",
          "Ordering",
          "Payments",
        ]);
      }
    });

    test("escalation mode refines a draft that stays collapsed through soft-retries", async () => {
      // All 3 attempts collapse → the final attempt is accepted with 1
      // subdomain → escalation fires the refiner, which rescues it.
      const draft = createSequencedPort([collapsedRichNdjson]);
      const refiner = createSequencedPort([decomposedNdjson]);
      const useCase = new ExecuteDomainExtractionUseCase(draft.port, {
        port: refiner.port,
        mode: "escalation",
      });
      const result = await useCase.execute(mockStage0State);
      assert.strictEqual(draft.callCount(), 3);
      assert.strictEqual(refiner.callCount(), 1);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.value.subdomains, [
          "Catalog",
          "Ordering",
          "Payments",
        ]);
      }
    });

    test("refines the collapsed fallback on the error path", async () => {
      // Attempt 1 collapses, attempts 2-3 return garbage: the collapsed
      // fallback is accepted via the failure path — and a held fallback is by
      // definition <2 subdomains, so the cascade fires there in BOTH modes.
      const draft = createSequencedPort([
        collapsedRichNdjson,
        "not json at all",
        "still not json",
      ]);
      const refiner = createSequencedPort([decomposedNdjson]);
      const useCase = new ExecuteDomainExtractionUseCase(draft.port, {
        port: refiner.port,
        mode: "escalation",
      });
      const result = await useCase.execute(mockStage0State);
      assert.strictEqual(draft.callCount(), 3);
      assert.strictEqual(refiner.callCount(), 1);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.value.subdomains, [
          "Catalog",
          "Ordering",
          "Payments",
        ]);
      }
    });
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
