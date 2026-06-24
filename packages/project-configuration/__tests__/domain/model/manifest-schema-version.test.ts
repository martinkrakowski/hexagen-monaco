/**
 * ManifestSchemaVersion value object (PR-C1, RCA #6).
 *
 * The semantics under pin: ABSENT = legacy and fully supported; any present
 * stamp must be a positive integer; anything ≤ CURRENT passes; anything newer
 * refuses with guidance (naming the package and `hexagen manifest migrate`)
 * instead of letting the strict schemas misdiagnose "too new" as "malformed".
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  CURRENT_MANIFEST_SCHEMA_VERSION,
  readManifestSchemaVersion,
  assertSupportedSchemaVersion,
} from "../../../src/domain/model/manifest-schema/manifest-schema-version.js";

describe("readManifestSchemaVersion", () => {
  it("returns undefined for a legacy manifest (no key) and for non-object roots", () => {
    assert.strictEqual(readManifestSchemaVersion({ system: "x" }), undefined);
    assert.strictEqual(readManifestSchemaVersion(null), undefined);
    assert.strictEqual(readManifestSchemaVersion("a plain string"), undefined);
  });

  it("returns a valid stamp", () => {
    assert.strictEqual(readManifestSchemaVersion({ schemaVersion: 1 }), 1);
  });

  it("rejects every non-positive-integer stamp — there is no fallback for a corrupted version", () => {
    for (const bad of ["1", 1.5, 0, -1, null, true, [1]]) {
      assert.throws(
        () => readManifestSchemaVersion({ schemaVersion: bad }),
        /expected a positive integer/,
        `schemaVersion ${JSON.stringify(bad)} must be rejected`,
      );
    }
  });
});

describe("assertSupportedSchemaVersion", () => {
  it("passes legacy (absent) and every version up to CURRENT", () => {
    assertSupportedSchemaVersion({ system: "legacy" });
    assertSupportedSchemaVersion({
      schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,
    });
  });

  it("refuses a newer version with guidance: names the package and the migrate command", () => {
    assert.throws(
      () =>
        assertSupportedSchemaVersion({
          schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION + 1,
        }),
      (err: Error) => {
        assert.match(err.message, /newer than this toolchain supports/);
        assert.match(err.message, /@hexagen-monaco\/sync/);
        assert.match(err.message, /hexagen manifest migrate/);
        return true;
      },
    );
  });
});
