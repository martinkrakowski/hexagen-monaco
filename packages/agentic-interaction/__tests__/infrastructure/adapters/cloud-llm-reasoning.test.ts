/**
 * LLM_REASONING passthrough (OpenRouter `reasoning` body field).
 *
 * Contract: unset env → the field is OMITTED (byte-identical bodies for every
 * existing caller, prod included). Set to disabled/low/medium/high → the
 * corresponding OpenRouter shape. Anything else → omitted (with a one-time
 * warning, not asserted here).
 *
 * Why: reasoning-default models bill thinking as completion tokens against
 * the stage maxTokens caps → finishReason "length", empty content, 0% runs
 * (baseline findings F1). This knob makes such models benchmarkable per-run.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { reasoningBodyField } from "../../../src/infrastructure/adapters/cloud-llm-reasoning";
import { CloudLLMPipelineAdapter } from "../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";

describe("reasoningBodyField", () => {
  test("unset → empty object (field omitted)", () => {
    assert.deepStrictEqual(reasoningBodyField({}), {});
    assert.deepStrictEqual(reasoningBodyField({ LLM_REASONING: "" }), {});
    assert.deepStrictEqual(reasoningBodyField({ LLM_REASONING: "  " }), {});
  });

  test("disabled → { reasoning: { enabled: false } }", () => {
    assert.deepStrictEqual(reasoningBodyField({ LLM_REASONING: "disabled" }), {
      reasoning: { enabled: false },
    });
  });

  test("low/medium/high → { reasoning: { effort } }", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      assert.deepStrictEqual(reasoningBodyField({ LLM_REASONING: effort }), {
        reasoning: { effort },
      });
    }
  });

  test("case/whitespace tolerant", () => {
    assert.deepStrictEqual(
      reasoningBodyField({ LLM_REASONING: " Disabled " }),
      { reasoning: { enabled: false } },
    );
    assert.deepStrictEqual(reasoningBodyField({ LLM_REASONING: "HIGH" }), {
      reasoning: { effort: "high" },
    });
  });

  test("unrecognized value → omitted (typos fall back to provider default)", () => {
    assert.deepStrictEqual(reasoningBodyField({ LLM_REASONING: "off" }), {});
    assert.deepStrictEqual(reasoningBodyField({ LLM_REASONING: "true" }), {});
  });
});

describe("reasoning passthrough reaches the wire (live cloud path)", () => {
  // Body-capture through CloudLLMPipelineAdapter — the adapter that actually
  // serves the staged pipeline and the golden harness (OpenAICompatibleAdapter
  // is exported but has no production construction sites).
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

  function makeAdapter(captured: { body?: Record<string, unknown> }) {
    return new CloudLLMPipelineAdapter({
      fallbackChain: {
        primary: {
          providerId: "test",
          model: "test-model",
          apiKeyEnvVar: "TEST_API_KEY",
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
      { temperature: 0, maxTokens: 16 },
    );
  }

  test("LLM_REASONING unset → request body has NO reasoning field", async () => {
    const prev = process.env.LLM_REASONING;
    delete process.env.LLM_REASONING;
    try {
      const captured: { body?: Record<string, unknown> } = {};
      await makeAdapter(captured).sendRequest(makeRequest());
      assert.ok(captured.body, "request body captured");
      assert.ok(
        !("reasoning" in captured.body),
        "reasoning must be absent when env unset",
      );
    } finally {
      if (prev !== undefined) process.env.LLM_REASONING = prev;
    }
  });

  test("LLM_REASONING=disabled → body carries reasoning.enabled=false", async () => {
    const prev = process.env.LLM_REASONING;
    process.env.LLM_REASONING = "disabled";
    try {
      const captured: { body?: Record<string, unknown> } = {};
      await makeAdapter(captured).sendRequest(makeRequest());
      assert.deepStrictEqual(captured.body?.reasoning, { enabled: false });
    } finally {
      if (prev !== undefined) process.env.LLM_REASONING = prev;
      else delete process.env.LLM_REASONING;
    }
  });
});
