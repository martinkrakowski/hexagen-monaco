import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { detectInputMode } from "../detect-input-mode.js";
import fs from "node:fs";
import path from "node:path";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../..",
  "packages/agentic-interaction/__tests__/use-cases/staged-generation/fixtures",
);
const yamlPath = path.join(fixturesDir, "krakowski-portal.yaml");
const looseMdPath = path.join(fixturesDir, "krakowski-portal-loose.md");

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

test('detectInputMode(looseMd) returns "semi-structured"', () => {
  const looseMd = fs.readFileSync(looseMdPath, "utf-8");
  assert.strictEqual(detectInputMode(looseMd), "semi-structured");
});

test('detectInputMode("This app has aggregates") returns "description" (1 hint)', () => {
  assert.strictEqual(detectInputMode("This app has aggregates"), "description");
});

test('detectInputMode("# Bounded Contexts\\n- aggregates: Foo") returns "semi-structured" (2 hints)', () => {
  assert.strictEqual(
    detectInputMode("# Bounded Contexts\n- aggregates: Foo"),
    "semi-structured",
  );
});
