import { test, describe } from "node:test";
import assert from "node:assert";
import { ExecuteValidationReviewUseCase } from "../../../src/application/use-cases/staged-generation/execute-validation-review.use-case.ts";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { StageMaxRetriesError } from "../../../src/domain/errors/stage-errors";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry";
import {
  STAGE6_VALIDATION_SYSTEM_PROMPT,
  compileStage6Prompt,
} from "../../../src/domain/prompts/generate-manifest.prompt.ts";
import { CONTEXT_NAME_VALIDATION_BANS } from "../../../src/domain/prompts/architecture-contract.ts";

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
    // Fixture rule is R02 (not R01): R01 claims from the LLM are discarded
    // by design since the judge-grounding fix — see the dedicated describe.
    const ndjson =
      '{"type":"result","passed":false,"errors":[{"rule":"R02","message":"Context has no inbound ports"}]}\n';
    const mockLLM = createMockLLMPort(() => createSuccessStream(ndjson));

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, false);
      assert.ok(result.value.errors.length > 0);
      const errorsString = JSON.stringify(result.value.errors);
      assert.ok(errorsString.includes("R02"));
    }
  });

  test("programmatic R18: VercelClientPort in stage3 surfaces as error", async () => {
    const mockLLM = createMockLLMPort(() =>
      createSuccessStream(validValidationNdjson),
    );
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = {
      ...createMockPipelineState(),
      stage1: {
        verbs: [],
        nouns: [],
        subdomains: ["invoice-management"],
        aggregateRoots: [{ name: "Invoice", subdomain: "invoice-management" }],
      },
      stage3: {
        contexts: [
          {
            contextName: "invoice-management",
            in: [],
            out: [
              {
                name: "VercelClientPort",
                type: "external-client" as const,
                description:
                  "Client integration for Vercel deployment platform infrastructure",
              },
            ],
          },
        ],
      },
    };
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, false);
      const errorsString = JSON.stringify(result.value.errors);
      assert.ok(
        errorsString.includes("R18"),
        `Expected R18 error, got: ${errorsString}`,
      );
      assert.ok(errorsString.includes("VercelClientPort"));
    }
  });

  test("programmatic R18 (runtime-concern): EmailRetryPort triggers when runtime concern present", async () => {
    const mockLLM = createMockLLMPort(() =>
      createSuccessStream(validValidationNdjson),
    );
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = {
      ...createMockPipelineState(),
      stage0: {
        ...createMockPipelineState().stage0,
        runtimeConcerns: ["email-retry"],
      },
      stage1: {
        verbs: [],
        nouns: [],
        subdomains: ["notification-delivery"],
        aggregateRoots: [],
      },
      stage3: {
        contexts: [
          {
            contextName: "notification-delivery",
            in: [],
            out: [
              {
                name: "EmailRetryPort",
                type: "notifier" as const,
                description:
                  "Handles email retry logic for notification dispatch",
              },
            ],
          },
        ],
      },
    };
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, false);
      const errorsString = JSON.stringify(result.value.errors);
      assert.ok(errorsString.includes("R18"));
      assert.ok(errorsString.includes("email-retry"));
    }
  });

  test("programmatic R17: forAggregate not in aggregate roots surfaces as error", async () => {
    const mockLLM = createMockLLMPort(() =>
      createSuccessStream(validValidationNdjson),
    );
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = {
      ...createMockPipelineState(),
      stage1: {
        verbs: [],
        nouns: [],
        subdomains: ["invoice-management"],
        aggregateRoots: [{ name: "Invoice", subdomain: "invoice-management" }],
      },
      stage3: {
        contexts: [
          {
            contextName: "invoice-management",
            in: [],
            out: [
              {
                name: "BogusRepositoryPort",
                type: "repository" as const,
                description:
                  "Provides persistence for the fabricated aggregate",
                forAggregate: "NotReal",
              },
            ],
          },
        ],
      },
    };
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, false);
      const errorsString = JSON.stringify(result.value.errors);
      assert.ok(errorsString.includes("R17"));
      assert.ok(errorsString.includes("NotReal"));
    }
  });
});

