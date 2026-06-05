import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExecuteStagedGenerationUseCase } from "../../src/application/use-cases/staged-generation/execute-staged-generation.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import type { LLMRequest } from "@hexagen/local-llm";
import type { LLMResponse } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";

// Mirror the use case's own phase-detection so the mock can answer per phase.
function detectPhase(sys: string): string {
  if (sys.includes("overall project workspace")) return "workspace";
  if (sys.includes("JSON array of objects") && sys.includes("bounded context"))
    return "context-list";
  if (sys.includes('"in"') && sys.includes('"out"')) return "ports";
  if (sys.includes("infrastructure adapters")) return "adapters";
  return "unknown";
}

const WORKSPACE = JSON.stringify({ name: "shop", description: "A shop" });
const GOOD_CONTEXTS = JSON.stringify([
  { name: "orders", type: "core", description: "Order lifecycle" },
  { name: "payments", type: "supporting", description: "Payments" },
]);
const PORTS = JSON.stringify({
  in: [{ name: "PlaceOrderPort", type: "command", description: "place" }],
  out: [
    { name: "OrderRepositoryPort", type: "repository", description: "repo" },
  ],
});
const ADAPTERS = JSON.stringify([
  { name: "PgOrders", type: "repository", implements: "OrderRepositoryPort" },
]);

/**
 * Mock LLM that returns canned content per phase. `context`/`ports` accept an
 * array of per-attempt responses (index = attempt number, last value repeats).
 */
function makeLLM(opts: {
  context?: string[];
  ports?: string[];
}): SendStructuredRequestPort {
  const counts: Record<string, number> = {};
  return {
    sendRequest: async (req: LLMRequest): Promise<Result<LLMResponse>> => {
      const sys = req.messages.find((m) => m.role === "system")?.content ?? "";
      const phase = detectPhase(sys);
      const n = counts[phase] ?? 0;
      counts[phase] = n + 1;
      const pick = (arr: string[] | undefined, dflt: string) =>
        arr ? arr[Math.min(n, arr.length - 1)] : dflt;
      let content = "";
      if (phase === "workspace") content = WORKSPACE;
      else if (phase === "context-list")
        content = pick(opts.context, GOOD_CONTEXTS);
      else if (phase === "ports") content = pick(opts.ports, PORTS);
      else if (phase === "adapters") content = ADAPTERS;
      return {
        success: true,
        value: {
          id: "r",
          modelId: "qwen-coder-3b" as LLMResponse["modelId"],
          content,
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          timestamp: Date.now(),
        },
      };
    },
  } as unknown as SendStructuredRequestPort;
}

function run(
  llm: SendStructuredRequestPort,
  callbacks?: Parameters<ExecuteStagedGenerationUseCase["execute"]>[2],
) {
  return new ExecuteStagedGenerationUseCase(llm).execute(
    "Build a shop",
    { userDescription: "Build a shop" },
    callbacks,
  );
}

describe("ExecuteStagedGenerationUseCase — LLM-shape resilience", () => {
  it("succeeds on a bare context array (happy path)", async () => {
    const res = await run(makeLLM({}));
    assert.equal(res.success, true);
    if (res.success) {
      assert.deepEqual(
        res.state.stage2?.accepted.map((c) => c.name),
        ["orders", "payments"],
      );
    }
  });

  it("unwraps a { contexts: [...] } wrapper", async () => {
    const wrapped = JSON.stringify({ contexts: JSON.parse(GOOD_CONTEXTS) });
    const res = await run(makeLLM({ context: [wrapped] }));
    assert.equal(res.success, true);
    if (res.success) {
      assert.deepEqual(
        res.state.stage2?.accepted.map((c) => c.name),
        ["orders", "payments"],
      );
    }
  });

  // The blocking bug: a single context object carrying a nested array must not
  // have that nested array mistaken for the context list.
  it("treats a single context object with a nested array as one context, not the nested array", async () => {
    const single = JSON.stringify({
      name: "order-management",
      type: "core",
      description: "Handles orders",
      ports: [{ name: "PlaceOrderPort" }],
    });
    const res = await run(makeLLM({ context: [single] }));
    assert.equal(res.success, true);
    if (res.success) {
      assert.deepEqual(
        res.state.stage2?.accepted.map((c) => c.name),
        ["order-management"],
      );
    }
  });

  it("wraps a single bare context object into a one-element list", async () => {
    const single = JSON.stringify({
      name: "orders",
      type: "core",
      description: "x",
    });
    const res = await run(makeLLM({ context: [single] }));
    assert.equal(res.success, true);
    if (res.success) {
      assert.deepEqual(
        res.state.stage2?.accepted.map((c) => c.name),
        ["orders"],
      );
    }
  });

  it("retries and recovers when the first context response is a non-context array", async () => {
    const res = await run(
      makeLLM({
        context: [JSON.stringify(["orders", "payments"]), GOOD_CONTEXTS],
      }),
    );
    assert.equal(res.success, true);
    if (res.success) assert.equal(res.state.stage2?.accepted.length, 2);
  });

  it("does NOT accept a workspace-shaped object (name + description, no type) as a context", async () => {
    const workspaceShaped = JSON.stringify({
      name: "shop",
      description: "a shop",
    });
    const res = await run(
      makeLLM({ context: [workspaceShaped, workspaceShaped] }),
    );
    assert.equal(res.success, false);
    if (!res.success)
      assert.match(String(res.error), /context-list phase failed/);
  });

  it("unwraps a { data: { in, out } } ports wrapper instead of dropping ports", async () => {
    const wrapped = JSON.stringify({ data: JSON.parse(PORTS) });
    const res = await run(makeLLM({ ports: [wrapped] }));
    assert.equal(res.success, true);
    if (res.success) {
      const portCount =
        res.state.stage3?.contexts.reduce(
          (s, c) => s + c.in.length + c.out.length,
          0,
        ) ?? 0;
      assert.ok(
        portCount > 0,
        "ports should be recovered from the data wrapper",
      );
    }
  });

  it("emits exactly one stage-complete for the context phase across a coerce-empty retry", async () => {
    const completes: number[] = [];
    // Attempt 1 parses ([] is valid JSON) but coerces to empty → retry; attempt 2 good.
    const res = await run(
      makeLLM({ context: [JSON.stringify([]), GOOD_CONTEXTS] }),
      {
        onStageComplete: (stage: number) => completes.push(stage),
      },
    );
    assert.equal(res.success, true);
    assert.equal(
      completes.filter((s) => s === 1).length,
      1,
      "stage 1 should complete exactly once",
    );
  });
});
