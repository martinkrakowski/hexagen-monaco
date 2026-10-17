/**
 * Lane J2 — U-A context-type advice beside the classifier (shadow first).
 *
 * Covers: mode "off" never calls advice; "shadow" calls advice exactly once,
 * leaves the LLM types in place and records the receipt; "primary" applies
 * only answers with confidence >= minConfidence; unknown/throwing advice and
 * throwing sinks never change today's result; unflagged contexts are never
 * sent; the advice runs concurrently with the classifier loop; and the
 * generationId lands on both the Stage-2 telemetry and the receipt.
 *
 * Answer shapes come from the recorded fixture
 * `fixtures/jev/jev-context-type-response.json` (c0 → core/1.0, c1 →
 * supporting/0.45).
 */
import { test, describe } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ExecuteStructuredConfigGenerationUseCase } from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import type { ClassifyContextTypeUseCase } from "../../../src/application/use-cases/staged-generation/classify-context-type.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
import type { DecisionAdvicePort } from "../../../src/application/ports/out/decision-advice.port";
import type {
  ContextTypeReceipt,
  DecisionAdviceRequest,
  DecisionAdviceResult,
} from "../../../src/domain/decision-advice";

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("./fixtures/jev/jev-context-type-response.json", import.meta.url),
    ),
    "utf8",
  ),
) as {
  answers: Record<string, { choice: string; confidence: number }>;
};

// Two contexts the heuristic cannot decide (no declared type, no keyword
// hit → core/0.4 → needsTypeReview), one declared-type context that is
// never flagged.
const CONFIG = JSON.stringify({
  project: "test-project",
  bounded_contexts: [
    { name: "Catalog", responsibility: "Manages the item catalogue" },
    { name: "Warehouse", responsibility: "Tracks warehouse stock" },
    { name: "Billing", type: "core", responsibility: "Invoicing" },
  ],
  use_cases: {
    Catalog: [{ name: "List Items" }],
    Warehouse: [{ name: "Adjust Stock" }],
    Billing: [{ name: "Issue Invoice" }],
  },
  context_mappings: [],
});

