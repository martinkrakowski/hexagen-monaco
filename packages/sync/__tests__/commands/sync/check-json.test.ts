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
  "timingsMs",
  "files",
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

function checkWithSummary(
  overrides: Partial<SyncRunSummary> = {},
): SyncCheckJson {
  return buildSyncCheckJson(makeSummary(overrides), undefined);
}

function makePhases(
  gitStatus: number | null,
  preflight: number | null,
  generators: number,
  linter: number | null,
) {
  return { gitStatus, preflight, generators, linter };
}

function checkWithTimings(
  durationMs: number,
  phaseTimings: ReturnType<typeof makePhases>,
  extra: Partial<SyncRunSummary> = {},
): SyncCheckJson {
  return checkWithSummary({
    durationMs,
    phaseTimingsMs: phaseTimings,
    ...extra,
  });
}

function assertPendingCounts(
  json: SyncCheckJson,
  created: number,
  updated: number,
  deleted: number,
  total: number,
): void {
  assert.deepEqual(json.pending, {
    created,
    updated,
    deleted,
    total,
  });
}

describe("buildSyncCheckJson", () => {
  it("a zero summary converges with exitCode 0 and the documented envelope", () => {
    const json = checkWithSummary();
    assert.equal(json.schemaVersion, SYNC_CHECK_JSON_SCHEMA_VERSION);
    assert.equal(json.command, "sync --check");
    assert.equal(json.status, "converged");
    assert.equal(json.exitCode, 0);
    assertPendingCounts(json, 0, 0, 0, 0);
    assert.equal(json.errors, 0);
    assert.equal(json.manifestMissing, false);
    assert.equal(json.reason, null);
  });

  it("totalOps > 0 reports drift with the planned ops", () => {
    const json = checkWithSummary({ created: 2, updated: 1, totalOps: 3 });
    assert.equal(json.status, "drift");
    assert.equal(json.exitCode, 1);
    assertPendingCounts(json, 2, 1, 0, 3);
    assert.equal(json.reason, null);
  });

  it("generator failures are could-not-run but still report counts", () => {
    const json = checkWithSummary({ errors: 1, created: 2, totalOps: 2 });
    assert.equal(json.status, "could-not-run");
    assert.equal(json.exitCode, 1);
    assert.ok(json.reason?.includes("1 generator failure"));
    assertPendingCounts(json, 2, 0, 0, 2);
    assert.equal(json.errors, 1);
  });

  it("a missing manifest is could-not-run with the named reason", () => {
    const json = checkWithSummary({ manifestMissing: true });
    assert.equal(json.status, "could-not-run");
    assert.equal(json.reason, "manifest not found");
    assert.equal(json.manifestMissing, true);
  });

  it("manifestMissing beats generator failures in precedence", () => {
    const json = checkWithSummary({ manifestMissing: true, errors: 2 });
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

  it("a converged result carries timingsMs with total from durationMs", () => {
    const json = checkWithTimings(130, makePhases(5, 0, 120, 0));
    assert.deepEqual(json.timingsMs, {
      gitStatus: 5,
      preflight: 0,
      generators: 120,
      linter: 0,
      total: 130,
    });
  });

  it("drift and could-not-run results carry timingsMs when the summary has it", () => {
    const drift = checkWithTimings(50, makePhases(1, 2, 3, null), {
      created: 1,
      totalOps: 1,
    });
    const couldNotRun = checkWithTimings(60, makePhases(null, 1, 2, 3), {
      errors: 1,
    });
    assert.deepEqual(drift.timingsMs, {
      gitStatus: 1,
      preflight: 2,
      generators: 3,
      linter: null,
      total: 50,
    });
    assert.deepEqual(couldNotRun.timingsMs, {
      gitStatus: null,
      preflight: 1,
      generators: 2,
      linter: 3,
      total: 60,
    });
  });

  it("a summary without phaseTimingsMs yields timingsMs null", () => {
    const json = checkWithSummary();
    assert.equal(json.timingsMs, null);
  });

  it("the fatal path yields timingsMs null", () => {
    const json = buildSyncCheckJson(undefined, "boom");
    assert.equal(json.timingsMs, null);
  });

  it("null phases pass through as null, not 0", () => {
    const json = checkWithTimings(10, makePhases(null, null, 4, null));
    assert.deepEqual(json.timingsMs, {
      gitStatus: null,
      preflight: null,
      generators: 4,
      linter: null,
      total: 10,
    });
  });

  it("every result has the documented 10-key order", () => {
    const results: SyncCheckJson[] = [
      checkWithSummary(),
      checkWithSummary({ created: 1, totalOps: 1 }),
      checkWithSummary({ errors: 1, totalOps: 1 }),
      checkWithSummary({ manifestMissing: true }),
      buildSyncCheckJson(undefined, "boom"),
      buildSyncCheckJson(undefined, undefined),
    ];
    for (const result of results) {
      assert.deepEqual(Object.keys(result), DOCUMENTED_KEY_ORDER);
    }
  });
});
