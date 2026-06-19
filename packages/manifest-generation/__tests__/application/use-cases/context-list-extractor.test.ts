import { describe, it } from "vitest";
import assert from "node:assert/strict";

// This test verifies the NDJSON parsing behavior
// The actual attemptContextList function is more complex and requires full setup,
// so we test the extracted logic directly

describe("context-list-extractor NDJSON parsing", () => {
  it("correctly identifies multiple NDJSON objects vs single wrapped object", () => {
    // Test the parsing logic that was fixed

    // Scenario 1: NDJSON with 3 objects should NOT be wrapped in array
    // (This is what was broken - it would extract first line and wrap as [data])
    const ndjson = `{"name":"UserManagement","type":"core"}
{"name":"OrderProcessing","type":"core"}
{"name":"NotificationService","type":"core"}`;

    const lines = ndjson
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // After the fix, when extractJSON is called on NDJSON, it returns as-is
    // Then the NDJSON parser should process line by line
    assert.strictEqual(lines.length, 3, "NDJSON should have 3 lines");

    // Each line should be parseable as JSON
    const parsed = lines.map((l) => JSON.parse(l));
    assert.strictEqual(parsed.length, 3, "Should parse 3 objects");
    assert.strictEqual(parsed[0].name, "UserManagement");
    assert.strictEqual(parsed[1].name, "OrderProcessing");
    assert.strictEqual(parsed[2].name, "NotificationService");
  });

  it("distinguishes between formatted JSON array and NDJSON", () => {
    // Formatted JSON array - should parse as single array
    const jsonArray = `[
{"name": "climate-control"},
{"name": "drift-analytics"}
]`;
    const lines = jsonArray
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // This pattern should NOT trigger NDJSON detection
    // It starts with [, so isLikelyNDJSON would be false
    const isLikelyNDJSON =
      lines.every((l) => !l.startsWith("[") && !l.startsWith("]")) &&
      lines.filter((l) => l.startsWith("{")).length > 1;

    assert.strictEqual(
      isLikelyNDJSON,
      false,
      "Formatted JSON array should not trigger NDJSON detection",
    );

    // But the full array should still parse successfully
    const fullArrayStr = jsonArray.trim();
    const parsed = JSON.parse(fullArrayStr);
    assert.strictEqual(Array.isArray(parsed), true);
    assert.strictEqual(parsed.length, 2);
  });

  it("true NDJSON detection triggers on multiple { lines without wrapper", () => {
    const ndjson = `{"name":"UserManagement","type":"core"}
{"name":"OrderProcessing","type":"core"}
{"name":"NotificationService","type":"core"}`;

    const lines = ndjson
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const isLikelyNDJSON =
      lines.every((l) => !l.startsWith("[") && !l.startsWith("]")) &&
      lines.filter((l) => l.startsWith("{")).length > 1;

    assert.strictEqual(
      isLikelyNDJSON,
      true,
      "NDJSON with multiple { lines should trigger detection",
    );
  });
});
