import { test } from "vitest";
import assert from "node:assert/strict";
import {
  IMPORT_SUB_OPTIONS,
  type ImportSubOptionId,
} from "../creation-path.js";

// The previously-separate "manifest" and "spec" options are consolidated into a
// single "Import Manifest or Spec" option (the importer auto-detects which on
// upload); GitHub remains a coming-soon future feature.

test("IMPORT_SUB_OPTIONS has 2 entries (unified import + github)", () => {
  assert.equal(IMPORT_SUB_OPTIONS.length, 2);
});

test("IDs are 'spec' and 'github'", () => {
  const ids = IMPORT_SUB_OPTIONS.map((o) => o.id);
  assert.deepEqual(ids, ["spec", "github"]);
});

test("the unified import option ('spec') is available", () => {
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

test("the unified import option routes through the Project Name step", () => {
  const spec = IMPORT_SUB_OPTIONS.find((o) => o.id === "spec");
  assert.ok(spec);
  assert.equal(spec.href, "/projects/new/name?path=spec");
});

test("github href is '/projects/new/import/github'", () => {
  const github = IMPORT_SUB_OPTIONS.find((o) => o.id === "github");
  assert.ok(github);
  assert.equal(github.href, "/projects/new/import/github");
});

test("ImportSubOptionId type allows the two values (compile-time check)", () => {
  const ids: ImportSubOptionId[] = ["spec", "github"];
  assert.equal(ids.length, 2);
});