describe("deterministic R01 (judge-grounding fix)", () => {
  // R01 moved out of the LLM's checklist: on weak models the rule text plus
  // banned-token list invited exemplar parroting ('Postgres' reported against
  // every context name in every run — baseline findings F3). The pipeline now
  // computes R01 via isBannedContextName and discards any LLM R01 claim.

  test("banned accepted context name surfaces as R01 error even when the LLM passes", async () => {
    const mockLLM = createMockLLMPort(() =>
      createSuccessStream(validValidationNdjson),
    );
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = {
      ...createMockPipelineState(),
      stage2: {
        accepted: [
          {
            name: "payment-gateway",
            type: "core" as const,
            reasoning: "Handles payments",
          },
        ],
        rejected: [],
        uncertain: [],
      },
    };
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, false);
      const errorsString = JSON.stringify(result.value.errors);
      assert.ok(
        errorsString.includes("R01"),
        `Expected deterministic R01 error, got: ${errorsString}`,
      );
      assert.ok(errorsString.includes("payment-gateway"));
    }
  });

  test("prose-only 'rest' carve-out does not trip deterministic R01", async () => {
    const mockLLM = createMockLLMPort(() =>
      createSuccessStream(validValidationNdjson),
    );
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = {
      ...createMockPipelineState(),
      stage2: {
        accepted: [
          {
            name: "driver-rest-periods",
            type: "core" as const,
            reasoning: "Tracks mandated driver rest periods",
          },
        ],
        rejected: [],
        uncertain: [],
      },
    };
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, true);
      assert.deepStrictEqual(result.value.errors, []);
    }
  });

  test("LLM-emitted R01 claims are discarded (line form)", async () => {
    // The exact hallucination shape observed on gpt-4o-mini: R01 parroted
    // against a clean name. The deterministic check is the sole R01 source.
    const ndjson =
      '{"type":"error","rule":"R01","message":"Context \'invoice-management\' violates R01: name contains technology noun \'Postgres\'."}\n{"type":"result","passed":false}\n';
    const mockLLM = createMockLLMPort(() => createSuccessStream(ndjson));
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.value.errors, []);
      // passed is re-derived after the discard — the LLM's own
      // passed:false verdict must not survive its discarded evidence.
      assert.strictEqual(result.value.passed, true);
    }
  });

  test("LLM-emitted R01 claims are discarded when only the rule field names R01 (qodo bypass)", async () => {
    // Per the prompt's exemplars, messages do NOT contain the rule token —
    // the rule id lives in the separate "rule" field. The discard must work
    // off that field (via parse-time tagging), not off message prose.
    const ndjson =
      '{"type":"error","rule":"R01","message":"Context \'invoice-management\' contains technology noun \'Postgres\'."}\n{"type":"result","passed":false}\n';
    const mockLLM = createMockLLMPort(() => createSuccessStream(ndjson));
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const result = await useCase.execute(createMockPipelineState());

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.value.errors, []);
      assert.strictEqual(result.value.passed, true);
    }
  });

  test("R01 discard is case-insensitive on the rule id", async () => {
    const ndjson =
      '{"type":"error","rule":"r01","message":"name contains technology noun"}\n{"type":"result","passed":false}\n';
    const mockLLM = createMockLLMPort(() => createSuccessStream(ndjson));
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const result = await useCase.execute(createMockPipelineState());

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.value.errors, []);
      assert.strictEqual(result.value.passed, true);
    }
  });

  test("line-form findings are tagged with their rule id (non-R01 survives, tagged)", async () => {
    const ndjson =
      '{"type":"error","rule":"R02","message":"Context \'invoice-management\' has no inbound ports."}\n{"type":"warning","rule":"R10","message":"No publisher port."}\n{"type":"result","passed":false}\n';
    const mockLLM = createMockLLMPort(() => createSuccessStream(ndjson));
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const result = await useCase.execute(createMockPipelineState());

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, false);
      assert.ok(result.value.errors[0].startsWith("[R02] "));
      assert.ok(result.value.warnings[0].startsWith("[R10] "));
    }
  });

  test("LLM-emitted R01 claims are discarded (result-array form)", async () => {
    const ndjson =
      '{"type":"result","passed":false,"errors":[{"rule":"R01","message":"Context \'invoice-management\' violates R01: name contains technology noun \'postgres\'."},{"rule":"R02","message":"Context \'invoice-management\' has no inbound ports."}]}\n';
    const mockLLM = createMockLLMPort(() => createSuccessStream(ndjson));
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      const errorsString = JSON.stringify(result.value.errors);
      assert.ok(!errorsString.includes("R01"), `R01 survived: ${errorsString}`);
      assert.ok(errorsString.includes("R02"), "non-R01 errors must survive");
      assert.strictEqual(result.value.passed, false);
    }
  });
});

