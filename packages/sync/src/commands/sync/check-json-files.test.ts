import { describe, expect, it } from "vitest";
import {
  buildSyncCheckJson,
  SYNC_CHECK_JSON_SCHEMA_VERSION,
} from "./check-json.js";
import type { DriftFile, SyncRunSummary } from "../../results.js";

const makeSummary = (
  overrides: Partial<SyncRunSummary> = {},
): SyncRunSummary => ({
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
});

describe("buildSyncCheckJson files key", () => {
  const sampleDrift: DriftFile[] = [
    {
      path: "src/file.ts",
      action: "create",
      generator: "RootFiles",
      reason: "missing on disk; sync would create it",
    },
  ];

  it("drift carries the summary's files list verbatim", () => {
    const summary = makeSummary({
      created: 1,
      totalOps: 1,
      files: sampleDrift,
    });
    const json = buildSyncCheckJson(summary, undefined);
    expect(json.status).toBe("drift");
    expect(json.files).toEqual(sampleDrift);
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
    const cases = [
      buildSyncCheckJson(
        makeSummary({ created: 1, totalOps: 1, files: sampleDrift }),
        undefined,
      ),
      buildSyncCheckJson(makeSummary(), undefined),
      buildSyncCheckJson(makeSummary({ manifestMissing: true }), undefined),
      buildSyncCheckJson(makeSummary({ errors: 1 }), undefined),
      buildSyncCheckJson(undefined, "boom"),
    ];
    for (const res of cases) {
      expect(res.schemaVersion).toBe(SYNC_CHECK_JSON_SCHEMA_VERSION);
    }
  });
});
