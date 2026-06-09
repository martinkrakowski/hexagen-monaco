import { test } from "node:test";
import assert from "node:assert";
import yaml from "js-yaml";

import { setManifestIdentity } from "../manifestIdentity";

test("rewrites the top-level system field", () => {
  const input =
    "system: old-name\nscope: '@hexagen'\narchitecture: hexagonal\n";
  const out = setManifestIdentity(input, { system: "acme-shop" });
  const parsed = yaml.load(out) as Record<string, unknown>;
  assert.strictEqual(parsed.system, "acme-shop");
});

test("rewrites the top-level scope when provided", () => {
  const input =
    "system: old-name\nscope: '@hexagen'\narchitecture: hexagonal\n";
  const parsed = yaml.load(
    setManifestIdentity(input, { system: "acme-shop", scope: "@acme-shop" }),
  ) as Record<string, unknown>;
  assert.strictEqual(parsed.system, "acme-shop");
  assert.strictEqual(parsed.scope, "@acme-shop");
});

test("leaves scope untouched when not provided", () => {
  const input = "system: old-name\nscope: '@acme'\narchitecture: hexagonal\n";
  const parsed = yaml.load(
    setManifestIdentity(input, { system: "acme-shop" }),
  ) as Record<string, unknown>;
  assert.strictEqual(parsed.scope, "@acme");
});

test("preserves other top-level fields", () => {
  const input = "system: old-name\nscope: '@acme'\narchitecture: hexagonal\n";
  const parsed = yaml.load(
    setManifestIdentity(input, { system: "acme-shop", scope: "@acme-shop" }),
  ) as Record<string, unknown>;
  assert.strictEqual(parsed.architecture, "hexagonal");
});

test("adds system when the manifest has none", () => {
  const parsed = yaml.load(
    setManifestIdentity("scope: '@acme'\n", { system: "acme-shop" }),
  ) as Record<string, unknown>;
  assert.strictEqual(parsed.system, "acme-shop");
});

test("adds scope when the manifest has none", () => {
  const parsed = yaml.load(
    setManifestIdentity("system: old-name\n", {
      system: "acme-shop",
      scope: "@acme-shop",
    }),
  ) as Record<string, unknown>;
  assert.strictEqual(parsed.scope, "@acme-shop");
});

test("returns the input unchanged when it is not a YAML object", () => {
  // A YAML scalar/array has no identity fields to set — leave it untouched
  // rather than coercing it into an object.
  assert.strictEqual(
    setManifestIdentity("- a\n- b\n", { system: "x" }),
    "- a\n- b\n",
  );
  assert.strictEqual(
    setManifestIdentity("just a string", { system: "x" }),
    "just a string",
  );
});
