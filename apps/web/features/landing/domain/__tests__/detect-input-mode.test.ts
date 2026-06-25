import { test } from "vitest";
import assert from "node:assert/strict";
import { detectInputMode } from "../creation-path.js";

test("empty string → unknown", () => {
  assert.equal(detectInputMode(""), "unknown");
});

test("plain English → unknown", () => {
  const content = "This is a project description for an e-commerce system";
  assert.equal(detectInputMode(content), "unknown");
});

test("valid structured config JSON with all required keys → structured-config", () => {
  const content = JSON.stringify({
    bounded_contexts: [{ id: "ctx1", name: "Payment Context" }],
    use_cases: [{ id: "uc1", name: "Process Payment", context_id: "ctx1" }],
    context_mappings: [
      {
        source_context_id: "ctx1",
        target_context_id: "ctx2",
        mapping_type: "upstream-downstream",
      },
    ],
  });
  assert.equal(detectInputMode(content), "structured-config");
});

test("valid YAML with all three required keys → manifest (YAML detected as manifest)", () => {
  const content = `
bounded_contexts:
- id: ctx1
  name: Payment Context
use_cases:
- id: uc1
  name: Process Payment
  context_id: ctx1
context_mappings:
- source_context_id: ctx1
  target_context_id: ctx2
  mapping_type: upstream-downstream
`;
  assert.equal(detectInputMode(content), "manifest");
});

test("JSON missing required keys → structured-config (valid JSON)", () => {
  const content = JSON.stringify({
    bounded_contexts: [],
  });
  assert.equal(detectInputMode(content), "structured-config");
});

test("YAML missing required keys → manifest (YAML detected as manifest)", () => {
  const content = `
bounded_contexts:
- id: ctx1
`;
  assert.equal(detectInputMode(content), "manifest");
});

test("malformed JSON → unknown", () => {
  const content = "{ invalid json }";
  assert.equal(detectInputMode(content), "unknown");
});

test("JSON array (not object) → structured-config (valid JSON)", () => {
  const content = JSON.stringify([1, 2, 3]);
  assert.equal(detectInputMode(content), "structured-config");
});
