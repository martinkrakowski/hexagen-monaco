import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractJSON,
  repairJSON,
  parseJSON,
  extractArrayFromWrapper,
  extractObjectFromWrapper,
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

  it("preserves formatted JSON array (does not treat as NDJSON)", () => {
    const raw = `[
{"name": "climate-control"},
{"name": "drift-analytics"}
]`;
    const result = extractJSON(raw);
    assert.strictEqual(
      result,
      raw.trim(),
      "Formatted JSON array should not be treated as NDJSON",
    );
  });

  it("preserves NDJSON format (multiple objects, one per line, no array wrapper)", () => {
    const ndjson = `{"name": "climate-control", "type": "core"}
{"name": "drift-analytics", "type": "core"}
{"name": "notification-engine", "type": "supporting"}`;
    const result = extractJSON(ndjson);
    assert.strictEqual(
      result,
      ndjson,
      "NDJSON should be preserved as-is for line-by-line parsing",
    );
  });

  it("detects NDJSON even with markdown fence", () => {
    const raw = `\`\`\`json
{"name": "climate-control"}
{"name": "drift-analytics"}
\`\`\``;
    const result = extractJSON(raw);
    // Should extract the content inside fences
    assert.match(result, /climate-control/);
    assert.match(result, /drift-analytics/);
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

describe("repairJSON", () => {
  it("strips markdown fences and parses valid JSON", () => {
    const raw = '```json\n{"name": "orders"}\n```';
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) assert.deepStrictEqual(JSON.parse(result), { name: "orders" });
  });

  it("removes control characters except newline/tab/cr", () => {
    const raw = '{"name":\x07"orders"}';
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) assert.deepStrictEqual(JSON.parse(result), { name: "orders" });
  });

  it("repairs mid-token substitution corruption (in:g [)", () => {
    const raw = '{"in":g ["CreateOrderPort"], "out": []}';
    const result = repairJSON(raw);
    assert.strictEqual(result, null);
  });

  it("truncates to last complete JSON structure when trailing garbage exists", () => {
    const raw =
      '{"name":"order","type":"core"}\n\n### Here is some extra output';
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      assert.deepStrictEqual(JSON.parse(result), {
        name: "order",
        type: "core",
      });
    }
  });

  it("repairs truncated array with trailing garbage", () => {
    const raw = '[{"name":"orders","type":"core"}] extra text here';
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      const parsed = JSON.parse(result);
      assert.strictEqual(Array.isArray(parsed), true);
    }
  });

  it("handles mixed markdown fence with malformed JSON", () => {
    const raw = '```json\n{"bad": [1,2,3\n```';
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      assert.doesNotThrow(() => JSON.parse(result));
    }
  });

  it("returns null for completely unparseable input", () => {
    const raw = "this is not json at all no braces";
    const result = repairJSON(raw);
    assert.strictEqual(result, null);
  });

  it("handles empty string", () => {
    const result = repairJSON("");
    assert.strictEqual(result, null);
  });

  it("ignores braces inside string values", () => {
    const raw = '{"name": "foo{bar}", "type": "core"} trailing';
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      assert.deepStrictEqual(JSON.parse(result), {
        name: "foo{bar}",
        type: "core",
      });
    }
  });

  it("ignores brackets inside string values", () => {
    const raw = '{"desc": "array [1,2]", "ok": true} garbage';
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      assert.deepStrictEqual(JSON.parse(result), {
        desc: "array [1,2]",
        ok: true,
      });
    }
  });

  it("handles escaped quotes inside strings", () => {
    const raw = '{"name": "say \\"hello\\"", "type": "core"} trailing';
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      assert.deepStrictEqual(JSON.parse(result), {
        name: 'say "hello"',
        type: "core",
      });
    }
  });

  it("fixes unterminated string at end of line", () => {
    const raw = `{
  "in": [
    {
      "name": "ProductPort",
      "description": "Interface for product data access"
    }
  ]
}`;
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      assert.doesNotThrow(() => JSON.parse(result));
      assert.match(result, /"ProductPort"/);
    }
  });

  it("fixes unterminated string in middle of object", () => {
    const raw = `{"in": [{"name": "OrderPort", "description": "Handles order processing`;
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      assert.doesNotThrow(() => JSON.parse(result));
    }
  });

  it("returns valid JSON when input has trailing incomplete structure", () => {
    const raw = `{"in": [{"name": "OrderPort", "description": "Handles order`;
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      assert.doesNotThrow(() => JSON.parse(result));
    }
  });

  it("preserves valid JSON when input is complete", () => {
    const raw = `{"in": [{"name": "Port1"}], "out": []}`;
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      assert.deepStrictEqual(JSON.parse(result), {
        in: [{ name: "Port1" }],
        out: [],
      });
    }
  });

  it("handles unterminated string with no closing quote", () => {
    const raw =
      '{"name": "ProductRepositoryPort", "type": "use-case", "description": "Interface for product data access';
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      assert.doesNotThrow(() => JSON.parse(result));
    }
  });

  it("handles missing closing quotes on multiple string values", () => {
    const raw = '{"name": "Port", "desc": "A port for orders", "type": "core"';
    const result = repairJSON(raw);
    assert.notStrictEqual(result, null);
    if (result) {
      assert.doesNotThrow(() => JSON.parse(result));
    }
  });
});

