import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GenerateManifestFromDescriptionUseCase,
  ManifestWarningCategory,
} from "../../src/application/use-cases/generate-manifest-from-description.use-case.js";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import type { LLMRequest } from "@hexagen/local-llm";
import type { LLMResponse } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";

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

interface PhaseResponses {
  workspace: string[];
  "context-list": string[];
  ports: string[];
  adapters: string[];
}

class FakeLLMAdapter implements SendStructuredRequestPort {
  private callCounts: Record<string, number> = {};

  constructor(private readonly phaseResponses: PhaseResponses) {}

  async sendRequest(request: LLMRequest): Promise<Result<LLMResponse>> {
    const systemMsg =
      request.messages.find((m) => m.role === "system")?.content ?? "";
    const phase = detectPhase(systemMsg);
    const responses = this.phaseResponses[phase] || [];
    const idx = Math.min(
      this.callCounts[phase] || 0,
      Math.max(0, responses.length - 1),
    );
    this.callCounts[phase] = (this.callCounts[phase] || 0) + 1;

    const content = responses[idx] || "{}";

    return {
      success: true,
      value: {
        id: "test-resp",
        modelId: "fake-llm-mock",
        content,
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        timestamp: Date.now(),
      },
    };
  }

  async *streamStructuredRequest(): AsyncGenerator<Result<string>> {
    yield { success: true, value: "" };
  }
}

const VALID_WORKSPACE = JSON.stringify({
  name: "blog-platform",
  description: "A modern blog platform",
});

const VALID_CONTEXTS = JSON.stringify([
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

const VALID_PORTS = JSON.stringify({
  in: [
    { name: "CreatePostPort", type: "UseCase", description: "Creates posts" },
  ],
  out: [
    {
      name: "PostRepositoryPort",
      type: "Repository",
      description: "Persists posts",
    },
  ],
});

const VALID_ADAPTERS = JSON.stringify([
  {
    name: "PostgresPostAdapter",
    type: "Repository",
    implements: "PostRepositoryPort",
  },
]);

function makeDescription(text = "Build a blog platform with user accounts") {
  return {
    text,
    language: "en",
    timestamp: new Date(),
    platform: "Node.js",
    deployment: "Cloud-native",
  };
}

describe("Flow 1: NL Input → Manifest Mutation Integration", () => {
  it("Happy path: valid description produces valid manifest with correct structure", async () => {
    const fakeLLM = new FakeLLMAdapter({
      workspace: [VALID_WORKSPACE],
      "context-list": [VALID_CONTEXTS],
      ports: [VALID_PORTS, VALID_PORTS],
      adapters: [VALID_ADAPTERS, VALID_ADAPTERS],
    });

    const useCase = new GenerateManifestFromDescriptionUseCase(fakeLLM);
    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(response.success, true);
    assert.ok(response.manifest);
    assert.ok(response.diagnostics);
    assert.strictEqual(response.diagnostics!.model, "fake-llm-mock");
    assert.strictEqual(response.warnings, undefined);

    const yaml = response.manifest.manifest;
    assert.ok(yaml.includes("blog-platform"));
    assert.ok(yaml.includes("content-management"));
    assert.ok(yaml.includes("user-accounts"));
    assert.ok(yaml.includes("CreatePostPort"));
    assert.ok(yaml.includes("PostRepositoryPort"));
    assert.ok(yaml.includes("PostgresPostAdapter"));
  });

  it("Error path: invalid JSON in workspace phase returns error result", async () => {
    const fakeLLM = new FakeLLMAdapter({
      workspace: ["not json", "still invalid", "nope"],
      "context-list": [],
      ports: [],
      adapters: [],
    });

    const useCase = new GenerateManifestFromDescriptionUseCase(fakeLLM);
    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(response.success, false);
    assert.ok(response.error?.includes("workspace"));
  });

  it("Error path: invalid port data produces partial results with warnings", async () => {
    const fakeLLM = new FakeLLMAdapter({
      workspace: [VALID_WORKSPACE],
      "context-list": [VALID_CONTEXTS],
      ports: ["bad json", "worse", "nope", "bad json", "worse", "nope"],
      adapters: [],
    });

    const useCase = new GenerateManifestFromDescriptionUseCase(fakeLLM);
    const response = await useCase.execute({ description: makeDescription() });

    assert.strictEqual(response.success, true);
    assert.ok(response.warnings);
    assert.strictEqual(response.warnings!.length, 2);
    assert.ok(
      response.warnings!.every(
        (w) => w.category === ManifestWarningCategory.MISSING_PORTS,
      ),
    );
  });
});
