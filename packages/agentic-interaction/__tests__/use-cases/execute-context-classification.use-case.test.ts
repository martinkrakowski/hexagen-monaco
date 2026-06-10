import test from "node:test";
import assert from "node:assert/strict";
import { ExecuteContextClassificationUseCase } from "../../src/application/use-cases/staged-generation/execute-context-classification.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";

test("ExecuteContextClassificationUseCase adversarial regression test - blocks infrastructure nouns", async () => {
  const adversarialNDJSON = `
{"status": "accepted", "name": "climate-policy", "contextType": "core", "reasoning": "Valid domain"}
{"status": "accepted", "name": "postgres-database", "contextType": "supporting", "reasoning": "I hallucinated this infrastructure as a context"}
{"status": "accepted", "name": "mqtt-listener-adapter", "contextType": "generic", "reasoning": "Adapter masquerading as context"}
{"status": "accepted", "name": "redis-cache", "contextType": "shared-kernel", "reasoning": "Cache masquerading as context"}
`.trim();

  const mockLLMPort: SendStructuredRequestPort = {
    sendRequest: async () => ({
      success: true as const,
      value: {
        id: "test",
        modelId: "qwen-coder-3b" as any,
        content: adversarialNDJSON,
        finishReason: "stop" as const,
        timestamp: Date.now(),
      },
    }),
    streamStructuredRequest: async function* () {
      yield { success: true, value: adversarialNDJSON };
    },
  };

  const useCase = new ExecuteContextClassificationUseCase(mockLLMPort);

  const result = await useCase.execute({
    stage0: {
      intent: "Build a climate policy system",
      explicitTechnologies: ["PostgreSQL", "Redis", "MQTT"],
      explicitPatterns: [],
      ambiguities: [],
    },
    stage1: {
      subdomains: ["Climate Policy"],
      nouns: ["Policy"],
      verbs: ["evaluate"],
    },
  });

  assert.ok(result.success, "Use case should succeed");

  const classification = result.value;

  assert.strictEqual(classification.accepted.length, 1);
  assert.strictEqual(classification.accepted[0].name, "climate-policy");

  assert.strictEqual(classification.rejected.length, 3);

  const rejectedNames = classification.rejected.map((r) => r.name);
  assert.ok(rejectedNames.includes("postgres-database"));
  assert.ok(rejectedNames.includes("mqtt-listener-adapter"));
  assert.ok(rejectedNames.includes("redis-cache"));

  const firstRejected = classification.rejected.find(
    (r) => r.name === "postgres-database",
  );
  assert.ok(
    firstRejected?.reasoning.includes(
      "Safety Filter: Context name contains a banned token",
    ),
    "Must contain safety filter reasoning",
  );
});
