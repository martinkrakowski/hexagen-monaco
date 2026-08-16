import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { ServerLLMAdapter } from "@hexagen/agentic-interaction";
import type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMProviderPort,
  SecretVaultPort,
} from "@hexagen/agentic-interaction";
import type { Result } from "@hexagen/shared";
import {
  ALLOWED_REFACTOR_TOOLS,
  TUI_REFACTOR_ENDPOINT,
  createRefactorLLMProvider,
  refactorWithAI,
} from "../../src/services/action-service.js";
import type { ViolationItem } from "../../src/state/use-tui-store.js";

const VIOLATION: ViolationItem = {
  ruleId: "no-cross-context-import",
  severity: "error",
  file: "packages/governance/src/domain/thing.ts",
  message: "domain imports infrastructure",
};

/**
 * Records every request it is handed and replays a scripted response.
 * If the production code ignores the injected port and reaches for the
 * network itself, `requests` stays empty and the assertions below fail.
 */
class RecordingLLM implements LLMProviderPort {
  readonly requests: LLMCompletionRequest[] = [];

  constructor(private readonly replyContent: string) {}

  async complete(
    request: LLMCompletionRequest,
  ): Promise<Result<LLMCompletionResponse>> {
    this.requests.push(request);
    return {
      success: true,
      value: {
        id: "cmpl-recording",
        model: request.model,
        choices: [
          {
            message: { role: "assistant", content: this.replyContent },
            finishReason: "stop",
          },
        ],
      },
    };
  }

  async *streamComplete(): AsyncGenerator<Result<string>> {
    yield { success: false, error: new Error("not used") };
  }
}

class RecordingInvoker {
  readonly calls: Array<{
    name: string;
    arguments?: Record<string, unknown>;
  }> = [];

  async callTool(input: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown> {
    this.calls.push(input);
    return { content: [{ text: "applied" }] };
  }
}

describe("action-service drives the shared LLM port", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: number;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = 0;
    // Any inlined HTTP in the TUI would go through here. Tripping this is a
    // hard failure, not a fallback — the point of the item is that apps/tui
    // no longer speaks HTTP to an LLM vendor itself.
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("apps/tui must not call fetch directly");
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends the violation through the injected port and never touches fetch", async () => {
    const llm = new RecordingLLM(
      JSON.stringify({
        tool: "hexagen_create_port",
        arguments: { context: "governance", portName: "ThingPort" },
      }),
    );
    const invoker = new RecordingInvoker();

    const outcome = await refactorWithAI(invoker, VIOLATION, llm);

    assert.equal(
      fetchCalls,
      0,
      "refactorWithAI must not perform its own HTTP call",
    );
    assert.equal(
      llm.requests.length,
      1,
      "the injected LLMProviderPort must be the one that ran",
    );

    const request = llm.requests[0];
    assert.equal(request.model, "gpt-4o");
    assert.equal(request.temperature, 0);
    assert.equal(request.maxTokens, 1024);
    assert.equal(request.messages[0].role, "system");
    assert.equal(request.messages[1].role, "user");
    assert.ok(
      request.messages[1].content.includes("no-cross-context-import"),
      "the user message must carry the selected violation",
    );

    // Values here can only have come from the fake's scripted reply, so this
    // fails against any implementation that ignores the port's output.
    assert.deepEqual(invoker.calls, [
      {
        name: "hexagen_create_port",
        arguments: { context: "governance", portName: "ThingPort" },
      },
    ]);
    assert.equal(outcome, "applied");
  });

  it("refuses a tool outside the allow-list without invoking it", async () => {
    // A real registry tool that is deliberately NOT in the TUI allow-list.
    const llm = new RecordingLLM(
      JSON.stringify({ tool: "hexagen_remove_context", arguments: {} }),
    );
    const invoker = new RecordingInvoker();

    const outcome = await refactorWithAI(invoker, VIOLATION, llm);

    assert.equal(llm.requests.length, 1);
    assert.deepEqual(invoker.calls, [], "destructive tool must not be invoked");
    assert.ok(outcome.includes("hexagen_remove_context"));
    assert.ok(
      !ALLOWED_REFACTOR_TOOLS.includes("hexagen_remove_context" as never),
    );
  });

  it("parses a fenced reply via the shared JSON extractor", async () => {
    const llm = new RecordingLLM(
      '```json\n{"tool":"hexagen_add_dependency","arguments":{"from":"a","to":"b"}}\n```',
    );
    const invoker = new RecordingInvoker();

    await refactorWithAI(invoker, VIOLATION, llm);

    assert.deepEqual(invoker.calls, [
      {
        name: "hexagen_add_dependency",
        arguments: { from: "a", to: "b" },
      },
    ]);
  });

  it("reports a missing key without calling the LLM or any tool", async () => {
    const invoker = new RecordingInvoker();

    const outcome = await refactorWithAI(invoker, VIOLATION, null);

    assert.equal(
      outcome,
      "OPENAI_API_KEY is not set. Unable to invoke AI refactor.",
    );
    assert.deepEqual(invoker.calls, []);
    assert.equal(fetchCalls, 0);
  });
});

describe("createRefactorLLMProvider drives the shared provider config", () => {
  it("resolves the key through the vault and returns the shared adapter", () => {
    const asked: string[] = [];
    const vault: SecretVaultPort = {
      getSecret: (name) => {
        asked.push(name);
        return "sk-test-key";
      },
    };

    const provider = createRefactorLLMProvider(vault);

    // Key resolution must go through the shared SecretVaultPort contract, not
    // a direct process.env read inside the TUI.
    assert.deepEqual(asked, ["OPENAI_API_KEY"]);
    // Identity check: a re-inlined local adapter class would not satisfy this.
    assert.ok(
      provider instanceof ServerLLMAdapter,
      "must return the shared ServerLLMAdapter, not a TUI-local HTTP class",
    );
  });

  it("returns null when the vault has no key", () => {
    const provider = createRefactorLLMProvider({ getSecret: () => null });
    assert.equal(provider, null);
  });

  it("pins the refactor endpoint to the shared CloudProviderEndpoint shape", () => {
    assert.equal(TUI_REFACTOR_ENDPOINT.providerId, "openai");
    assert.equal(TUI_REFACTOR_ENDPOINT.baseUrl, "https://api.openai.com/v1");
    assert.equal(TUI_REFACTOR_ENDPOINT.model, "gpt-4o");
    assert.equal(TUI_REFACTOR_ENDPOINT.apiKeyEnvVar, "OPENAI_API_KEY");
    assert.equal(TUI_REFACTOR_ENDPOINT.temperature, 0);
    assert.equal(TUI_REFACTOR_ENDPOINT.maxTokens, 1024);
  });
});
