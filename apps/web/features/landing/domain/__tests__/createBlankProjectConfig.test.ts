import { test } from "node:test";
import assert from "node:assert";

import { createBlankProjectConfig } from "../createBlankProjectConfig";

test("seeds workspaceName with the slugified project name", () => {
  const config = createBlankProjectConfig("Acme Shop");
  assert.equal(config.governance.workspaceName, "acme-shop");
});

test("normalizes punctuation and casing into a clean slug", () => {
  const config = createBlankProjectConfig("My App!!! 123");
  assert.equal(config.governance.workspaceName, "my-app-123");
});

test("falls back to deriveWorkspaceName's default for an empty name", () => {
  // Relies on deriveWorkspaceName returning "generated-project" when the input
  // produces no usable slug — a behaviour contract this builder depends on.
  const config = createBlankProjectConfig("   ");
  assert.equal(config.governance.workspaceName, "generated-project");
});

test("keeps the @hexagen namespace prefix independent of the name", () => {
  const config = createBlankProjectConfig("Acme Shop");
  assert.equal(config.governance.namespacePrefix, "@hexagen");
});

test("produces the ADR-0041 single Next.js app preset", () => {
  const config = createBlankProjectConfig("Acme Shop");
  assert.equal(config.boundedContexts.length, 1);
  assert.equal(config.boundedContexts[0].name, "core");
  assert.equal(config.boundedContexts[0].uiFramework, "Next.js");
  assert.equal(config.boundedContexts[0].infrastructureTarget, "nitro");
});

test("gives each call a fresh bounded-context id", () => {
  const a = createBlankProjectConfig("Acme Shop");
  const b = createBlankProjectConfig("Acme Shop");
  assert.notEqual(a.boundedContexts[0].id, b.boundedContexts[0].id);
});
