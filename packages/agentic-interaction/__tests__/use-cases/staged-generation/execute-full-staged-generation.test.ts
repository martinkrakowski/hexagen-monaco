import { test, describe } from "vitest";
import assert from "node:assert/strict";
import { ExecuteFullStagedGenerationUseCase } from "../../../src/application/use-cases/staged-generation/execute-full-staged-generation.use-case.ts";
import { compileStage0Prompt } from "../../../src/domain/prompts/generate-manifest.prompt.ts";
import type { ArchitectureContext } from "../../../src/domain/prompts/build-architecture-context";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { TransactionManagerPort } from "@hexagen/transaction-system";

// ── Scripted per-stage LLM responses ────────────────────────────────────────
// Formats lifted from the per-stage test files; one coherent invoice domain
// so stage N's output is plausible input for stage N+1.
// Port-method split (verified against each use-case's source):
//   sendRequest               → stages 0, 1, 2
//   streamStructuredRequest   → stages 3, 4, 6

const stage0Response = [
  '{"type": "intent", "value": "build an invoice management system"}',
  '{"type": "technology", "value": "React"}',
  '{"type": "pattern", "value": "CQRS"}',
  '{"type": "ambiguity", "value": "Payment provider not specified"}',
].join("\n");

const stage1Response = [
  '{"type":"verb","value":"createInvoice"}',
  '{"type":"noun","value":"Invoice"}',
  '{"type":"subdomain","value":"invoice-management"}',
  '{"type":"aggregateRoot","name":"Invoice","subdomain":"invoice-management"}',
].join("\n");

const stage2Response = JSON.stringify({
  status: "accepted",
  name: "invoice-management",
  type: "core",
  responsibility: "Manage invoices",
  aggregateRoots: ["Invoice"],
  useCaseNames: ["CreateInvoice"],
  eventsPublished: ["InvoiceCreated"],
  reasoning: "Core business context",
});

const stage3Response = [
  '{"contextName":"invoice-management","direction":"in","name":"createInvoice","portType":"command","description":"Creates invoice"}',
  '{"contextName":"invoice-management","direction":"out","name":"invoiceRepository","portType":"repository","description":"Persist invoices"}',
].join("\n");

// Both ports carry exactly one adapter: Stage 6 now recomputes R04/R05
// deterministically from stage3+stage4 (per-context discard+recompute), so a
// fixture leaving CreateInvoicePort uncovered would genuinely fail validation
// instead of riding on the scripted judge's passed:true.
const stage4Response = [
  JSON.stringify({
    contextName: "invoice-management",
    name: "InMemoryInvoiceAdapter",
    adapterType: "Repository",
    implements: "InvoiceRepositoryPort",
  }),
  JSON.stringify({
    contextName: "invoice-management",
    name: "CreateInvoiceController",
    adapterType: "Controller",
    implements: "CreateInvoicePort",
  }),
].join("\n");

const stage6Response = '{"type":"result","passed":true}\n';

interface CapturedRequest {
  method: "send" | "stream";
  messages: Array<{ role: string; content: string }>;
}

/**
 * Scripted mock port with two independent queues: sendRequest serves
 * stages 0/1/2 in order, streamStructuredRequest serves stages 3/4/6.
 * Every request (messages included) is captured for chaining assertions.
 */