describe("deterministic R16/R17/R18 (LLM-duplicate discard, A4 pull-forward)", () => {
  // collectPortQualityIssues recomputes the port-quality rules exactly
  // (validatePortQuality, runtime-concern net included), so LLM claims for
  // R16/R17/R18 are at best double-counted duplicates of the programmatic
  // findings — the 2026-06-10 model sweep showed LLM R17s on every model
  // alongside the programmatic ones. Same policy as R01: the deterministic
  // result is the sole source.

  test("LLM-emitted R16/R17/R18 claims are discarded (line form)", async () => {
    const ndjson =
      '{"type":"warning","rule":"R16","message":"Port description is trivial."}\n' +
      '{"type":"error","rule":"R17","message":"Port forAggregate \'Ghost\' is not a known aggregate root."}\n' +
      '{"type":"error","rule":"R18","message":"Port name leaks deployment platform \'Vercel\'."}\n' +
      '{"type":"result","passed":false}\n';
    const mockLLM = createMockLLMPort(() => createSuccessStream(ndjson));
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    // No stage3 in the mock state → no programmatic issues either, so the
    // report must come out empty with passed re-derived to true.
    const result = await useCase.execute(createMockPipelineState());

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.value.errors, []);
      assert.deepStrictEqual(result.value.warnings, []);
      assert.strictEqual(result.value.passed, true);
    }
  });

  test("LLM R17 duplicate is discarded while the programmatic R17 survives (no double count)", async () => {
    const ndjson =
      '{"type":"error","rule":"R17","message":"Port forAggregate \'NotReal\' is not a known aggregate root."}\n' +
      '{"type":"result","passed":false}\n';
    const mockLLM = createMockLLMPort(() => createSuccessStream(ndjson));
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = {
      ...createMockPipelineState(),
      stage3: {
        contexts: [
          {
            contextName: "invoice-management",
            in: [
              {
                name: "CreateInvoicePort",
                type: "command",
                description:
                  "Accepts invoice creation requests from upstream billing flows.",
                forAggregate: "NotReal",
              },
            ],
            out: [],
          },
        ],
      },
    };
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      const r17Errors = result.value.errors.filter((e) => /\bR17\b/.test(e));
      assert.strictEqual(
        r17Errors.length,
        1,
        `expected exactly one (programmatic) R17, got: ${JSON.stringify(result.value.errors)}`,
      );
      // The survivor is the programmatic finding (context/port shape), not
      // the LLM's prose.
      assert.ok(r17Errors[0].startsWith("[R17] invoice-management/"));
      assert.strictEqual(result.value.passed, false);
    }
  });

  test("LLM-emitted R16/R18 claims are discarded (result-array form)", async () => {
    const ndjson =
      '{"type":"result","passed":false,"errors":[{"rule":"R18","message":"Port name leaks platform."},{"rule":"R02","message":"Context has no inbound ports."}],"warnings":[{"rule":"R16","message":"Port description is trivial."}]}\n';
    const mockLLM = createMockLLMPort(() => createSuccessStream(ndjson));
    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const result = await useCase.execute(createMockPipelineState());

    assert.strictEqual(result.success, true);
    if (result.success) {
      const errorsString = JSON.stringify(result.value.errors);
      assert.ok(!errorsString.includes("R18"), `R18 survived: ${errorsString}`);
      assert.ok(
        errorsString.includes("R02"),
        "non-deterministic rules survive",
      );
      assert.deepStrictEqual(result.value.warnings, []);
      assert.strictEqual(result.value.passed, false);
    }
  });
});

