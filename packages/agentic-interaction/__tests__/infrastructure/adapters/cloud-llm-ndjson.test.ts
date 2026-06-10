/**
 * NDJSON structured-output enforcement for Inception/Mercury.
 *
 * Contract: a request carrying `ndjsonLineSchema` gets a `response_format`
 * json_schema body field on the Inception provider ONLY (array-of-objects
 * wrapped in `{ lines: [...] }` — a single-object schema truncates the
 * response to ONE object, see cloud-llm-ndjson.ts), and the returned JSON
 * array is converted back to NDJSON text so the stages' line parsers work
 * unchanged. Every other provider's bodies stay byte-identical.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { z } from "zod";
import {
  ndjsonResponseFormatFor,
  unwrapNdjsonLines,
} from "../../../src/infrastructure/adapters/cloud-llm-ndjson";
import { STAGE2_NDJSON_LINE_SCHEMA } from "../../../src/domain/prompts/ndjson-line-schemas";
import { CloudLLMPipelineAdapter } from "../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";

describe("ndjsonResponseFormatFor", () => {
  const inception = { apiKeyEnvVar: "INCEPTION_API_KEY" };
  const lineSchema = { type: "object", properties: { id: {} } };

  test("Inception + line schema → response_format wraps it in a lines array", () => {
    const result = ndjsonResponseFormatFor(inception, {
      ndjsonLineSchema: lineSchema,
    });
    assert.ok("response_format" in result, "response_format present");
    const rf = result.response_format as Record<string, unknown>;
    assert.strictEqual(rf.type, "json_schema");
    const schema = (rf.json_schema as Record<string, unknown>).schema as Record<
      string,
      unknown
    >;
    assert.deepStrictEqual(schema.required, ["lines"]);
    assert.deepStrictEqual(
      (schema.properties as Record<string, unknown>).lines,
      { type: "array", items: lineSchema },
    );
  });

  test("Inception without a line schema → empty (no response_format)", () => {
    assert.deepStrictEqual(ndjsonResponseFormatFor(inception, {}), {});
  });

  test("every other provider → empty, even with a line schema", () => {
    for (const apiKeyEnvVar of ["LLM_API_KEY", "OPENAI_API_KEY"]) {
      assert.deepStrictEqual(
        ndjsonResponseFormatFor(
          { apiKeyEnvVar },
          { ndjsonLineSchema: lineSchema },
        ),
        {},
      );
    }
  });
});

describe("unwrapNdjsonLines", () => {
  test("wrapper object → one JSON line per element", () => {
    const out = unwrapNdjsonLines(
      '{"lines":[{"status":"accepted","name":"billing"},{"status":"rejected","name":"postgres"}]}',
    );
    assert.strictEqual(
      out,
      '{"status":"accepted","name":"billing"}\n{"status":"rejected","name":"postgres"}',
    );
  });

  test("bare top-level array (defensive) → NDJSON lines", () => {
    assert.strictEqual(
      unwrapNdjsonLines('[{"a":1},{"b":2}]'),
      '{"a":1}\n{"b":2}',
    );
  });

  test("model ignored the schema and emitted NDJSON anyway → null (caller falls back to raw)", () => {
    // Multi-line NDJSON is not a single JSON document — JSON.parse throws.
    assert.strictEqual(unwrapNdjsonLines('{"a":1}\n{"b":2}'), null);
  });

  test("non-array `lines`, non-JSON, and empty content → null", () => {
    assert.strictEqual(unwrapNdjsonLines('{"lines":"not an array"}'), null);
    assert.strictEqual(unwrapNdjsonLines("plain prose"), null);
    assert.strictEqual(unwrapNdjsonLines(""), null);
  });

  test("empty lines array → empty string (valid: zero NDJSON lines)", () => {
    assert.strictEqual(unwrapNdjsonLines('{"lines":[]}'), "");
  });
});

describe("NDJSON enforcement reaches the wire (live cloud path)", () => {
  // Same body-capture pattern as cloud-llm-reasoning.test.ts.
  function captureFetch(
    captured: { body?: Record<string, unknown> },
    responseContent: string,
  ) {
    return async (_url: string | URL | Request, init?: RequestInit) => {
      captured.body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "test",
          model: "test-model",
          choices: [
            {
              message: { content: responseContent },
              finish_reason: "stop",
              index: 0,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
  }

  function makeAdapter(
    captured: { body?: Record<string, unknown> },
    apiKeyEnvVar: string,
    responseContent: string,
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
      fetchFn: captureFetch(captured, responseContent) as typeof fetch,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  function makeRequest(withSchema: boolean) {
    return createLLMRequest(
      DomainModelId.QWEN_CODER_3B,
      [{ role: "user", content: "hi" }],
      z.string(),
      {
        temperature: 0.5,
        maxTokens: 16,
        ...(withSchema ? { ndjsonLineSchema: STAGE2_NDJSON_LINE_SCHEMA } : {}),
      },
    );
  }

  test("Inception + schema: body carries response_format; lines come back as NDJSON", async () => {
    const captured: { body?: Record<string, unknown> } = {};
    const result = await makeAdapter(
      captured,
      "INCEPTION_API_KEY",
      '{"lines":[{"status":"accepted","name":"billing","reasoning":"r"}]}',
    ).sendRequest(makeRequest(true));
    assert.ok(
      "response_format" in (captured.body ?? {}),
      "wire body has response_format",
    );
    assert.ok(result.success);
    assert.strictEqual(
      result.value.content,
      '{"status":"accepted","name":"billing","reasoning":"r"}',
    );
  });

  test("Inception + schema, model returns NDJSON anyway: raw content passes through", async () => {
    const raw =
      '{"status":"accepted","name":"a","reasoning":"r"}\n{"status":"rejected","name":"b","reasoning":"r"}';
    const captured: { body?: Record<string, unknown> } = {};
    const result = await makeAdapter(
      captured,
      "INCEPTION_API_KEY",
      raw,
    ).sendRequest(makeRequest(true));
    assert.ok(result.success);
    assert.strictEqual(result.value.content, raw);
  });

  test("non-Inception provider + schema: no response_format, content untouched", async () => {
    const raw = '{"lines":[{"x":1}]}';
    const captured: { body?: Record<string, unknown> } = {};
    const result = await makeAdapter(captured, "LLM_API_KEY", raw).sendRequest(
      makeRequest(true),
    );
    assert.ok(
      !("response_format" in (captured.body ?? {})),
      "no response_format off Inception",
    );
    assert.ok(result.success);
    // Crucially NOT unwrapped — only schema-enforced requests are converted.
    assert.strictEqual(result.value.content, raw);
  });

  test("Inception without schema: no response_format, content untouched", async () => {
    const raw = '{"lines":[{"x":1}]}';
    const captured: { body?: Record<string, unknown> } = {};
    const result = await makeAdapter(
      captured,
      "INCEPTION_API_KEY",
      raw,
    ).sendRequest(makeRequest(false));
    assert.ok(!("response_format" in (captured.body ?? {})));
    assert.ok(result.success);
    assert.strictEqual(result.value.content, raw);
  });
});
