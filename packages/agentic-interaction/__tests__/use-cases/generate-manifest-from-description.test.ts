import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  GenerateManifestFromDescriptionUseCase,
  ManifestWarningCategory,
} from "../../src/application/use-cases/generate-manifest-from-description.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import type { LLMRequest } from "@hexagen/local-llm";
import type { LLMResponse } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";

const WORKSPACE_JSON = JSON.stringify({
  name: "blog-platform",
  description: "A modern blog platform",
});
const CONTEXT_LIST_JSON = JSON.stringify([
  {
    name: "content-management",
    type: "core",
    description: "Manages blog posts and content",
  },
  {
    name: "user-accounts",
    type: "supporting",
    description: "Handles user authentication",
  },
]);
const PORTS_JSON = JSON.stringify({
  in: [
    {
      name: "CreatePostPort",
      type: "UseCase",
      description: "Creates a new post",
    },
  ],
  out: [
    {
      name: "PostRepositoryPort",
      type: "Repository",
      description: "Persists posts",
    },
  ],
});
const ADAPTERS_JSON = JSON.stringify([
  {
    name: "PostgresPostAdapter",
    type: "Repository",
    implements: "PostRepositoryPort",
  },
]);

const CORRUPTED_PORTS_JSON =
  '{"in": [{"name": "CreatePost", "type": "UseCase", "description": "Creates"}], "out": [{"name": "PostRepo", "type": "Repository", "description": \x07"Persists"}]}';

function detectPhase(systemPrompt: string): string {
  if (systemPrompt.includes("overall project workspace")) return "workspace";
  if (
    systemPrompt.includes("JSON array of objects") &&
    systemPrompt.includes("bounded context")
  )
    return "context-list";
  if (systemPrompt.includes('"in"') && systemPrompt.includes('"out"'))
    return "ports";
  if (systemPrompt.includes("infrastructure adapters")) return "adapters";
  return "unknown";
}

function createMockLLM(
  responses: Record<string, string[]>,
  failOnFirstAttempt?: string,
): SendStructuredRequestPort {
  const callCounts: Record<string, number> = {};

  return {
    sendRequest: async (request: LLMRequest): Promise<Result<LLMResponse>> => {
      const systemMsg =
        request.messages.find((m) => m.role === "system")?.content ?? "";
      const phase = detectPhase(systemMsg);

      if (failOnFirstAttempt === phase && (callCounts[phase] ?? 0) === 0) {
        callCounts[phase] = (callCounts[phase] ?? 0) + 1;
        return { success: false, error: new Error("LLM request failed") };
      }

      const phaseResponses = responses[phase] ?? [];
      const idx = Math.min(callCounts[phase] ?? 0, phaseResponses.length - 1);
      callCounts[phase] = (callCounts[phase] ?? 0) + 1;

      const content = phaseResponses[idx];
      return {
        success: true,
        value: {
          id: "test-resp",
          modelId: "qwen-coder-3b",
          content,
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          timestamp: Date.now(),
        },
      };
    },
    streamStructuredRequest: async function* () {
      yield { success: true, value: "" };
    },
  } as unknown as SendStructuredRequestPort;
}

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

