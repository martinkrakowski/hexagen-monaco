import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { GenerateManifestFromDescriptionUseCase } from "../../src/application/use-cases/generate-manifest-from-description.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import type { LLMResponse } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";

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

// ── A4 regression: omitting the transaction manager must not crash ──────────
// A4 rewired this use case onto ExecuteFullStagedGenerationUseCase, which
// REQUIRES a transaction manager (begin→transition) — unlike the old stub,
// which guarded an OPTIONAL one. Non-web callers (the benchmark script, tests)
// construct it with only an LLM port; the constructor must default to an
// in-memory manager rather than forward `undefined` into `.begin()`.
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

describe("GenerateManifestFromDescriptionUseCase — transaction manager default (A4)", () => {
  it("runs the full pipeline to a manifest WITHOUT an injected transaction manager", async () => {
    // Pre-fix this returned success:false — the `transactionManager!` forwarded
    // `undefined` into the full pipeline, which threw at `undefined.begin()`
    // (caught by execute()'s try/catch). The default manager makes it succeed.
    const useCase = new GenerateManifestFromDescriptionUseCase(
      createFullPipelinePort(),
    );
    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(response.success, true);
    assert.ok(response.manifest, "manifest should be present");
  });
});
