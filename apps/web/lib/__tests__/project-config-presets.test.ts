import { test } from "vitest";
import assert from "node:assert";

import {
  createDefaultProjectConfig,
  emptyFormValues,
} from "../project-config-presets";

test("seeds workspaceName with the slugified project name", () => {
  const config = createDefaultProjectConfig("Acme Shop");
  assert.strictEqual(config.governance.workspaceName, "acme-shop");
});

test("normalizes punctuation and casing into a clean slug", () => {
  const config = createDefaultProjectConfig("My App!!! 123");
  assert.strictEqual(config.governance.workspaceName, "my-app-123");
});

test("falls back to deriveWorkspaceName's default for an empty name", () => {
  // Relies on deriveWorkspaceName returning "generated-project" when the input
  // produces no usable slug — a behaviour contract this builder depends on.
  const config = createDefaultProjectConfig("   ");
  assert.strictEqual(config.governance.workspaceName, "generated-project");
});

test("derives the namespace prefix from the project name", () => {
  const config = createDefaultProjectConfig("Acme Shop");
  assert.strictEqual(config.governance.namespacePrefix, "@acme-shop");
});

test("namespace prefix falls back with the slug for an empty name", () => {
  const config = createDefaultProjectConfig("   ");
  assert.strictEqual(config.governance.namespacePrefix, "@generated-project");
});

test("produces the ADR-0041 single Next.js app preset", () => {
  const config = createDefaultProjectConfig("Acme Shop");
  assert.strictEqual(config.boundedContexts.length, 1);
  assert.strictEqual(config.boundedContexts[0].name, "core");
  assert.strictEqual(config.boundedContexts[0].uiFramework, "Next.js");
  assert.strictEqual(config.boundedContexts[0].infrastructureTarget, "nitro");
});

test("gives each call a fresh bounded-context id", () => {
  const a = createDefaultProjectConfig("Acme Shop");
  const b = createDefaultProjectConfig("Acme Shop");
  assert.notStrictEqual(a.boundedContexts[0].id, b.boundedContexts[0].id);
});

test("omitting the project name yields the wizard's @hexagen placeholder", () => {
  // The unnamed branch is what `emptyFormValues` is built from; it must keep
  // the wizard's historical placeholder identity, NOT a derived slug.
  const config = createDefaultProjectConfig();
  assert.strictEqual(config.governance.workspaceName, "@hexagen");
  assert.strictEqual(config.governance.namespacePrefix, "@hexagen");
});

test("emptyFormValues is a module-load singleton with a STABLE context id", () => {
  // Load-bearing, not incidental: readers spread `emptyFormValues` and then
  // cross-reference `boundedContexts[0].id` (peer mappings), and the genesis
  // store `structuredClone`s it per re-seed. A per-read factory call would
  // hand each of those a different id. See the export's JSDoc.
  assert.strictEqual(
    emptyFormValues.boundedContexts[0].id,
    emptyFormValues.boundedContexts[0].id,
  );
  assert.notStrictEqual(
    emptyFormValues.boundedContexts[0].id,
    createDefaultProjectConfig().boundedContexts[0].id,
  );
  assert.strictEqual(emptyFormValues.governance.workspaceName, "@hexagen");
});