describe("parseJSON with repair fallback", () => {
  it("parses JSON with control characters via repair", () => {
    const raw = '{"name":\x07"orders","type":"core"}';
    const result = parseJSON<{ name: string }>(raw);
    assert.strictEqual(result.ok, true);
    if (result.ok) assert.strictEqual(result.data.name, "orders");
  });

  it("parses JSON with trailing garbage via repair", () => {
    const raw = '{"name":"orders","type":"core"}###garbage';
    const result = parseJSON<{ name: string }>(raw);
    assert.strictEqual(result.ok, true);
    if (result.ok) assert.strictEqual(result.data.name, "orders");
  });

  it("returns error when repair cannot fix the input", () => {
    const raw = '{"in":g [broken';
    const result = parseJSON(raw);
    assert.strictEqual(result.ok, false);
  });
});

describe("extractArrayFromWrapper", () => {
  it("returns array directly when data is already an array", () => {
    const data = [{ name: "a" }, { name: "b" }];
    const result = extractArrayFromWrapper(data);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, "a");
  });

  it("extracts array from known key 'contexts'", () => {
    const data = {
      contexts: [
        { name: "auth", type: "core", description: "Authentication" },
        { name: "orders", type: "core", description: "Order management" },
      ],
    };
    const result = extractArrayFromWrapper(data);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, "auth");
  });

  it("extracts array from known key 'data'", () => {
    const data = { data: [{ name: "x" }] };
    const result = extractArrayFromWrapper(data);
    assert.strictEqual(result.length, 1);
  });

  it("extracts array from first array value when no known key matches", () => {
    const data = { items: [{ name: "a" }], count: 1 };
    const result = extractArrayFromWrapper(data);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "a");
  });

  it("returns empty array for non-object non-array input", () => {
    assert.strictEqual(extractArrayFromWrapper("hello").length, 0);
    assert.strictEqual(extractArrayFromWrapper(42).length, 0);
    assert.strictEqual(extractArrayFromWrapper(null).length, 0);
  });

  it("returns empty array when object has no array values", () => {
    const data = { name: "test", count: 5 };
    assert.strictEqual(extractArrayFromWrapper(data).length, 0);
  });

  it("respects custom known keys", () => {
    const data = { myCustomKey: [{ id: 1 }] };
    const result = extractArrayFromWrapper(data, ["myCustomKey"]);
    assert.strictEqual(result.length, 1);
  });
});

describe("extractObjectFromWrapper", () => {
  it("returns object directly when data is a non-array object", () => {
    const data = { in: [], out: [] };
    const result = extractObjectFromWrapper(data);
    assert.ok(result);
    assert.ok("in" in result);
    assert.ok("out" in result);
  });

  it("extracts object from wrapper with known key 'ports'", () => {
    const data = { ports: { in: [], out: [] } };
    const result = extractObjectFromWrapper(data, ["ports"]);
    assert.ok(result);
    assert.ok("in" in result);
    assert.ok("out" in result);
  });

  it("extracts object from single-element array", () => {
    const data = [{ in: [], out: [] }];
    const result = extractObjectFromWrapper(data);
    assert.ok(result);
    assert.ok("in" in result);
  });

  it("returns null for empty array", () => {
    const result = extractObjectFromWrapper([]);
    assert.strictEqual(result, null);
  });

  it("returns null for primitive input", () => {
    assert.strictEqual(extractObjectFromWrapper("hello"), null);
    assert.strictEqual(extractObjectFromWrapper(42), null);
    assert.strictEqual(extractObjectFromWrapper(null), null);
  });
});
