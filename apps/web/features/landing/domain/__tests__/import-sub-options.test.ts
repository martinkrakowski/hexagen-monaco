import test from "node:test";
import assert from "node:assert/strict";
import {
  IMPORT_SUB_OPTIONS,
  type ImportSubOptionId,
} from "../creation-path.js";

test("IMPORT_SUB_OPTIONS has 3 entries", () => {
  assert.equal(IMPORT_SUB_OPTIONS.length, 3);
});

test("IDs are 'manifest', 'spec', 'github'", () => {
  const ids = IMPORT_SUB_OPTIONS.map((o) => o.id);
  assert.deepEqual(ids, ["manifest", "spec", "github"]);
});

test("manifest is available", () => {
  const manifest = IMPORT_SUB_OPTIONS.find((o) => o.id === "manifest");
  assert.ok(manifest);
  assert.equal(manifest.status, "available");
});

test("spec is available", () => {
  const spec = IMPORT_SUB_OPTIONS.find((o) => o.id === "spec");
  assert.ok(spec);
  assert.equal(spec.status, "available");
});

test("github is not available (coming soon)", () => {
  const github = IMPORT_SUB_OPTIONS.find((o) => o.id === "github");
  assert.ok(github);
  assert.equal(github.status, "coming-soon");
});

test("each option has non-empty label, description, iconName, and href", () => {
  for (const option of IMPORT_SUB_OPTIONS) {
    assert.ok(option.label.length > 0, `label empty for ${option.id}`);
    assert.ok(
      option.description.length > 0,
      `description empty for ${option.id}`,
    );
    assert.ok(option.iconName.length > 0, `iconName empty for ${option.id}`);
    assert.ok(option.href.length > 0, `href empty for ${option.id}`);
  }
});

test("manifest href is '/projects/new/import/manifest'", () => {
  const manifest = IMPORT_SUB_OPTIONS.find((o) => o.id === "manifest");
  assert.ok(manifest);
  assert.equal(manifest.href, "/projects/new/import/manifest");
});

test("spec href is '/projects/new/import/spec'", () => {
  const spec = IMPORT_SUB_OPTIONS.find((o) => o.id === "spec");
  assert.ok(spec);
  assert.equal(spec.href, "/projects/new/import/spec");
});

test("github href is '/projects/new/import/github'", () => {
  const github = IMPORT_SUB_OPTIONS.find((o) => o.id === "github");
  assert.ok(github);
  assert.equal(github.href, "/projects/new/import/github");
});

test("ImportSubOptionId type allows the three values (compile-time check)", () => {
  const ids: ImportSubOptionId[] = ["manifest", "spec", "github"];
  assert.equal(ids.length, 3);
});
