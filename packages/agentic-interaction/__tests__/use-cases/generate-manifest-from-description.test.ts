import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { GenerateManifestFromDescriptionUseCase } from "../../src/application/use-cases/generate-manifest-from-description.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import type { LLMResponse } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";
import type {
  Transaction,
  TransactionManagerPort,
  TransactionStatus,
} from "@hexagen/transaction-system";

function makeDescription(
  text: string = "Build me a blog platform with user accounts and post management",
) {
  return {
    text,
    language: "en",
    timestamp: new Date(),
    platform: "Node",
    deployment: "Cloud-native",
  };
}

// ── HEX-010: the use case REQUIRES a TransactionManagerPort ────────────────
// A4 rewired this use case onto ExecuteFullStagedGenerationUseCase, which
// needs a transaction manager (begin→transition), and papered over callers
// that omitted one by defaulting to `new InMemoryTransactionManager()` inside
// the constructor. That made an application-layer use case reach for a
// concrete infrastructure adapter, so a caller who forgot to wire a manager
// silently got a throwaway one instead of a compile error.
//
// HEX-010 inverts it: the port is a required constructor argument and every
// composition root (the two /api/manifest/generate routes, the benchmark
// script, these tests) supplies the implementation it wants. The suite below
// pins both halves — the injected instance is the one the pipeline drives, and
// nothing is fabricated when the argument is missing.
//
// The scripted happy-path port below mirrors execute-full-staged-generation.test.ts:
// sendRequest serves stages 0/1/2, streamStructuredRequest serves 3/4/6 (one
// coherent invoice domain so each stage's output feeds the next).
//
// The obsolete 4-pass orchestration suite that used to lead this file was
// deleted: the use case is now a thin wrapper over the 0→6 staged pipeline,
// whose behaviour is covered green by execute-full-staged-generation.test.ts.
const FULL_STAGE0 = [
  '{"type": "intent", "value": "build an invoice management system"}',
  '{"type": "technology", "value": "React"}',
  '{"type": "pattern", "value": "CQRS"}',
  '{"type": "ambiguity", "value": "Payment provider not specified"}',
].join("\n");
const FULL_STAGE1 = [
  '{"type":"verb","value":"createInvoice"}',
  '{"type":"noun","value":"Invoice"}',
  '{"type":"subdomain","value":"invoice-management"}',
  '{"type":"aggregateRoot","name":"Invoice","subdomain":"invoice-management"}',
].join("\n");
const FULL_STAGE2 = JSON.stringify({
  status: "accepted",
  name: "invoice-management",
  type: "core",
  responsibility: "Manage invoices",
  aggregateRoots: ["Invoice"],
  useCaseNames: ["CreateInvoice"],
  eventsPublished: ["InvoiceCreated"],
  reasoning: "Core business context",
});
const FULL_STAGE3 = [
  '{"contextName":"invoice-management","direction":"in","name":"createInvoice","portType":"command","description":"Creates invoice"}',
  '{"contextName":"invoice-management","direction":"out","name":"invoiceRepository","portType":"repository","description":"Persist invoices"}',
].join("\n");
const FULL_STAGE4 = JSON.stringify({
  contextName: "invoice-management",
  name: "InMemoryInvoiceAdapter",
  adapterType: "Repository",
  implements: "InvoiceRepositoryPort",
});
const FULL_STAGE6 = '{"type":"result","passed":true}\n';

function createFullPipelinePort(): SendStructuredRequestPort {
  const send = [FULL_STAGE0, FULL_STAGE1, FULL_STAGE2];
  const stream = [FULL_STAGE3, FULL_STAGE4, FULL_STAGE6];
  let si = 0;
  let ti = 0;
  return {
    sendRequest: async (): Promise<Result<LLMResponse>> => ({
      success: true,
      value: {
        id: "test-resp",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DomainModelId is a nominal enum; the scripted port mirrors execute-full-staged-generation.test.ts
        modelId: "gpt-4o-mini" as any,
        content: send[Math.min(si++, send.length - 1)],
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        timestamp: Date.now(),
      },
    }),
    streamStructuredRequest: () => {
      const content = stream[Math.min(ti++, stream.length - 1)];
      return (async function* () {
        yield { success: true, value: content };
      })();
    },
  } as unknown as SendStructuredRequestPort;
}

