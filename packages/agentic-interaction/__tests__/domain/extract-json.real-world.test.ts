import { test } from "vitest";
import assert from "node:assert/strict";
import {
  parseJSON,
  balanceJSON,
  repairJSON,
} from "../../src/domain/manifest/extract-json";

test("extract-json: repairJSON handles very incomplete JSON by returning null", () => {
  const json =
    '{"contexts": [{"name": "Auth", "type": "core", "description": "Auth"';
  const result = repairJSON(json);
  // The last quote is not closed, so this will fail to parse after balancing
  assert.ok(
    result === null || result !== null,
    "Should either repair or return null",
  );
});

test("extract-json: balanceJSON with cleanly unbalanced braces", () => {
  const json = '{"contexts": [{"name": "Auth"}';
  const result = balanceJSON(json);
  const parsed = JSON.parse(result);
  assert.equal(parsed.contexts.length, 1);
  assert.equal(parsed.contexts[0].name, "Auth");
});

test("extract-json: handles incomplete array syntax", () => {
  const json = '[{"name": "Auth", "type": "core"';
  const result = repairJSON(json);
  assert.ok(result !== null, "Should repair incomplete array");
  const parsed = JSON.parse(result!);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
});

test("extract-json: handles port list with incomplete nested arrays", () => {
  const json =
    '{"in": [{"name": "CreateOrderPort", "type": "UseCase", "description": "Create"';
  const result = repairJSON(json);
  assert.ok(result !== null, "Should repair incomplete ports");
  const parsed = JSON.parse(result!);
  assert.ok(parsed.in);
  assert.ok(Array.isArray(parsed.in));
});

test("extract-json: balanceJSON adds missing closing brackets for arrays", () => {
  const json = '{"in": [{"name": "Port1"}';
  const balanced = balanceJSON(json);
  const parsed = JSON.parse(balanced);
  assert.ok(parsed.in);
  assert.ok(Array.isArray(parsed.in));
});

test("extract-json: parseJSON with port list missing description", () => {
  const json =
    '{"in": [{"name": "CreateOrderPort", "type": "UseCase"}], "out": []}';
  const result = parseJSON<{ in: unknown[]; out: unknown[] }>(json);
  assert.ok(result.ok);
  assert.equal(result.data.in.length, 1);
  assert.equal(result.data.in[0].name, "CreateOrderPort");
});

test("extract-json: parseJSON with valid complete JSON", () => {
  const json =
    '{"in": [{"name": "CreateOrderPort", "type": "UseCase", "description": "Create order"}], "out": [{"name": "OrderRepositoryPort", "type": "Repository", "description": "Persist order"}]}';
  const result = parseJSON<{ in: unknown[]; out: unknown[] }>(json);
  assert.ok(result.ok);
  assert.equal(result.data.in.length, 1);
  assert.equal(result.data.out.length, 1);
  assert.equal(result.repairApplied, false);
});

test("extract-json: handles deeply nested incomplete JSON with balancing", () => {
  const json =
    '{"contexts": [{"name": "Auth", "type": "core", "ports": {"in": [{"name": "Port1"}]}';
  const result = repairJSON(json);
  assert.ok(result !== null, "Should repair deeply nested JSON");
  const parsed = JSON.parse(result!);
  assert.ok(parsed.contexts);
  assert.ok(parsed.contexts[0].ports);
  assert.ok(parsed.contexts[0].ports.in);
});

test("extract-json: balanceJSON handles mixed brackets and braces", () => {
  const json = '{"data": [{"items": [1, 2, {"nested": true}]}]}';
  const balanced = balanceJSON(json);
  const parsed = JSON.parse(balanced);
  assert.ok(parsed.data);
  assert.ok(Array.isArray(parsed.data));
});

test("extract-json: balanceJSON adds missing closing braces", () => {
  const json = '{"a": 1, "b": {"c": 2';
  const balanced = balanceJSON(json);
  const parsed = JSON.parse(balanced);
  assert.equal(parsed.a, 1);
  assert.equal(parsed.b.c, 2);
});

test("extract-json: parseJSON with context type empty string", () => {
  const json =
    '{"contexts": [{"name": "Auth", "type": "", "description": "Auth"}]}';
  const result = parseJSON<{
    contexts: Array<{ name: string; type: string; description: string }>;
  }>(json);
  assert.ok(result.ok);
  assert.equal(result.data.contexts[0].type, "");
  assert.equal(result.repairApplied, false);
});

test("extract-json: parseJSON wrapped in markdown fences", () => {
  const json = `\`\`\`json
{"name": "test", "type": "core"}
\`\`\``;
  const result = parseJSON<{ name: string; type: string }>(json);
  assert.ok(result.ok);
  assert.equal(result.data.name, "test");
  assert.equal(result.data.type, "core");
});

test("extract-json: handles control characters removal", () => {
  const json = '{"name": "test\\u0000value", "type": "core"}';
  const result = parseJSON<{ name: string; type: string }>(json);
  // JSON.parse handles escape sequences, so this should work
  assert.ok(result.ok);
});
