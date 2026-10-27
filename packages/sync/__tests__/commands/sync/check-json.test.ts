import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildSyncCheckJson,
  SYNC_CHECK_JSON_SCHEMA_VERSION,
  type SyncCheckJson,
} from "../../../src/commands/sync/check-json.js";
import type { SyncRunSummary } from "../../../src/results.js";

const DOCUMENTED_KEY_ORDER = [
  "schemaVersion",
  "command",
  "status",
  "exitCode",
  "pending",
  "errors",
  "manifestMissing",
  "reason",
] as const;

function makeSummary(overrides: Partial<SyncRunSummary> = {}): SyncRunSummary {
  return {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    skipped: 0,
    totalOps: 0,
    errors: 0,
    manifestMissing: false,
    durationMs: 0,
    ...overrides,
  };
}

describe("buildSyncCheckJson", () => {
  it("a zero summary converges with exitCode 0 and the documented envelope", () => {
    const json = buildSyncCheckJson(makeSummary(), undefined);
    assert.equal(json.schemaVersion, SYNC_CHECK_JSON_SCHEMA_VERSION);
    assert.equal(json.command, "sync --check");
    assert.equal(json.status, "converged");
    assert.equal(json.exitCode, 0);
    assert.deepEqual(json.pending, {
      created: 0,
      updated: 0,
      deleted: 0,
      total: 0,
    });
    assert.equal(json.errors, 0);
    assert.equal(json.manifestMissing, false);
    assert.equal(json.reason, null);
  });

  it("totalOps > 0 reports drift with the planned ops", () => {
    const json = buildSyncCheckJson(
      makeSummary({ created: 2, updated: 1, totalOps: 3 }),
      undefined,
    );
    assert.equal(json.status, "drift");
    assert.equal(json.exitCode, 1);
    assert.deepEqual(json.pending, {
      created: 2,
      updated: 1,
      deleted: 0,
      total: 3,
    });
    assert.equal(json.reason, null);
  });

  it("generator failures are could-not-run but still report counts", () => {
    const json = buildSyncCheckJson(
      makeSummary({ errors: 1, created: 2, totalOps: 2 }),
      undefined,
    );
    assert.equal(json.status, "could-not-run");
    assert.equal(json.exitCode, 1);
    assert.ok(json.reason?.includes("1 generator failure"));
    assert.deepEqual(json.pending, {
      created: 2,
      updated: 0,
      deleted: 0,
      total: 2,
    });
    assert.equal(json.errors, 1);
  });

  it("a missing manifest is could-not-run with the named reason", () => {
    const json = buildSyncCheckJson(
      makeSummary({ manifestMissing: true }),
      undefined,
    );
    assert.equal(json.status, "could-not-run");
    assert.equal(json.reason, "manifest not found");
    assert.equal(json.manifestMissing, true);
  });

  it("manifestMissing beats generator failures in precedence", () => {
    const json = buildSyncCheckJson(
      makeSummary({ manifestMissing: true, errors: 2 }),
      undefined,
    );
    assert.equal(json.status, "could-not-run");
    assert.equal(json.reason, "manifest not found");
  });

  it("a fatal error is could-not-run with every summary field null", () => {
    const message = "Dirty git tree — commit or stash first";
    const json = buildSyncCheckJson(undefined, message);
    assert.equal(json.status, "could-not-run");
    assert.equal(json.exitCode, 1);
    assert.equal(json.pending, null);
    assert.equal(json.errors, null);
    assert.equal(json.manifestMissing, null);
    assert.equal(json.reason, message);
  });

  it("both arguments undefined is a could-not-run with the fallback reason", () => {
    const json = buildSyncCheckJson(undefined, undefined);
    assert.equal(json.status, "could-not-run");
    assert.equal(json.exitCode, 1);
    assert.equal(json.reason, "sync produced no summary");
  });

  it("every result has the documented 8-key order", () => {
    const results: SyncCheckJson[] = [
      buildSyncCheckJson(makeSummary(), undefined),
      buildSyncCheckJson(makeSummary({ created: 1, totalOps: 1 }), undefined),
      buildSyncCheckJson(makeSummary({ errors: 1, totalOps: 1 }), undefined),
      buildSyncCheckJson(makeSummary({ manifestMissing: true }), undefined),
      buildSyncCheckJson(undefined, "boom"),
      buildSyncCheckJson(undefined, undefined),
    ];
    for (const result of results) {
      assert.deepEqual(Object.keys(result), DOCUMENTED_KEY_ORDER);
    }
  });
});
