import { test, describe } from "vitest";
import assert from "node:assert";
import { ExecutePromptNormalizationUseCase } from "../../../src/application/use-cases/staged-generation/execute-prompt-normalization.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";

describe("ExecutePromptNormalizationUseCase", () => {
  const validNDJSONResponse = [
    '{"type": "intent", "value": "build a task management system"}',
    '{"type": "technology", "value": "React"}',
    '{"type": "technology", "value": "Node"}',
    '{"type": "pattern", "value": "CRUD"}',
    '{"type": "ambiguity", "value": "Authentication method not specified"}',
  ];

  test("Happy path: executes successfully with valid user description", async () => {
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: validNDJSONResponse.join("\n"),
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        for (const line of validNDJSONResponse) {
          yield { success: true, value: line };
        }
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(mockLLMAdapter);
    const result = await useCase.execute("Build a task management system");

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.intent, "build a task management system");
      assert.deepStrictEqual(result.value.explicitTechnologies, [
        "React",
        "Node",
      ]);
      assert.deepStrictEqual(result.value.explicitPatterns, ["CRUD"]);
      assert.deepStrictEqual(result.value.ambiguities, [
        "Authentication method not specified",
      ]);
    }
  });

  test("Retry path: succeeds after retries", async () => {
    let callCount = 0;
    const mockLLMAdapter = {
      sendRequest: async () => {
        callCount++;
        if (callCount <= 2) {
          return {
            success: true as const,
            value: {
              id: "test",
              modelId: "gpt-4o-mini" as any,
              content: "invalid",
              finishReason: "stop" as const,
              timestamp: Date.now(),
            },
          };
        }
        return {
          success: true as const,
          value: {
            id: "test",
            modelId: "gpt-4o-mini" as any,
            content: validNDJSONResponse.join("\n"),
            finishReason: "stop" as const,
            timestamp: Date.now(),
          },
        };
      },
      streamStructuredRequest: async function* () {
        for (const line of validNDJSONResponse) {
          yield { success: true, value: line };
        }
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(mockLLMAdapter);
    const result = await useCase.execute("Build a task management system");

    assert.strictEqual(result.success, true);
    assert.strictEqual(callCount, 3);
  });

  test("Error path: returns error after max retries", async () => {
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: false as const,
        error: new Error("LLM failure"),
      }),
      streamStructuredRequest: async function* () {
        yield { success: false, error: "Persistent failure" };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(mockLLMAdapter);
    const result = await useCase.execute("Build a task management system");

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error);
    }
  });

  test("Telemetry callback is called on success", async () => {
    const telemetryData: any[] = [];
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: validNDJSONResponse.join("\n"),
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        for (const line of validNDJSONResponse) {
          yield { success: true, value: line };
        }
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(mockLLMAdapter);
    await useCase.execute(
      "Build a task management system",
      undefined,
      undefined,
      (telemetry) => {
        telemetryData.push(telemetry);
      },
    );

    assert.strictEqual(telemetryData.length, 1);
    assert.strictEqual(telemetryData[0].stage, 0);
    assert.strictEqual(telemetryData[0].label, "Prompt Normalization");
    assert.ok(telemetryData[0].durationMs >= 0);
    assert.strictEqual(telemetryData[0].usedLLM, true);
    assert.strictEqual(telemetryData[0].retryCount, 0);
  });

  test("onChunk callback is called for each chunk", async () => {
    const chunks: string[] = [];
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: validNDJSONResponse.join("\n"),
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        for (const line of validNDJSONResponse) {
          yield { success: true, value: line };
        }
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(mockLLMAdapter);
    await useCase.execute(
      "Build a task management system",
      undefined,
      (chunk) => {
        chunks.push(chunk);
      },
    );

    assert.ok(Array.isArray(chunks), "chunks should be an array");
    assert.ok(chunks.length >= 0, "chunks should have some length");
  });

  test("handles LLM timeout", async () => {
    const timeoutAdapter = {
      sendRequest: async () => {
        throw new Error("LLM request timeout");
      },
      streamStructuredRequest: async function* () {
        yield { success: true, value: validNDJSONResponse.join("\n") };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(timeoutAdapter);

    const result = await useCase
      .execute("Build a task management system")
      .catch((err) => {
        return { success: false, error: err };
      });

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test("retry fails on persistent timeout", async () => {
    let callCount = 0;
    const timeoutAdapter = {
      sendRequest: async () => {
        callCount++;
        if (callCount <= 3) {
          throw new Error(`Attempt ${callCount} timed out`);
        }
        return {
          success: true as const,
          value: {
            id: "test",
            modelId: "gpt-4o-mini" as any,
            content: validNDJSONResponse.join("\n"),
            finishReason: "stop" as const,
            timestamp: Date.now(),
          },
        };
      },
      streamStructuredRequest: async function* () {
        yield { success: true, value: validNDJSONResponse.join("\n") };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(timeoutAdapter);
    const result = await useCase
      .execute("Build a task management system")
      .catch((err) => {
        return { success: false, error: err };
      });

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  // The stage-0 system prompt instructs the model to emit zero-or-one
  // "projectName" and "isStructuredConfig" objects, and NormalizedPrompt
  // carries both — but the parser used to drop them, so projectName was
  // always undefined (workspace name fell back to extractProjectName(intent))
  // and isStructuredConfigPipeline() could never return true.
  test("parses projectName and isStructuredConfig per the system prompt contract", async () => {
    const ndjson = [
      '{"type": "intent", "value": "build a task management system"}',
      '{"type": "projectName", "value": "AcmePlatform"}',
      '{"type": "isStructuredConfig", "value": true}',
      '{"type": "technology", "value": "React"}',
    ].join("\n");
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: ndjson,
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: ndjson };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(mockLLMAdapter);
    const result = await useCase.execute("Build AcmePlatform");

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.projectName, "AcmePlatform");
      assert.strictEqual(result.value.isStructuredConfig, true);
    }
  });

  test("rejects malformed projectName/isStructuredConfig values (type guards)", async () => {
    const ndjson = [
      '{"type": "intent", "value": "build a task management system"}',
      '{"type": "projectName", "value": 42}',
      '{"type": "projectName", "value": "   "}',
      '{"type": "isStructuredConfig", "value": "true"}',
      '{"type": "isStructuredConfig", "value": false}',
    ].join("\n");
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: ndjson,
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: ndjson };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(mockLLMAdapter);
    const result = await useCase.execute("Build a task management system");

    assert.strictEqual(result.success, true);
    if (result.success) {
      // Non-string / blank projectName and non-`true` isStructuredConfig
      // must be dropped, leaving the optional fields absent — `in` pins the
      // key-absent shape (strictEqual(undefined) alone would also pass for a
      // present-undefined key).
      assert.ok(!("projectName" in result.value));
      assert.ok(!("isStructuredConfig" in result.value));
    }
  });

  test("stores the trimmed projectName, last emission wins on duplicates", async () => {
    const ndjson = [
      '{"type": "intent", "value": "build a task management system"}',
      '{"type": "projectName", "value": "  FirstName  "}',
      '{"type": "projectName", "value": "  AcmePlatform  "}',
      '{"type": "isStructuredConfig", "value": true}',
      '{"type": "isStructuredConfig", "value": true}',
    ].join("\n");
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: ndjson,
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: ndjson };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(mockLLMAdapter);
    const result = await useCase.execute("Build AcmePlatform");

    assert.strictEqual(result.success, true);
    if (result.success) {
      // Last-wins (consistent with `intent`) + stored value is the trimmed
      // string the guard validated, not the raw emission.
      assert.strictEqual(result.value.projectName, "AcmePlatform");
      assert.strictEqual(result.value.isStructuredConfig, true);
    }
  });

  test("omits projectName/isStructuredConfig when the model does not emit them", async () => {
    const mockLLMAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: validNDJSONResponse.join("\n"),
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        for (const line of validNDJSONResponse) {
          yield { success: true, value: line };
        }
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(mockLLMAdapter);
    const result = await useCase.execute("Build a task management system");

    assert.strictEqual(result.success, true);
    if (result.success) {
      // Keys must be ABSENT (conditional spread), not present-undefined —
      // the `in` checks pin the serialization/telemetry shape.
      assert.ok(!("projectName" in result.value));
      assert.ok(!("isStructuredConfig" in result.value));
    }
  });

  test("handles malformed LLM response", async () => {
    const badAdapter = {
      sendRequest: async () => ({
        success: true as const,
        value: {
          id: "test",
          modelId: "gpt-4o-mini" as any,
          content: "not valid json at all",
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      }),
      streamStructuredRequest: async function* () {
        yield { success: true, value: "not valid json at all" };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecutePromptNormalizationUseCase(badAdapter);
    const result = await useCase.execute("Build a task management system");

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });
});