function createMockLLMPort(): SendStructuredRequestPort {
  let callCount = 0;
  return {
    sendRequest: async () => {
      callCount++;
      let content = "";
      if (callCount <= 2) {
        content = [
          JSON.stringify({
            contextName: "Catalog",
            direction: "in",
            name: "ListItemsPort",
            portType: "command",
            description: "List items",
          }),
          JSON.stringify({
            contextName: "Catalog",
            direction: "out",
            name: "CatalogRepository",
            portType: "repository",
            description: "Persist items",
          }),
        ].join("\n");
      } else if (callCount <= 4) {
        content = JSON.stringify({
          contextName: "Catalog",
          adapterName: "InMemoryCatalogRepoAdapter",
          adapterType: "Repository",
          implements: "CatalogRepository",
        });
      } else {
        content = JSON.stringify({ type: "result", passed: true });
      }
      return {
        success: true as const,
        value: {
          id: `test-${callCount}`,
          modelId: "gpt-4o-mini" as never,
          content,
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      };
    },
    streamStructuredRequest: async function* () {
      yield {
        success: true as const,
        value:
          JSON.stringify({
            contextName: "Catalog",
            direction: "in",
            name: "ListItemsPort",
            portType: "command",
            description: "List items",
          }) + "\n",
      };
      yield {
        success: true as const,
        value:
          JSON.stringify({
            contextName: "Catalog",
            direction: "out",
            name: "CatalogRepository",
            portType: "repository",
            description: "Persist items",
          }) + "\n",
      };
      yield {
        success: true as const,
        value: JSON.stringify({ type: "result", passed: true }) + "\n",
      };
    },
  } as unknown as SendStructuredRequestPort;
}

function createMockTransactionManager(): TransactionManagerPort {
  return {
    begin: (intentId: string) => ({
      id: `txn-${intentId}`,
      intentId,
      status: "pending",
    }),
    transition: (txId: string, status: string) => ({ id: txId, status }),
    get: () => null,
    list: () => [],
    commit: () => null,
    rollback: () => null,
    fail: () => null,
    compareAndSetStatus: () => null,
  } as unknown as TransactionManagerPort;
}

/** Fake classifier: "generic" for Catalog, "supporting" for Warehouse. */
function createFakeClassifier(
  onCall?: (contextName: string) => void,
): ClassifyContextTypeUseCase {
  return {
    execute: async (context: {
      name: string;
      responsibility?: string;
      aggregates?: string[];
      value_objects?: string[];
    }) => {
      onCall?.(context.name);
      if (context.name === "Catalog") {
        return { success: true, type: "generic", reasoning: "catalog" };
      }
      if (context.name === "Warehouse") {
        return { success: true, type: "supporting", reasoning: "stock" };
      }
      return { success: false, error: new Error("unexpected context") };
    },
  } as unknown as ClassifyContextTypeUseCase;
}

/** Fake advice: mirrors the recorded fixture's answer shapes. */
function createFakeAdvice(
  result: DecisionAdviceResult,
  hooks?: {
    onRequest?: (request: DecisionAdviceRequest) => void;
    resolveAfterClassifier?: () => void;
  },
): { port: DecisionAdvicePort; calls: DecisionAdviceRequest[] } {
  const calls: DecisionAdviceRequest[] = [];
  return {
    calls,
    port: {
      ask: async (request) => {
        calls.push(request);
        hooks?.onRequest?.(request);
        hooks?.resolveAfterClassifier?.();
        return result;
      },
    },
  };
}

function advisedFromFixture(): DecisionAdviceResult {
  return {
    status: "advised",
    answers: Object.fromEntries(
      Object.entries(FIXTURE.answers).map(([key, answer]) => [
        key,
        {
          type: "choice" as const,
          choice: answer.choice,
          probabilities: {},
          confidence: answer.confidence,
        },
      ]),
    ),
    receipt: {
      use: "context-type",
      model: "typesafe/jev-1.14-20261014",
      requestId: "gen-dec-1792209057-YWSD4tAfztlHGa3TroHD",
      generationId: "",
      status: "advised",
      costMicroUsd: 27,
      latencyMs: 1200,
    },
  };
}

const FIXED_GENERATION_ID = "gen-fixed-0001";

function createUseCase(options: {
  decisionAdvice?: DecisionAdvicePort;
  contextTypeMode?: "off" | "shadow" | "primary";
  minConfidence?: number;
  receiptSink?: (receipt: ContextTypeReceipt) => void;
  classifier?: ClassifyContextTypeUseCase;
}) {
  return new ExecuteStructuredConfigGenerationUseCase(
    createMockLLMPort(),
    createMockTransactionManager(),
    options.classifier ?? createFakeClassifier(),
    undefined,
    undefined,
    undefined,
    {
      decisionAdvice: options.decisionAdvice,
      contextTypeMode: options.contextTypeMode,
      minConfidence: options.minConfidence,
      receiptSink: options.receiptSink,
      newGenerationId: () => FIXED_GENERATION_ID,
    },
  );
}

function finalTypes(result: {
  success: boolean;
  value?: {
    parsedObject?: {
      bounded_contexts?: Array<{ name: string; type?: string }>;
    };
  };
}): Record<string, string | undefined> {
  assert.equal(result.success, true);
  const contexts = result.value?.parsedObject?.bounded_contexts ?? [];
  return Object.fromEntries(contexts.map((c) => [c.name, c.type]));
}

describe("context-type advice (U-A, lane J2)", () => {
  test('"off" (default) never calls advice', async () => {
    const { port, calls } = createFakeAdvice(advisedFromFixture());
    const receipts: ContextTypeReceipt[] = [];
    const useCase = createUseCase({
      decisionAdvice: port,
      contextTypeMode: "off",
      receiptSink: (r) => receipts.push(r),
    });
    const result = await useCase.execute(CONFIG);
    assert.equal(result.success, true);
    assert.equal(calls.length, 0);
    assert.equal(receipts.length, 0);
  });

  test('"shadow" calls advice exactly once, leaves LLM types, records the receipt', async () => {
    const { port, calls } = createFakeAdvice(advisedFromFixture());
    const receipts: ContextTypeReceipt[] = [];
    const useCase = createUseCase({
      decisionAdvice: port,
      contextTypeMode: "shadow",
      receiptSink: (r) => receipts.push(r),
    });
    const result = await useCase.execute(CONFIG);
    assert.equal(result.success, true);

    // Exactly one advice call per generation, and only the two flagged
    // contexts were sent (the declared-type Billing was not).
    assert.equal(calls.length, 1);
    const request = calls[0]!;
    assert.equal(request.use, "context-type");
    assert.deepEqual(Object.keys(request.questions), ["c0", "c1"]);
    assert.equal(request.fields[0]!.name, "project");
    assert.equal(request.fields[0]!.value, "test-project");
    assert.deepEqual(
      request.fields.slice(1).map((f) => f.name),
      ["c0", "c1"],
    );
    assert.match(request.fields[1]!.value, /^Catalog; /);
    assert.match(request.fields[1]!.value, /aggregates: /);
    assert.match(request.fields[2]!.value, /value objects: /);
    assert.equal(request.questions.c0!.type, "choice");
    assert.deepEqual(Object.keys(request.questions.c0!.criteria).sort(), [
      "core",
      "driver",
      "generic",
      "shared-kernel",
      "supporting",
    ]);

    // Shadow changes nothing: Catalog is "generic" and Warehouse is
    // "supporting" — exactly what the classifier set.
    const types = finalTypes(result);
    assert.equal(types.catalog, "generic");
    assert.equal(types.warehouse, "supporting");

    // One receipt, one answer per reviewed context, with the fixture's
    // answer shapes.
    assert.equal(receipts.length, 1);
    const receipt = receipts[0]!;
    assert.equal(receipt.mode, "shadow");
    assert.equal(
      receipt.receipt.requestId,
      "gen-dec-1792209057-YWSD4tAfztlHGa3TroHD",
    );
    assert.equal(receipt.answers.length, 2);
    const [c0, c1] = receipt.answers;
    assert.equal(c0!.questionIndex, 0);
    assert.equal(c0!.jevAnswer, "core");
    assert.equal(c0!.jevConfidence, 1);
    assert.equal(c0!.todayAnswer, "generic");
    assert.equal(c0!.todaySource, "llm");
    assert.equal(c0!.agreement, false);
    assert.equal(c1!.questionIndex, 1);
    assert.equal(c1!.jevAnswer, "supporting");
    assert.equal(c1!.jevConfidence, 0.45);
    assert.equal(c1!.todayAnswer, "supporting");
    assert.equal(c1!.todaySource, "llm");
    assert.equal(c1!.agreement, true);
  });

  test('"primary" applies only answers with confidence >= minConfidence', async () => {
    const { port } = createFakeAdvice(advisedFromFixture());
    const useCase = createUseCase({
      decisionAdvice: port,
      contextTypeMode: "primary",
      minConfidence: 0.8,
    });
    const result = await useCase.execute(CONFIG);
    const types = finalTypes(result);
    // c0: Jev "core" at confidence 1.0 ≥ 0.8 → applied.
    assert.equal(types.catalog, "core");
    // c1: Jev "supporting" at confidence 0.45 < 0.8 → today's LLM type stays.
    assert.equal(types.warehouse, "supporting");
    // Contexts that did not need review are never touched.
    assert.equal(types.billing, "core");
  });

  test("advice unknown or throwing leaves today's types", async () => {
    const unknown = createFakeAdvice({ status: "unknown", reason: "budget" });
    const useCaseUnknown = createUseCase({
      decisionAdvice: unknown.port,
      contextTypeMode: "primary",
      receiptSink: () => {
        throw new Error("no receipt expected");
      },
    });
    // With no sink injected the throw above cannot fire; the unknown result
    // must leave the LLM types in place.
    const resultUnknown = await useCaseUnknown.execute(CONFIG);
    const typesUnknown = finalTypes(resultUnknown);
    assert.equal(typesUnknown.catalog, "generic");
    assert.equal(typesUnknown.warehouse, "supporting");

    const throwing: DecisionAdvicePort = {
      ask: () => Promise.reject(new Error("network down")),
    };
    const useCaseThrowing = createUseCase({
      decisionAdvice: throwing,
      contextTypeMode: "primary",
    });
    const resultThrowing = await useCaseThrowing.execute(CONFIG);
    const typesThrowing = finalTypes(resultThrowing);
    assert.equal(typesThrowing.catalog, "generic");
    assert.equal(typesThrowing.warehouse, "supporting");
  });

  test("a sink that throws is ignored", async () => {
    const { port } = createFakeAdvice(advisedFromFixture());
    const useCase = createUseCase({
      decisionAdvice: port,
      contextTypeMode: "shadow",
      receiptSink: () => {
        throw new Error("sink exploded");
      },
    });
    const result = await useCase.execute(CONFIG);
    assert.equal(result.success, true);
    const types = finalTypes(result);
    assert.equal(types.catalog, "generic");
    assert.equal(types.warehouse, "supporting");
  });

  test("contexts without needsTypeReview are never sent", async () => {
    const { port, calls } = createFakeAdvice(advisedFromFixture());
    const useCase = createUseCase({
      decisionAdvice: port,
      contextTypeMode: "shadow",
    });
    await useCase.execute(CONFIG);
    assert.equal(calls.length, 1);
    const values = calls[0]!.fields.map((f) => f.value).join("\n");
    assert.ok(!values.includes("Billing"));
  });

  test("advice runs concurrently with the classifier loop", async () => {
    const events: string[] = [];
    let resolveAdvice: (() => void) | undefined;
    const advicePromise = new Promise<DecisionAdviceResult>((resolve) => {
      resolveAdvice = () => resolve(advisedFromFixture());
    });
    const port: DecisionAdvicePort = {
      ask: async () => {
        events.push("advice:start");
        return advicePromise;
      },
    };
    const classifier = createFakeClassifier((name) => {
      events.push(`classifier:${name}`);
      // The advice resolves only after the classifier has been called —
      // if the loop waited for advice first, the generation would deadlock
      // (or, with a timeout, order advice:end before classifier:*).
      queueMicrotask(() => resolveAdvice?.());
    });
    const useCase = createUseCase({
      decisionAdvice: port,
      contextTypeMode: "shadow",
      classifier,
    });
    const result = await useCase.execute(CONFIG);
    assert.equal(result.success, true);
    // The advice was dispatched before the loop and only settled after the
    // classifier ran — the loop did not wait for it.
    const adviceStart = events.indexOf("advice:start");
    const classifierDone = events.findIndex((e) => e.startsWith("classifier:"));
    assert.ok(adviceStart !== -1);
    assert.ok(classifierDone !== -1);
    assert.ok(adviceStart < classifierDone);
    // And the advice answers still landed: types were applied after the loop.
    const types = finalTypes(result);
    assert.equal(types.catalog, "generic");
  });

  test("generationId appears on the Stage 2 telemetry and the receipt", async () => {
    const { port } = createFakeAdvice(advisedFromFixture());
    const receipts: ContextTypeReceipt[] = [];
    const telemetry: Array<{ stage: number; generationId?: string }> = [];
    const useCase = createUseCase({
      decisionAdvice: port,
      contextTypeMode: "shadow",
      receiptSink: (r) => receipts.push(r),
    });
    const result = await useCase.execute(CONFIG, {
      onStageTelemetry: (t) => telemetry.push(t),
    });
    assert.equal(result.success, true);
    const stage2 = telemetry.filter((t) => t.stage === 2);
    assert.equal(stage2.length, 1);
    assert.equal(stage2[0]!.generationId, FIXED_GENERATION_ID);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]!.generationId, FIXED_GENERATION_ID);
  });

  test("a port that rejects while the classifier is still awaiting is no advice, never an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const rejecting: DecisionAdvicePort = {
        ask: () => Promise.reject(new Error("advice down")),
      };
      const slow = createFakeClassifier();
      const slowClassifier = {
        execute: async (...args: Parameters<typeof slow.execute>) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return slow.execute(...args);
        },
      } as unknown as ClassifyContextTypeUseCase;
      const useCase = createUseCase({
        decisionAdvice: rejecting,
        contextTypeMode: "shadow",
        classifier: slowClassifier,
      });
      const result = await useCase.execute(CONFIG);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(result.success, true);
      assert.deepStrictEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
