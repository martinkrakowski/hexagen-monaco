import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { detectInputMode } from "../detect-input-mode.js";
import fs from "node:fs";
import path from "node:path";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../..",
  "packages/agentic-interaction/src/application/use-cases/staged-generation/__tests__/fixtures",
);
const yamlPath = path.join(fixturesDir, "krakowski-portal.yaml");

test('detectInputMode("") returns "description"', () => {
  assert.strictEqual(detectInputMode(""), "description");
});

test('detectInputMode("Build a SaaS app") returns "description"', () => {
  assert.strictEqual(detectInputMode("Build a SaaS app"), "description");
});

test('detectInputMode(krakowskiYaml) returns "structured-config"', () => {
  const yaml = fs.readFileSync(yamlPath, "utf-8");
  assert.strictEqual(detectInputMode(yaml), "structured-config");
});

test('detectInputMode("bounded_contexts: []") returns "description" (empty array)', () => {
  assert.strictEqual(detectInputMode("bounded_contexts: []"), "description");
});

test('detectInputMode("{{ invalid }}") returns "description" (no throw)', () => {
  assert.strictEqual(detectInputMode("{{ invalid }}"), "description");
});