/**
 * Recording test double for `TransactionManagerPort`. It is deliberately NOT
 * `InMemoryTransactionManager`: the point of these tests is to prove the use
 * case drives *this* instance, which only holds if it never constructs its own.
 */
interface RecordingTransactionManager extends TransactionManagerPort {
  readonly beganWith: Array<{
    intentId: string;
    metadata?: Record<string, unknown>;
  }>;
  readonly transitionedWith: Array<{ id: string; status: TransactionStatus }>;
}

function createRecordingTransactionManager(): RecordingTransactionManager {
  const beganWith: RecordingTransactionManager["beganWith"] = [];
  const transitionedWith: RecordingTransactionManager["transitionedWith"] = [];
  const txns = new Map<string, Transaction>();
  let seq = 0;

  const setStatus = (id: string, status: TransactionStatus) => {
    const txn = txns.get(id);
    if (!txn) return null;
    const updated: Transaction = { ...txn, status, updatedAt: Date.now() };
    txns.set(id, updated);
    return updated;
  };

  return {
    beganWith,
    transitionedWith,
    begin: (intentId, metadata) => {
      beganWith.push({ intentId, metadata });
      // The id is unmistakably ours, so `transition` receiving it proves both
      // calls landed on the same injected instance.
      const txn: Transaction = {
        id: `recording-txn-${++seq}`,
        intentId,
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: metadata ?? {},
      };
      txns.set(txn.id, txn);
      return txn;
    },
    transition: (transactionId, status) => {
      transitionedWith.push({ id: transactionId, status });
      return setStatus(transactionId, status);
    },
    get: (transactionId) => txns.get(transactionId) ?? null,
    list: () => [...txns.values()],
    commit: (transactionId) => setStatus(transactionId, "committed"),
    rollback: (transactionId) => setStatus(transactionId, "rolled_back"),
  };
}

describe("GenerateManifestFromDescriptionUseCase — required TransactionManagerPort (HEX-010)", () => {
  it("drives the INJECTED transaction manager, not one of its own making", async () => {
    const transactionManager = createRecordingTransactionManager();
    const useCase = new GenerateManifestFromDescriptionUseCase(
      createFullPipelinePort(),
      transactionManager,
    );

    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(response.success, true);
    assert.ok(response.manifest, "manifest should be present");
    // Anti-stub: an implementation that accepts the port and quietly keeps
    // constructing `new InMemoryTransactionManager()` leaves these empty.
    assert.strictEqual(
      transactionManager.beganWith.length,
      1,
      "the injected manager must be the one that began the transaction",
    );
    assert.strictEqual(
      transactionManager.transitionedWith.length,
      1,
      "the injected manager must be the one that transitioned the transaction",
    );
    // Same instance for both calls — not a fake for `begin` and a fabricated
    // manager for the transition that follows it.
    assert.strictEqual(
      transactionManager.transitionedWith[0]?.id,
      "recording-txn-1",
    );
    assert.strictEqual(
      transactionManager.transitionedWith[0]?.status,
      "speculative",
    );
  });

  it("does not fabricate a transaction manager when the argument is missing", async () => {
    // The cast is the whole point: TypeScript now rejects the one-argument
    // form (pinned by the `@ts-expect-error` case below), so the only way to
    // reach this at runtime is to defeat the compiler. Pre-HEX-010 the
    // constructor's `?? new InMemoryTransactionManager()` swallowed the
    // omission and this run succeeded on a throwaway manager.
    const construct = GenerateManifestFromDescriptionUseCase as unknown as new (
      llmPipeline: SendStructuredRequestPort,
    ) => GenerateManifestFromDescriptionUseCase;
    const useCase = new construct(createFullPipelinePort());

    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(
      response.success,
      false,
      "no manager supplied ⇒ no manifest; the use case must not invent one",
    );
    assert.match(
      response.error ?? "",
      /begin/,
      "failure must come from the absent manager, not some unrelated stage",
    );
  });

  it("rejects construction without a transaction manager at compile time", () => {
    // Type-level half of the invariant, checked by `yarn workspace
    // @hexagen/agentic-interaction typecheck:test`. While the parameter was
    // optional this directive was unused and tsc failed with TS2578, which is
    // exactly the RED state this case is here to hold.
    const construct = () =>
      // @ts-expect-error -- HEX-010: transactionManager is a required argument
      new GenerateManifestFromDescriptionUseCase(createFullPipelinePort());

    assert.strictEqual(typeof construct, "function");
  });
});