describe("STAGE6_VALIDATION_SYSTEM_PROMPT", () => {
  test("declares R16 (port description quality)", () => {
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /R16/);
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /non-trivial/);
  });

  test("declares R17 (forAggregate must exist)", () => {
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /R17/);
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /forAggregate/);
  });

  test("declares R18 (port-name leak) with regex + runtime-concern checks", () => {
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /R18/);
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /Vercel/);
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /runtime_concerns/);
  });

  test("instructs LLM to run rules R02 through R18 (R01 is deterministic)", () => {
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /R02 through R18/);
    assert.doesNotMatch(STAGE6_VALIDATION_SYSTEM_PROMPT, /R01 through R18/);
  });

  test("declares R01 deterministic and does not interpolate the banned-token list", () => {
    // The joined token list + R01 instructions were the parroting bait
    // (baseline findings F2/F3): the judge copied 'postgres' from its own
    // prompt into findings against clean names.
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /R01/);
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /deterministic/i);
    assert.ok(
      !STAGE6_VALIDATION_SYSTEM_PROMPT.includes(
        CONTEXT_NAME_VALIDATION_BANS.join(", "),
      ),
      "banned-token list must not be interpolated into the judge prompt",
    );
  });

  test("few-shot exemplars do not bait R01 parroting", () => {
    // 'postgres-repo' was the exemplar weak judges echoed verbatim.
    assert.doesNotMatch(STAGE6_VALIDATION_SYSTEM_PROMPT, /postgres-repo/);
    assert.doesNotMatch(STAGE6_VALIDATION_SYSTEM_PROMPT, /"rule": "R01"/);
  });

  test("grounds R02-R06 in the provided port_map and adapter_bindings sections", () => {
    // The old rule text ordered checks on `ports.in` / `implements` paths
    // that the assembled YAML does not contain (name-only lists) — the judge
    // had to confabulate (baseline findings F3).
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /<port_map>/);
    assert.match(STAGE6_VALIDATION_SYSTEM_PROMPT, /<adapter_bindings>/);
  });
});

describe("compileStage6Prompt", () => {
  test("includes <runtime_concerns> section when state.stage0.runtimeConcerns is non-empty", () => {
    const prompt = compileStage6Prompt({
      stage0: {
        intent: "x",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
        runtimeConcerns: ["email-retry", "fly.io"],
      },
      stage5: { yaml: "", parsedObject: {} },
    } as any);
    assert.match(prompt, /<runtime_concerns>/);
    assert.match(prompt, /email-retry/);
    assert.match(prompt, /fly\.io/);
  });

  test("omits <runtime_concerns> section when runtimeConcerns is empty/absent", () => {
    const prompt = compileStage6Prompt({
      stage0: {
        intent: "x",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
      },
      stage5: { yaml: "", parsedObject: {} },
    } as any);
    assert.doesNotMatch(prompt, /<runtime_concerns>/);
  });

  test("includes <port_map> with port names and types when stage3 present", () => {
    const prompt = compileStage6Prompt({
      stage0: {
        intent: "x",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
      },
      stage3: {
        contexts: [
          {
            contextName: "invoice-management",
            in: [
              {
                name: "CreateInvoicePort",
                type: "command" as const,
                description: "Creates a new invoice from order data",
              },
            ],
            out: [
              {
                name: "InvoiceRepositoryPort",
                type: "repository" as const,
                description: "Persists invoice aggregates",
                forAggregate: "Invoice",
              },
            ],
          },
        ],
      },
      stage5: { yaml: "", parsedObject: {} },
    } as any);
    assert.match(prompt, /<port_map>/);
    assert.match(prompt, /CreateInvoicePort/);
    assert.match(prompt, /"type":"command"/);
    assert.match(prompt, /"forAggregate":"Invoice"/);
  });

  test("includes <adapter_bindings> with implements when stage4 present", () => {
    const prompt = compileStage6Prompt({
      stage0: {
        intent: "x",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
      },
      stage4: {
        contexts: [
          {
            contextName: "invoice-management",
            adapters: [
              {
                name: "InMemoryInvoiceAdapter",
                implements: "InvoiceRepositoryPort",
                technology: "in-memory",
              },
            ],
          },
        ],
      },
      stage5: { yaml: "", parsedObject: {} },
    } as any);
    assert.match(prompt, /<adapter_bindings>/);
    assert.match(prompt, /InMemoryInvoiceAdapter/);
    assert.match(prompt, /"implements":"InvoiceRepositoryPort"/);
  });

  test("omits <port_map> and <adapter_bindings> when stages 3/4 absent", () => {
    const prompt = compileStage6Prompt({
      stage0: {
        intent: "x",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
      },
      stage5: { yaml: "", parsedObject: {} },
    } as any);
    assert.doesNotMatch(prompt, /<port_map>/);
    assert.doesNotMatch(prompt, /<adapter_bindings>/);
  });

  test("directs the LLM at R02-R18 (R01 is deterministic)", () => {
    const prompt = compileStage6Prompt({
      stage0: {
        intent: "x",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
      },
      stage5: { yaml: "", parsedObject: {} },
    } as any);
    assert.match(prompt, /R02–R18/);
    assert.doesNotMatch(prompt, /R01–R18/);
  });
});
