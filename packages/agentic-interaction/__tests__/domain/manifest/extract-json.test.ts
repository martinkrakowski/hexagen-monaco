import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractJSON,
  parseJSON,
} from "../../../src/domain/manifest/extract-json.js";

describe("extractJSON", () => {
  it("extracts JSON from markdown code fence", () => {
    const raw = '```json\n{"key": "value"}\n```';
    assert.strictEqual(extractJSON(raw), '{"key": "value"}');
  });

  it("extracts JSON from code fence without language tag", () => {
    const raw = '```\n{"key": "value"}\n```';
    assert.strictEqual(extractJSON(raw), '{"key": "value"}');
  });

  it("extracts JSON object from raw text without fences", () => {
    const raw = 'Here is the result: {"key": "value"} and more';
    assert.strictEqual(extractJSON(raw), '{"key": "value"}');
  });

  it("extracts JSON array from raw text", () => {
    const raw = '[{"name": "a"}, {"name": "b"}]';
    assert.strictEqual(extractJSON(raw), '[{"name": "a"}, {"name": "b"}]');
  });

  it("returns trimmed input when no JSON structure found", () => {
    const raw = "  plain text  ";
    assert.strictEqual(extractJSON(raw), "plain text");
  });
});

describe("parseJSON", () => {
  it("parses valid JSON object", () => {
    const result = parseJSON<Record<string, string>>('{"key": "value"}');
    assert.strictEqual(result.ok, true);
    if (result.ok) assert.deepStrictEqual(result.data, { key: "value" });
  });

  it("parses valid JSON from fenced response", () => {
    const result = parseJSON<Record<string, string>>(
      '```json\n{"key": "value"}\n```',
    );
    assert.strictEqual(result.ok, true);
    if (result.ok) assert.deepStrictEqual(result.data, { key: "value" });
  });

  it("returns error for invalid JSON", () => {
    const result = parseJSON("{invalid}");
    assert.strictEqual(result.ok, false);
    if (!result.ok) assert.match(result.error, /JSON parse error/);
  });

  it("parses JSON array", () => {
    const result = parseJSON<string[]>('["a", "b"]');
    assert.strictEqual(result.ok, true);
    if (result.ok) assert.deepStrictEqual(result.data, ["a", "b"]);
  });
});
