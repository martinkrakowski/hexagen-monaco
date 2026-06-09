import { test } from "node:test";
import assert from "node:assert";
import yaml from "js-yaml";

import { setManifestSystemName } from "../manifestSystemName";

test("rewrites the top-level system field", () => {
  const input =
    "system: old-name\nscope: '@hexagen'\narchitecture: hexagonal\n";
  const out = setManifestSystemName(input, "acme-shop");
  const parsed = yaml.load(out) as Record<string, unknown>;
  assert.strictEqual(parsed.system, "acme-shop");
});

test("preserves other top-level fields", () => {
  const input = "system: old-name\nscope: '@acme'\narchitecture: hexagonal\n";
  const parsed = yaml.load(setManifestSystemName(input, "acme-shop")) as Record<
    string,
    unknown
  >;
  assert.strictEqual(parsed.scope, "@acme");
  assert.strictEqual(parsed.architecture, "hexagonal");
});

test("adds system when the manifest has none", () => {
  const parsed = yaml.load(
    setManifestSystemName("scope: '@acme'\n", "acme-shop"),
  ) as Record<string, unknown>;
  assert.strictEqual(parsed.system, "acme-shop");
});

test("returns the input unchanged when it is not a YAML object", () => {
  // A YAML scalar/array has no `system` to set — leave it untouched rather
  // than coercing it into an object.
  assert.strictEqual(setManifestSystemName("- a\n- b\n", "x"), "- a\n- b\n");
  assert.strictEqual(
    setManifestSystemName("just a string", "x"),
    "just a string",
  );
});
