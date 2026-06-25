/**
 * MigrateManifestUseCase contract (Wave-C PR-C1, RCA #6).
 *
 * The two properties that make `hexagen manifest migrate` trustworthy on
 * hand-maintained manifests:
 *  1. COMMENT PRESERVATION — the pipeline is text→text; stamping is a textual
 *     insert/replace, so the split header and per-key annotations survive
 *     byte-for-byte (a parse→dump round-trip would silently destroy them).
 *  2. THE STAMP-ONLY INVARIANT — after stamping, the re-parsed result must be
 *     the input plus exactly `schemaVersion`; anything else (pathological
 *     layouts the line-anchored edit can't handle) refuses instead of writing
 *     a corrupted manifest.
 *
 * The registry is EMPTY at schema version 1, so the walk and the
 * replace-stamp arms are pinned via the constructor-injected
 * currentVersion/migrations test seam (production callers use the defaults).
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import {
  MigrateManifestUseCase,
  MANIFEST_MIGRATIONS,
} from "../../src/application/use-cases/migrate-manifest.use-case.js";
import { CURRENT_MANIFEST_SCHEMA_VERSION } from "@hexagen/project-configuration";

const HEADER = [
  "# manifest.yaml",
  "# ─────────────────────────────────────",
  "# AGENT ENTRY POINT — hand-written notes",
  "# ─────────────────────────────────────",
].join("\n");

const LEGACY_DOC = [
  HEADER,
  "version: '2.0'",
  "description: a legacy manifest # inline annotation",
  "system: my-system",
  "bounded_contexts:",
  "  - name: billing",
  "    type: core",
  "",
].join("\n");

describe("MigrateManifestUseCase (production defaults)", () => {
  it("the registry is empty at schema version 1 — the pattern is the deliverable", () => {
    assert.strictEqual(MANIFEST_MIGRATIONS.length, 0);
  });

  it("stamps a legacy manifest above the first content line, preserving every comment", () => {
    const result = new MigrateManifestUseCase().execute(LEGACY_DOC);

    assert.strictEqual(result.fromVersion, undefined);
    assert.strictEqual(result.toVersion, CURRENT_MANIFEST_SCHEMA_VERSION);
    assert.deepStrictEqual(result.applied, []);
    assert.strictEqual(result.changed, true);
    assert.ok(
      result.content.startsWith(
        HEADER + `\nschemaVersion: ${CURRENT_MANIFEST_SCHEMA_VERSION}\n`,
      ),
      "the stamp lands below the header block, above the first key",
    );
    assert.ok(
      result.content.includes("# inline annotation"),
      "inline comments survive",
    );
  });

  it("is idempotent: migrating the migrated text changes nothing, byte-for-byte", () => {
    const once = new MigrateManifestUseCase().execute(LEGACY_DOC);
    const twice = new MigrateManifestUseCase().execute(once.content);

    assert.strictEqual(twice.changed, false);
    assert.strictEqual(twice.content, once.content);
    assert.strictEqual(twice.fromVersion, CURRENT_MANIFEST_SCHEMA_VERSION);
    assert.deepStrictEqual(twice.applied, []);
  });

  it("handles a document-start marker: the stamp goes after `---`, before the first key", () => {
    const doc = ["---", "# leading comment", "system: x", ""].join("\n");
    const result = new MigrateManifestUseCase().execute(doc);
    assert.strictEqual(
      result.content,
      [
        "---",
        "# leading comment",
        `schemaVersion: ${CURRENT_MANIFEST_SCHEMA_VERSION}`,
        "system: x",
        "",
      ].join("\n"),
    );
  });

  it("refuses a manifest from a newer toolchain — migration only goes forward", () => {
    const doc = `schemaVersion: ${CURRENT_MANIFEST_SCHEMA_VERSION + 1}\nsystem: x\n`;
    assert.throws(
      () => new MigrateManifestUseCase().execute(doc),
      (err: Error) => {
        assert.match(err.message, /newer than this toolchain supports/);
        assert.match(err.message, /Migration only goes forward/);
        return true;
      },
    );
  });

  it("rejects a corrupted stamp, an empty document, and a non-mapping root", () => {
    assert.throws(
      () => new MigrateManifestUseCase().execute('schemaVersion: "two"\n'),
      /expected a positive integer/,
    );
    assert.throws(
      () => new MigrateManifestUseCase().execute("# only comments\n"),
      /Manifest file is empty/,
    );
    assert.throws(
      () => new MigrateManifestUseCase().execute("- just\n- a\n- list\n"),
      /must be a YAML mapping/,
    );
  });

  it("refuses (guided, no parser stack) when the textual stamp cannot land cleanly — flow-style root", () => {
    assert.throws(
      () => new MigrateManifestUseCase().execute("{system: x, version: y}\n"),
      /Could not stamp schemaVersion .* by hand/s,
    );
  });
});

describe("MigrateManifestUseCase (injected registry — the walk and re-stamp arms)", () => {
  // A future toolchain at schema 3 with two registered key migrations,
  // deliberately registered out of order to pin the ascending sort.
  const v3 = new MigrateManifestUseCase(3, [
    {
      toVersion: 3,
      description: "rename colour → color",
      apply: (c) => c.replace(/^colour:/m, "color:"),
    },
    {
      toVersion: 2,
      description: "rename workspace_template → workspaceTemplate",
      apply: (c) => c.replace(/^workspace_template:/m, "workspaceTemplate:"),
    },
  ]);

  it("walks a legacy manifest through every step ascending, then stamps the target version", () => {
    const doc = [
      "# keep me",
      "workspace_template: strict-enterprise",
      "colour: red",
      "",
    ].join("\n");

    const result = v3.execute(doc);
    assert.deepStrictEqual(result.applied, [
      "v2: rename workspace_template → workspaceTemplate",
      "v3: rename colour → color",
    ]);
    assert.strictEqual(
      result.content,
      [
        "# keep me",
        "schemaVersion: 3",
        "workspaceTemplate: strict-enterprise",
        "color: red",
        "",
      ].join("\n"),
    );
  });

  it("starts the walk past the stamped version and REPLACES the stamp line in place", () => {
    // Already at 2: only the v3 step may run, and the existing stamp line is
    // rewritten where it stands (no second schemaVersion line).
    const doc = [
      "schemaVersion: 2 # stamped by an older run",
      "workspace_template: untouched-because-v2-already-ran",
      "colour: red",
      "",
    ].join("\n");

    const result = v3.execute(doc);
    assert.strictEqual(result.fromVersion, 2);
    assert.deepStrictEqual(result.applied, ["v3: rename colour → color"]);
    assert.strictEqual(
      result.content,
      [
        "schemaVersion: 3",
        "workspace_template: untouched-because-v2-already-ran",
        "color: red",
        "",
      ].join("\n"),
    );
  });

  it("is idempotent at the injected version too", () => {
    const once = v3.execute("colour: red\nworkspace_template: x\n");
    const twice = v3.execute(once.content);
    assert.strictEqual(twice.changed, false);
    assert.strictEqual(twice.content, once.content);
  });
});
