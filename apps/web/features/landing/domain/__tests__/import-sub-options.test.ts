import { test } from "vitest";
import assert from "node:assert/strict";
import {
  IMPORT_SUB_OPTIONS,
  type ImportSubOptionId,
} from "../creation-path.js";

// The previously-separate "manifest" and "spec" options are consolidated into a
// single "Import Manifest or Spec" option (the importer auto-detects which on
// upload); zip scan is available; the Tier-A scan-artifact upload became
// available in BF-3.3, which mounted /projects/new/import/artifacts; GitHub is
// still coming-soon until BF-5.3 mounts its repo-entry screen.

test("IMPORT_SUB_OPTIONS has 4 entries (unified import + scan + artifacts + github)", () => {
  assert.equal(IMPORT_SUB_OPTIONS.length, 4);
});

test("IDs are 'spec', 'scan', 'artifacts', and 'github'", () => {
  const ids = IMPORT_SUB_OPTIONS.map((o) => o.id);
  assert.deepEqual(ids, ["spec", "scan", "artifacts", "github"]);
});

test("the unified import option ('spec') is available", () => {
  const spec = IMPORT_SUB_OPTIONS.find((o) => o.id === "spec");
  assert.ok(spec);
  assert.equal(spec.status, "available");
});

test("scan is available", () => {
  const scan = IMPORT_SUB_OPTIONS.find((o) => o.id === "scan");
  assert.ok(scan);
  assert.equal(scan.status, "available");
});

test("the Tier-A artifacts option is available now that BF-3.3 mounted its route", () => {
  const artifacts = IMPORT_SUB_OPTIONS.find((o) => o.id === "artifacts");
  assert.ok(artifacts);
  assert.equal(artifacts.status, "available");
  assert.equal(artifacts.href, "/projects/new/name?path=artifacts");
});

// Flipped by BF-5.3, which mounted /projects/new/import/github over the
// bounded clone route.
//
// Note this file duplicates assertions that also live in
// ../creation-path.test.ts, which carries the real ratchet pair (routed =>
// available AND unrouted => coming-soon, so neither half can move alone).
// This copy asserts only one direction, so it cannot catch a status flipped
// ahead of its route -- it just has to be kept in step. Consolidating the two
// is worth doing, but not inside the packet that flips the value.
test("github is available and routes to the scan screen", () => {
  const github = IMPORT_SUB_OPTIONS.find((o) => o.id === "github");
  assert.ok(github);
  assert.equal(github.status, "available");
  assert.equal(github.href, "/projects/new/import/github");
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

test("scan option routes through the Project Name step", () => {
  const scan = IMPORT_SUB_OPTIONS.find((o) => o.id === "scan");
  assert.ok(scan);
  assert.equal(scan.href, "/projects/new/name?path=scan");
});

test("github href is '/projects/new/import/github'", () => {
  const github = IMPORT_SUB_OPTIONS.find((o) => o.id === "github");
  assert.ok(github);
  assert.equal(github.href, "/projects/new/import/github");
});

test("ImportSubOptionId type allows the four values (compile-time check)", () => {
  const ids: ImportSubOptionId[] = ["spec", "scan", "artifacts", "github"];
  assert.equal(ids.length, 4);
});
