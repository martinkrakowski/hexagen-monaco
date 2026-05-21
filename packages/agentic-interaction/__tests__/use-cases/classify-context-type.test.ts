import { describe, it } from "node:test";
import assert from "node:assert";
import { ClassifyContextTypeUseCase } from "../../src/application/use-cases/staged-generation/classify-context-type.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { LLMResponse } from "@hexagen/local-llm/client";
import { ok, err } from "@hexagen/shared";

function makeStubPort(
  response: LLMResponse | (() => LLMResponse),
  shouldFail = false,
): SendStructuredRequestPort {
  return {
    sendRequest: async () => {
      if (shouldFail) {
        return err(new Error("LLM unavailable"));
      }
      const resp = typeof response === "function" ? response() : response;
      return ok(resp);
    },
    streamStructuredRequest: async function* () {
      yield ok("");
    },
  };
}

function makeLLMResponse(content: string): LLMResponse {
  return {
    id: "test-resp-1",
    modelId: "qwen-coder-3b" as never,
    content,
    finishReason: "stop",
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    timestamp: Date.now(),
  };
}

describe("ClassifyContextTypeUseCase", () => {
  it("returns type 'supporting' for valid LLM response", async () => {
    const port = makeStubPort(
      makeLLMResponse('{"type":"supporting","reasoning":"Augments core"}'),
    );
    const useCase = new ClassifyContextTypeUseCase(port);
    const result = await useCase.execute({
      name: "NotificationService",
      responsibility: "Sends notifications",
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.type, "supporting");
      assert.strictEqual(result.reasoning, "Augments core");
    }
  });

  it("returns type 'core' for valid LLM response", async () => {
    const port = makeStubPort(
      makeLLMResponse('{"type":"core","reasoning":"Primary business"}'),
    );
    const useCase = new ClassifyContextTypeUseCase(port);
    const result = await useCase.execute({
      name: "OrderManagement",
      responsibility: "Manages orders",
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.type, "core");
    }
  });

  it("returns type 'generic' for valid LLM response", async () => {
    const port = makeStubPort(
      makeLLMResponse('{"type":"generic","reasoning":"General-purpose auth"}'),
    );
    const useCase = new ClassifyContextTypeUseCase(port);
    const result = await useCase.execute({
      name: "IdentityAccess",
      responsibility: "Authentication and authorization",
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.type, "generic");
    }
  });

  it("returns type 'shared-kernel' for valid LLM response", async () => {
    const port = makeStubPort(
      makeLLMResponse('{"type":"shared-kernel","reasoning":"Shared contract"}'),
    );
    const useCase = new ClassifyContextTypeUseCase(port);
    const result = await useCase.execute({
      name: "SharedKernel",
      responsibility: "Cross-cutting events",
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.type, "shared-kernel");
    }
  });

  it("returns success: false for malformed JSON", async () => {
    const port = makeStubPort(makeLLMResponse("not json at all"));
    const useCase = new ClassifyContextTypeUseCase(port);
    const result = await useCase.execute({
      name: "SomeContext",
    });
    assert.strictEqual(result.success, false);
  });

  it("returns success: false for wrong schema", async () => {
    const port = makeStubPort(
      makeLLMResponse('{"type":"invalid","reasoning":"bad"}'),
    );
    const useCase = new ClassifyContextTypeUseCase(port);
    const result = await useCase.execute({
      name: "SomeContext",
    });
    assert.strictEqual(result.success, false);
  });

  it("returns success: false when LLM call fails", async () => {
    const port = makeStubPort(makeLLMResponse(""), true);
    const useCase = new ClassifyContextTypeUseCase(port);
    const result = await useCase.execute({
      name: "SomeContext",
    });
    assert.strictEqual(result.success, false);
  });

  it("strips markdown fences from LLM response", async () => {
    const port = makeStubPort(
      makeLLMResponse(
        '```json\n{"type":"supporting","reasoning":"Fenced output"}\n```',
      ),
    );
    const useCase = new ClassifyContextTypeUseCase(port);
    const result = await useCase.execute({
      name: "AuditLogging",
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.type, "supporting");
    }
  });
});

describe("compileClassifyContextTypePrompt", () => {
  it("includes context name", async () => {
    const { compileClassifyContextTypePrompt } =
      await import("../../src/domain/prompts/classify-context-type.prompt");
    const prompt = compileClassifyContextTypePrompt({ name: "Billing" });
    assert.match(prompt, /<context_name>Billing<\/context_name>/);
  });

  it("includes responsibility when provided", async () => {
    const { compileClassifyContextTypePrompt } =
      await import("../../src/domain/prompts/classify-context-type.prompt");
    const prompt = compileClassifyContextTypePrompt({
      name: "Billing",
      responsibility: "Handles payments",
    });
    assert.match(prompt, /<responsibility>Handles payments<\/responsibility>/);
  });

  it("omits responsibility when not provided", async () => {
    const { compileClassifyContextTypePrompt } =
      await import("../../src/domain/prompts/classify-context-type.prompt");
    const prompt = compileClassifyContextTypePrompt({ name: "Billing" });
    assert.strictEqual(prompt.includes("responsibility"), false);
  });
});

describe("CLASSIFY_CONTEXT_TYPE_SYSTEM_PROMPT", () => {
  it("contains DDD classification instructions", async () => {
    const { CLASSIFY_CONTEXT_TYPE_SYSTEM_PROMPT } =
      await import("../../src/domain/prompts/classify-context-type.prompt");
    assert.match(
      CLASSIFY_CONTEXT_TYPE_SYSTEM_PROMPT,
      /context-type classifier/,
    );
    assert.match(
      CLASSIFY_CONTEXT_TYPE_SYSTEM_PROMPT,
      /core.*supporting.*generic.*shared-kernel/s,
    );
  });
});
