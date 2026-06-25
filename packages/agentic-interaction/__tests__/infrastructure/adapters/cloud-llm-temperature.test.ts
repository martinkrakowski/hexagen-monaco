import { test, describe } from "vitest";
import assert from "node:assert";
import { z } from "zod";
import {
  clampTemperatureFor,
  INCEPTION_TEMPERATURE_MIN,
  INCEPTION_TEMPERATURE_MAX,
} from "../../../src/infrastructure/adapters/cloud-llm-temperature";
import { CloudLLMPipelineAdapter } from "../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";

describe("clampTemperatureFor", () => {
  const inception = { apiKeyEnvVar: "INCEPTION_API_KEY" };

  test("Inception: sub-floor values clamp to 0.5 (the silent-0.75 trap)", () => {
    // The Inception API silently coerces out-of-range temperatures to 0.75.
    // Stages send 0.1 — without the clamp every run executes at 0.75.
    assert.strictEqual(clampTemperatureFor(inception, 0.1), 0.5);
    assert.strictEqual(clampTemperatureFor(inception, 0), 0.5);
    assert.strictEqual(clampTemperatureFor(inception, 0.3), 0.5);
  });

  test("Inception: in-range values pass through untouched", () => {
    assert.strictEqual(clampTemperatureFor(inception, 0.5), 0.5);
    assert.strictEqual(clampTemperatureFor(inception, 0.7), 0.7);
    assert.strictEqual(clampTemperatureFor(inception, 1), 1);
  });

  test("Inception: above-range values clamp to 1", () => {
    assert.strictEqual(clampTemperatureFor(inception, 1.5), 1);
  });

  test("every other provider passes through untouched (byte-identical bodies)", () => {
    for (const apiKeyEnvVar of [
      "LLM_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
    ]) {
      assert.strictEqual(clampTemperatureFor({ apiKeyEnvVar }, 0.1), 0.1);
      assert.strictEqual(clampTemperatureFor({ apiKeyEnvVar }, 1.5), 1.5);
    }
  });

  test("exported bounds match the empirically probed Inception range [0.5, 1]", () => {
    assert.strictEqual(INCEPTION_TEMPERATURE_MIN, 0.5);
    assert.strictEqual(INCEPTION_TEMPERATURE_MAX, 1);
  });
});

describe("temperature clamp reaches the wire (live cloud path)", () => {
  // Same body-capture pattern as cloud-llm-reasoning.test.ts — through
  // CloudLLMPipelineAdapter, the adapter that serves the staged pipeline.
  function captureBodyFetch(captured: { body?: Record<string, unknown> }) {
    return async (_url: string | URL | Request, init?: RequestInit) => {
      captured.body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "test",
          model: "test-model",
          choices: [
            { message: { content: "ok" }, finish_reason: "stop", index: 0 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
  }

  function makeAdapter(
    captured: { body?: Record<string, unknown> },
    apiKeyEnvVar: string,
  ) {
    return new CloudLLMPipelineAdapter({
      fallbackChain: {
        primary: {
          providerId: "test",
          model: "test-model",
          apiKeyEnvVar,
          baseUrl: "https://example.com",
        },
        fallbacks: [],
      },
      secretVault: { getSecret: () => "fake-secret" },
      fetchFn: captureBodyFetch(captured) as typeof fetch,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  function makeRequest() {
    return createLLMRequest(
      DomainModelId.QWEN_CODER_3B,
      [{ role: "user", content: "hi" }],
      z.string(),
      // The stage-typical sub-floor temperature.
      { temperature: 0.1, maxTokens: 16 },
    );
  }

  test("Inception provider: request temperature 0.1 hits the wire as 0.5", async () => {
    const captured: { body?: Record<string, unknown> } = {};
    await makeAdapter(captured, "INCEPTION_API_KEY").sendRequest(makeRequest());
    assert.strictEqual(captured.body?.temperature, 0.5);
  });

  test("non-Inception provider: request temperature 0.1 hits the wire unchanged", async () => {
    const captured: { body?: Record<string, unknown> } = {};
    await makeAdapter(captured, "LLM_API_KEY").sendRequest(makeRequest());
    assert.strictEqual(captured.body?.temperature, 0.1);
  });
});