function createScriptedPort(
  sendResponses: string[],
  streamResponses: string[],
) {
  const captured: CapturedRequest[] = [];
  let sendIdx = 0;
  let streamIdx = 0;
  const port = {
    sendRequest: async (request: {
      messages: Array<{ role: string; content: string }>;
    }) => {
      captured.push({ method: "send", messages: request.messages });
      const content =
        sendResponses[Math.min(sendIdx, sendResponses.length - 1)];
      sendIdx++;
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
    streamStructuredRequest: (request: {
      messages: Array<{ role: string; content: string }>;
    }) => {
      captured.push({ method: "stream", messages: request.messages });
      const content =
        streamResponses[Math.min(streamIdx, streamResponses.length - 1)];
      streamIdx++;
      return (async function* () {
        yield { success: true, value: content };
      })();
    },
  } as unknown as SendStructuredRequestPort;
  return { port, captured };
}

const happyPathSendResponses = [stage0Response, stage1Response, stage2Response];
const happyPathStreamResponses = [
  stage3Response,
  stage4Response,
  stage6Response,
];

function createMockTransactionManager(opts?: {
  failBegin?: boolean;
  failTransition?: boolean;
  nullTransition?: boolean;
}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const manager = {
    begin: (intentId: string, metadata?: Record<string, unknown>) => {
      calls.push({ method: "begin", args: [intentId, metadata] });
      if (opts?.failBegin) {
        throw new Error("begin failed");
      }
      return { id: "tx-1", intentId, status: "pending" };
    },
    transition: (transactionId: string, status: string) => {
      calls.push({ method: "transition", args: [transactionId, status] });
      if (opts?.failTransition) {
        throw new Error("transition failed");
      }
      if (opts?.nullTransition) {
        // Port contract: null = transition rejected (e.g. unknown tx)
        return null;
      }
      return { id: transactionId, status };
    },
    rollback: (transactionId: string) => {
      calls.push({ method: "rollback", args: [transactionId] });
      return { id: transactionId, status: "rolled-back" };
    },
  } as unknown as TransactionManagerPort;
  return { manager, calls };
}

describe("ExecuteFullStagedGenerationUseCase", () => {
  test("threads a configured stage6Reviewer (separate port + budget) into Stage 6", async () => {
    // Main port serves stages 0-5 only (3 send + 2 stream); Stage 6 must route
    // to the dedicated reviewer port, at the configured maxTokens.
    const { port: mainPort, captured } = createScriptedPort(
      happyPathSendResponses,
      [stage3Response, stage4Response],
    );
    let reviewerStage6Calls = 0;
    let reviewerMaxTokens: number | undefined;
    const reviewerPort = {
      sendRequest: async () => ({ success: true as const, value: {} }),
      streamStructuredRequest: (request: { maxTokens?: number }) => {
        reviewerStage6Calls++;
        reviewerMaxTokens = request.maxTokens;
        return (async function* () {
          yield { success: true, value: stage6Response };
        })();
      },
    } as unknown as SendStructuredRequestPort;
    const { manager } = createMockTransactionManager();

    const useCase = new ExecuteFullStagedGenerationUseCase(mainPort, manager, {
      stage6Reviewer: { port: reviewerPort, maxTokens: 4000 },
    });
    const result = await useCase.execute("Build an invoice management system");

    assert.equal(result.success, true);
    // Stage 6 hit the dedicated reviewer exactly once, at the configured budget…
    assert.equal(reviewerStage6Calls, 1);
    assert.equal(reviewerMaxTokens, 4000);
    // …and the main port served only stages 3/4 (Stage 6 no longer reaches it).
    assert.equal(captured.filter((c) => c.method === "stream").length, 2);
  });

  test("happy path: chains stages 0→6 and returns manifest + state + transactionId", async () => {
    const { port, captured } = createScriptedPort(
      happyPathSendResponses,
      happyPathStreamResponses,
    );
    const { manager, calls } = createMockTransactionManager();
    const useCase = new ExecuteFullStagedGenerationUseCase(port, manager);

    const result = await useCase.execute("Build an invoice management system");

    assert.equal(result.success, true);
    if (result.success) {
      // Stage outputs landed in state at every boundary
      assert.equal(
        result.state.stage0?.intent,
        "build an invoice management system",
      );
      assert.deepEqual(result.state.stage1?.nouns, ["Invoice"]);
      assert.equal(
        result.state.stage2?.accepted[0]?.name,
        "invoice-management",
      );
      assert.equal(result.state.stage3?.contexts.length, 1);
      assert.equal(
        result.state.stage4?.contexts[0]?.adapters[0]?.name,
        "InMemoryInvoiceAdapter",
      );
      assert.ok(result.state.stage5?.yaml.includes("invoice-management"));
      assert.equal(result.state.stage6?.passed, true);
      assert.equal(result.value, result.state.stage5);
      assert.equal(result.transactionId, "tx-1");
    }

    // Exactly 3 sendRequest (stages 0/1/2) + 3 streamStructuredRequest (3/4/6)
    assert.equal(captured.filter((c) => c.method === "send").length, 3);
    assert.equal(captured.filter((c) => c.method === "stream").length, 3);

    // Transaction protocol: begin → speculative, no rollback
    assert.deepEqual(
      calls.map((c) => c.method),
      ["begin", "transition"],
    );
    assert.equal(calls[1].args[1], "speculative");
    const beginMetadata = calls[0].args[1] as Record<string, unknown>;
    assert.equal(beginMetadata.origin, "full-staged-generation");
    assert.ok(typeof beginMetadata.yaml === "string");
    // Counts must read the manifest's nested layout
    // (layers.application.ports / layers.infrastructure.adapters):
    // 1 context, 2 ports (createInvoice + invoiceRepository), 2 adapters
    // (one per port — see the stage4Response comment).
    assert.equal(beginMetadata.contextCount, 1);
    assert.equal(beginMetadata.portCount, 2);
    assert.equal(beginMetadata.adapterCount, 2);
  });

  test("chaining: each stage's prompt embeds upstream output", async () => {
    const { port, captured } = createScriptedPort(
      happyPathSendResponses,
      happyPathStreamResponses,
    );
    const { manager } = createMockTransactionManager();
    const useCase = new ExecuteFullStagedGenerationUseCase(port, manager);

    const result = await useCase.execute("Build an invoice management system");
    assert.equal(result.success, true);

    const userContent = (req: CapturedRequest) =>
      req.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n");

    // Stage 1 prompt carries the stage-0 normalized intent
    assert.ok(
      userContent(captured[1]).includes("build an invoice management system"),
    );
    // Stage 2 prompt carries stage-1 domain output
    assert.ok(userContent(captured[2]).includes("Invoice"));
    // Stage 3 prompt carries the stage-2 accepted context
    assert.ok(userContent(captured[3]).includes("invoice-management"));
    // Stage 4 prompt carries the stage-3 port map
    assert.ok(userContent(captured[4]).includes("createInvoice"));
    // Stage 6 prompt carries the stage-4 adapter via the stage-5 manifest
    assert.ok(userContent(captured[5]).includes("InMemoryInvoiceAdapter"));
  });

  test("loading seam (T2b): stage-0 prompt contains a non-empty <architecture> block by default", async () => {
    const { port, captured } = createScriptedPort(
      happyPathSendResponses,
      happyPathStreamResponses,
    );
    const { manager } = createMockTransactionManager();
    // Default construction — no architectureContext override. This proves the
    // greenfield contract is loaded and threaded through all 3 levels
    // (orchestrator ctor → stage-0 ctor → compileStage0Prompt), not just that
    // a fixture string round-trips.
    const useCase = new ExecuteFullStagedGenerationUseCase(port, manager);

    await useCase.execute("Build an invoice management system");

    const stage0Prompt = captured[0].messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    const match = stage0Prompt.match(
      /<architecture>\n([\s\S]+?)\n<\/architecture>/,
    );
    assert.ok(match, "stage-0 prompt must contain an <architecture> block");
    assert.ok(match![1].trim().length > 0, "<architecture> must be non-empty");
    // Spot-check both composed sources: PLANE_NAMES + architecture-contract bans
    assert.ok(match![1].includes("shared-kernel"));
    assert.ok(match![1].includes("repository"));
    // The block precedes the (escaped, untrusted) user input
    assert.ok(
      stage0Prompt.indexOf("<architecture>") <
        stage0Prompt.indexOf("<user_input>"),
    );
  });

  test("explicit architectureContext override replaces the greenfield default", async () => {
    const { port, captured } = createScriptedPort(
      happyPathSendResponses,
      happyPathStreamResponses,
    );
    const { manager } = createMockTransactionManager();
    const useCase = new ExecuteFullStagedGenerationUseCase(port, manager, {
      // A custom (brownfield) context must be vouched for with an explicit
      // cast — the sanctioned escape hatch from the ArchitectureContext brand.
      architectureContext: "custom brownfield contract" as ArchitectureContext,
    });

    await useCase.execute("Build an invoice management system");

    const stage0Prompt = captured[0].messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    assert.ok(
      stage0Prompt.includes(
        "<architecture>\ncustom brownfield contract\n</architecture>",
      ),
    );
    assert.ok(!stage0Prompt.includes("shared-kernel"));
  });

  test("compileStage0Prompt without architectureContext is byte-identical to the pre-T2b shape", () => {
    const variables = { userDescription: "Build a thing" };
    assert.equal(
      compileStage0Prompt(variables),
      compileStage0Prompt(variables, undefined),
    );
    assert.ok(!compileStage0Prompt(variables).includes("<architecture>"));
  });

  test("callback protocol: onProgress start ping + completion for every stage, in order", async () => {
    const { port } = createScriptedPort(
      happyPathSendResponses,
      happyPathStreamResponses,
    );
    const { manager } = createMockTransactionManager();
    const useCase = new ExecuteFullStagedGenerationUseCase(port, manager);

    const progress: Array<[number, number]> = [];
    const result = await useCase.execute(
      "Build an invoice management system",
      undefined,
      { onProgress: (stage, durationMs) => progress.push([stage, durationMs]) },
    );
    assert.equal(result.success, true);

    // Every stage 0..6 pings (N, 0) at start and reports (N, duration) on completion
    const stagesSeen = progress.map(([stage]) => stage);
    assert.deepEqual(stagesSeen, [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    for (let stage = 0; stage <= 6; stage++) {
      const pings = progress.filter(([s]) => s === stage);
      assert.equal(pings[0][1], 0, `stage ${stage} must ping (stage, 0) first`);
    }
  });

  test("failure propagation: a failing stage reports onError, halts the chain, and opens no transaction", async () => {
    // Stage 0 succeeds; stage 1 then receives garbage for every retry attempt
    // and exhausts MAX_RETRY_ATTEMPTS.
    const { port, captured } = createScriptedPort(
      [stage0Response, "not ndjson", "not ndjson", "not ndjson"],
      happyPathStreamResponses,
    );
    const { manager, calls } = createMockTransactionManager();
    const useCase = new ExecuteFullStagedGenerationUseCase(port, manager);

    const errors: Array<[number, string]> = [];
    const result = await useCase.execute(
      "Build an invoice management system",
      undefined,
      { onError: (stage, error) => errors.push([stage, error]) },
    );

    assert.equal(result.success, false);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], 1);
    // Stages 3/4/6 never ran; no transaction was opened
    assert.equal(captured.filter((c) => c.method === "stream").length, 0);
    assert.equal(calls.length, 0);
  });

  test("zero accepted contexts fails at stage 2 — no LLM burn in stages 3/4/6, no transaction", async () => {
    // Stage 2 SUCCEEDS but rejects its only candidate → accepted is empty.
    // Without the guard, stage 4 would burn a real LLM call on a degenerate
    // prompt and the run would end as an empty speculative transaction.
    const stage2Rejected = JSON.stringify({
      status: "rejected",
      name: "invoice-management",
      reasoning: "Not a bounded context",
    });
    const { port, captured } = createScriptedPort(
      [stage0Response, stage1Response, stage2Rejected],
      happyPathStreamResponses,
    );
    const { manager, calls } = createMockTransactionManager();
    const useCase = new ExecuteFullStagedGenerationUseCase(port, manager);

    const errors: Array<[number, string]> = [];
    const result = await useCase.execute(
      "Build an invoice management system",
      undefined,
      { onError: (stage, error) => errors.push([stage, error]) },
    );

    assert.equal(result.success, false);
    assert.deepEqual(errors, [[2, "Stage 2 accepted no bounded contexts"]]);
    // Stages 3/4/6 never ran; no transaction was opened
    assert.equal(captured.filter((c) => c.method === "stream").length, 0);
    assert.equal(calls.length, 0);
  });

  test("transaction begin failure fails the run without rollback or transition", async () => {
    const { port } = createScriptedPort(
      happyPathSendResponses,
      happyPathStreamResponses,
    );
    const { manager, calls } = createMockTransactionManager({
      failBegin: true,
    });
    const useCase = new ExecuteFullStagedGenerationUseCase(port, manager);

    const result = await useCase.execute("Build an invoice management system");

    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(String(result.error).includes("begin failed"));
    }
    // No transaction exists, so nothing to roll back or transition
    assert.deepEqual(
      calls.map((c) => c.method),
      ["begin"],
    );
  });

  test("transaction transition failure rolls back and fails the run", async () => {
    const { port } = createScriptedPort(
      happyPathSendResponses,
      happyPathStreamResponses,
    );
    const { manager, calls } = createMockTransactionManager({
      failTransition: true,
    });
    const useCase = new ExecuteFullStagedGenerationUseCase(port, manager);

    const result = await useCase.execute("Build an invoice management system");

    assert.equal(result.success, false);
    assert.deepEqual(
      calls.map((c) => c.method),
      ["begin", "transition", "rollback"],
    );
  });

  test("transition returning null (port contract failure signal) rolls back and fails the run", async () => {
    const { port } = createScriptedPort(
      happyPathSendResponses,
      happyPathStreamResponses,
    );
    const { manager, calls } = createMockTransactionManager({
      nullTransition: true,
    });
    const useCase = new ExecuteFullStagedGenerationUseCase(port, manager);

    const result = await useCase.execute("Build an invoice management system");

    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(
        String(result.error).includes("speculative"),
        "error must explain the failed transition",
      );
    }
    assert.deepEqual(
      calls.map((c) => c.method),
      ["begin", "transition", "rollback"],
    );
  });
});
