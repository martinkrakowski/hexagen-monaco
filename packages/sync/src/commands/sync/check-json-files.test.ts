import { describe, expect, it } from "vitest";
import {
  buildSyncCheckJson,
  SYNC_CHECK_JSON_SCHEMA_VERSION,
} from "./check-json.js";
import type { DriftFile, SyncRunSummary } from "../../results.js";

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

const PRE_EXISTING_KEYS = [
  "schemaVersion",
  "command",
  "status",
  "exitCode",
  "pending",
  "errors",
  "manifestMissing",
  "reason",
] as const;

describe("buildSyncCheckJson files key", () => {
  const driftFiles: DriftFile[] = [
    {
      path: "packages/a/src/index.ts",
      action: "create",
      generator: "RootFiles",
      reason: "missing on disk; sync would create it",
    },
  ];

  it("drift carries the summary's files list verbatim", () => {
    const summary = makeSummary({
      created: 1,
      totalOps: 1,
      files: driftFiles,
    });
    const json = buildSyncCheckJson(summary, undefined);
    expect(json.status).toBe("drift");
    expect(json.files).toEqual(driftFiles);
  });

  it("converged with files undefined yields []", () => {
    const json = buildSyncCheckJson(makeSummary(), undefined);
    expect(json.status).toBe("converged");
    expect(json.files).toEqual([]);
  });

  it("the fatal path yields files null", () => {
    const json = buildSyncCheckJson(undefined, "boom");
    expect(json.status).toBe("could-not-run");
    expect(json.files).toBeNull();
  });

  it("manifest-missing and errors cases yield an array", () => {
    expect(
      buildSyncCheckJson(makeSummary({ manifestMissing: true }), undefined)
        .files,
    ).toEqual([]);
    expect(
      buildSyncCheckJson(makeSummary({ errors: 1 }), undefined).files,
    ).toEqual([]);
  });

  it("schemaVersion is 1 in every case", () => {
    const results = [
      buildSyncCheckJson(
        makeSummary({ created: 1, totalOps: 1, files: driftFiles }),
        undefined,
      ),
      buildSyncCheckJson(makeSummary(), undefined),
      buildSyncCheckJson(makeSummary({ manifestMissing: true }), undefined),
      buildSyncCheckJson(makeSummary({ errors: 1 }), undefined),
      buildSyncCheckJson(undefined, "boom"),
    ];
    for (const result of results) {
      expect(result.schemaVersion).toBe(SYNC_CHECK_JSON_SCHEMA_VERSION);
    }
  });

  it("files is the last key and every pre-existing key is still present", () => {
    const results = [
      buildSyncCheckJson(
        makeSummary({ created: 1, totalOps: 1, files: driftFiles }),
        undefined,
      ),
      buildSyncCheckJson(makeSummary(), undefined),
      buildSyncCheckJson(makeSummary({ manifestMissing: true }), undefined),
      buildSyncCheckJson(makeSummary({ errors: 1 }), undefined),
      buildSyncCheckJson(undefined, "boom"),
    ];
    for (const result of results) {
      const keys = Object.keys(result);
      expect(keys[keys.length - 1]).toBe("files");
      for (const key of PRE_EXISTING_KEYS) {
        expect(keys).toContain(key);
      }
    }
  });
});