describe.skip("GenerateManifestFromDescriptionUseCase - 4-pass orchestration", () => {
  it("completes full 4-pass pipeline with valid LLM responses", async () => {
    const llm = createMockLLM({
      workspace: [WORKSPACE_JSON],
      "context-list": [CONTEXT_LIST_JSON],
      ports: [PORTS_JSON, PORTS_JSON],
      adapters: [ADAPTERS_JSON, ADAPTERS_JSON],
    });

    const useCase = new GenerateManifestFromDescriptionUseCase(llm);
    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(response.success, true);
    assert.ok(response.manifest, "manifest should be present");
    assert.ok(response.diagnostics, "diagnostics should be present");
    assert.strictEqual(response.diagnostics!.model, "qwen-coder-3b");
    assert.strictEqual(response.diagnostics!.repairApplied, false);
    assert.strictEqual(response.warnings, undefined);
  });

  it("recovers from LLM failure on first attempt via retry", async () => {
    const llm = createMockLLM(
      {
        workspace: [WORKSPACE_JSON],
        "context-list": [CONTEXT_LIST_JSON],
        ports: [PORTS_JSON, PORTS_JSON],
        adapters: [ADAPTERS_JSON, ADAPTERS_JSON],
      },
      "context-list",
    );

    const useCase = new GenerateManifestFromDescriptionUseCase(llm);
    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(response.success, true);
    assert.ok(response.diagnostics);
    assert.strictEqual(
      response.diagnostics!.totalAttempts >= 2,
      true,
      "should have retried at least once",
    );
  });

  it("repairs corrupted JSON via repairJSON fallback", async () => {
    const llm = createMockLLM({
      workspace: [WORKSPACE_JSON],
      "context-list": [CONTEXT_LIST_JSON],
      ports: [CORRUPTED_PORTS_JSON, CORRUPTED_PORTS_JSON],
      adapters: [ADAPTERS_JSON, ADAPTERS_JSON],
    });

    const useCase = new GenerateManifestFromDescriptionUseCase(llm);
    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(response.success, true);
    assert.ok(response.diagnostics);
    assert.strictEqual(
      response.diagnostics!.repairApplied,
      true,
      "repair should have been applied",
    );
  });

  it("produces partial result with warnings when context-list fails all attempts", async () => {
    const llm: SendStructuredRequestPort = {
      sendRequest: async (
        request: LLMRequest,
      ): Promise<Result<LLMResponse>> => {
        const systemMsg =
          request.messages.find((m) => m.role === "system")?.content ?? "";
        const phase = detectPhase(systemMsg);
        if (phase === "context-list") {
          return {
            success: true,
            value: {
              id: "test-resp",
              modelId: "qwen-coder-3b",
              content: "this is not json at all no braces",
              finishReason: "stop",
              usage: {
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30,
              },
              timestamp: Date.now(),
            },
          };
        }
        return {
          success: true,
          value: {
            id: "test-resp",
            modelId: "qwen-coder-3b",
            content: WORKSPACE_JSON,
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            timestamp: Date.now(),
          },
        };
      },
      streamStructuredRequest: async function* () {
        yield { success: true, value: "" };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new GenerateManifestFromDescriptionUseCase(llm);
    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(
      response.success,
      true,
      "should still succeed with partial result",
    );
    assert.ok(response.warnings, "should have warnings");
    assert.strictEqual(response.warnings!.length, 1);
    assert.strictEqual(
      response.warnings![0].category,
      ManifestWarningCategory.MISSING_CONTEXTS,
    );
    assert.strictEqual(response.warnings![0].suggestedAction, "clarify");
  });

  it("coerces PascalCase context names to kebab-case", async () => {
    const pascalContexts = JSON.stringify([
      {
        name: "ContentManagement",
        type: "core",
        description: "Manages content",
      },
    ]);
    const llm = createMockLLM({
      workspace: [WORKSPACE_JSON],
      "context-list": [pascalContexts],
      ports: [PORTS_JSON],
      adapters: [ADAPTERS_JSON],
    });

    const useCase = new GenerateManifestFromDescriptionUseCase(llm);
    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(response.success, true);
    assert.ok(response.manifest);
    assert.ok(
      response.manifest.manifest.includes("content-management"),
      "manifest YAML should contain kebab-case context name",
    );
  });

  it("returns diagnostics with token counts and processing time", async () => {
    const llm = createMockLLM({
      workspace: [WORKSPACE_JSON],
      "context-list": [CONTEXT_LIST_JSON],
      ports: [PORTS_JSON, PORTS_JSON],
      adapters: [ADAPTERS_JSON, ADAPTERS_JSON],
    });

    const useCase = new GenerateManifestFromDescriptionUseCase(llm);
    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(response.success, true);
    assert.ok(response.diagnostics);
    assert.strictEqual(response.diagnostics!.tokensUsed > 0, true);
    assert.strictEqual(response.diagnostics!.processingTime >= 0, true);
    assert.strictEqual(response.diagnostics!.model, "qwen-coder-3b");
  });
});

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
        modelId: "gpt-4o-mini",
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
