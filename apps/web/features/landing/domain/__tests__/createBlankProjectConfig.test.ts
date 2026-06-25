import { test } from "vitest";
import assert from "node:assert";

import { createBlankProjectConfig } from "../createBlankProjectConfig";

test("seeds workspaceName with the slugified project name", () => {
  const config = createBlankProjectConfig("Acme Shop");
  assert.strictEqual(config.governance.workspaceName, "acme-shop");
});

test("normalizes punctuation and casing into a clean slug", () => {
  const config = createBlankProjectConfig("My App!!! 123");
  assert.strictEqual(config.governance.workspaceName, "my-app-123");
});

test("falls back to deriveWorkspaceName's default for an empty name", () => {
  // Relies on deriveWorkspaceName returning "generated-project" when the input
  // produces no usable slug — a behaviour contract this builder depends on.
  const config = createBlankProjectConfig("   ");
  assert.strictEqual(config.governance.workspaceName, "generated-project");
});

test("derives the namespace prefix from the project name", () => {
  const config = createBlankProjectConfig("Acme Shop");
  assert.strictEqual(config.governance.namespacePrefix, "@acme-shop");
});

test("namespace prefix falls back with the slug for an empty name", () => {
  const config = createBlankProjectConfig("   ");
  assert.strictEqual(config.governance.namespacePrefix, "@generated-project");
});

test("produces the ADR-0041 single Next.js app preset", () => {
  const config = createBlankProjectConfig("Acme Shop");
  assert.strictEqual(config.boundedContexts.length, 1);
  assert.strictEqual(config.boundedContexts[0].name, "core");
  assert.strictEqual(config.boundedContexts[0].uiFramework, "Next.js");
  assert.strictEqual(config.boundedContexts[0].infrastructureTarget, "nitro");
});

test("gives each call a fresh bounded-context id", () => {
  const a = createBlankProjectConfig("Acme Shop");
  const b = createBlankProjectConfig("Acme Shop");
  assert.notStrictEqual(a.boundedContexts[0].id, b.boundedContexts[0].id);
});
