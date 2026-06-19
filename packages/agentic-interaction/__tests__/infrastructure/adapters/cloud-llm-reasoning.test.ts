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
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import {
  reasoningBodyField,
  reasoningBodyFieldFor,
  inceptionReasoningBodyField,
} from "../../../src/infrastructure/adapters/cloud-llm-reasoning";
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

describe("inceptionReasoningBodyField (Mercury dialect)", () => {
  // Mercury models reason BY DEFAULT (reasoning_effort defaults to "medium"),
  // so "disabled" must map to their explicit no-reasoning mode, "instant" —
  // omitting the field would silently reproduce the F1 failure mode.
  test("unset → empty object (provider default = medium reasoning)", () => {
    assert.deepStrictEqual(inceptionReasoningBodyField({}), {});
    assert.deepStrictEqual(
      inceptionReasoningBodyField({ LLM_REASONING: "" }),
      {},
    );
  });

  test('disabled → { reasoning_effort: "instant" }', () => {
    assert.deepStrictEqual(
      inceptionReasoningBodyField({ LLM_REASONING: "disabled" }),
      { reasoning_effort: "instant" },
    );
  });

  test("low/medium/high pass through as reasoning_effort", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      assert.deepStrictEqual(
        inceptionReasoningBodyField({ LLM_REASONING: effort }),
        { reasoning_effort: effort },
      );
    }
  });

  test("unrecognized value → omitted", () => {
    assert.deepStrictEqual(
      inceptionReasoningBodyField({ LLM_REASONING: "off" }),
      {},
    );
  });
});

describe("reasoningBodyFieldFor (provider scoping)", () => {
  // The field is dialect-specific; direct endpoints (api.openai.com rejects
  // unknown body args with a non-retryable 400) must never see it, even when
  // LLM_REASONING is set. Only providers whose dialect we know qualify: the
  // LLM_* family's generic endpoint (OpenRouter shape) and Inception
  // (reasoning_effort string).
  test("LLM_API_KEY provider → OpenRouter shape", () => {
    assert.deepStrictEqual(
      reasoningBodyFieldFor(
        { apiKeyEnvVar: "LLM_API_KEY" },
        { LLM_REASONING: "disabled" },
      ),
      { reasoning: { enabled: false } },
    );
  });

  test("INCEPTION_API_KEY provider → Mercury reasoning_effort shape", () => {
    assert.deepStrictEqual(
      reasoningBodyFieldFor(
        { apiKeyEnvVar: "INCEPTION_API_KEY" },
        { LLM_REASONING: "disabled" },
      ),
      { reasoning_effort: "instant" },
    );
  });

  test("any other provider → omitted even when LLM_REASONING is set", () => {
    for (const apiKeyEnvVar of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
      assert.deepStrictEqual(
        reasoningBodyFieldFor({ apiKeyEnvVar }, { LLM_REASONING: "high" }),
        {},
      );
    }
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

  function makeAdapter(
    captured: { body?: Record<string, unknown> },
    // Default to the reasoning-eligible LLM_* generic endpoint; tests for the
    // provider-scoping gate pass a direct-endpoint env var instead.
    apiKeyEnvVar = "LLM_API_KEY",
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

  test("LLM_REASONING=disabled + Inception provider → body carries reasoning_effort=instant", async () => {
    const prev = process.env.LLM_REASONING;
    process.env.LLM_REASONING = "disabled";
    try {
      const captured: { body?: Record<string, unknown> } = {};
      await makeAdapter(captured, "INCEPTION_API_KEY").sendRequest(
        makeRequest(),
      );
      assert.equal(captured.body?.reasoning_effort, "instant");
      assert.ok(
        !("reasoning" in (captured.body ?? {})),
        "Inception must get the Mercury dialect, not the OpenRouter object",
      );
    } finally {
      if (prev !== undefined) process.env.LLM_REASONING = prev;
      else delete process.env.LLM_REASONING;
    }
  });

  test("LLM_REASONING set + direct provider (OPENAI_API_KEY) → field still omitted", async () => {
    const prev = process.env.LLM_REASONING;
    process.env.LLM_REASONING = "disabled";
    try {
      const captured: { body?: Record<string, unknown> } = {};
      await makeAdapter(captured, "OPENAI_API_KEY").sendRequest(makeRequest());
      assert.ok(captured.body, "request body captured");
      assert.ok(
        !("reasoning" in captured.body),
        "direct endpoints must never receive the OpenRouter reasoning field",
      );
    } finally {
      if (prev !== undefined) process.env.LLM_REASONING = prev;
      else delete process.env.LLM_REASONING;
    }
  });
});
