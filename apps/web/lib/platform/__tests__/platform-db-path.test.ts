import { describe, expect, it } from "vitest";
import assert from "node:assert/strict";
import {
  LOCAL_PLATFORM_DB_PATH,
  LOCAL_SCAN_ARTIFACTS_DIR,
  resolvePlatformDbPath,
  resolveScanArtifactsDir,
} from "../platform-db";

describe("resolvePlatformDbPath", () => {
  it("honors an explicit PLATFORM_DB_PATH", () => {
    assert.equal(
      resolvePlatformDbPath({ PLATFORM_DB_PATH: ":memory:" }),
      ":memory:",
    );
  });

  it("defaults production to the volume mount", () => {
    assert.equal(
      resolvePlatformDbPath({ NODE_ENV: "production" }),
      "/data/platform.db",
    );
  });

  it("defaults local (non-prod) to a durable file, not :memory:", () => {
    const path = resolvePlatformDbPath({ NODE_ENV: "development" });
    assert.equal(path, LOCAL_PLATFORM_DB_PATH);
    assert.notEqual(path, ":memory:");
  });

  it("keeps the Vitest process on :memory: so suites do not share a file", () => {
    assert.equal(resolvePlatformDbPath({ NODE_ENV: "test" }), ":memory:");
  });
});

describe("resolveScanArtifactsDir", () => {
  it("honors an explicit SCAN_ARTIFACTS_DIR", () => {
    expect(resolveScanArtifactsDir({ SCAN_ARTIFACTS_DIR: "/mnt/x" })).toBe(
      "/mnt/x",
    );
  });

  it("puts artifacts on the same production volume as the db", () => {
    expect(resolveScanArtifactsDir({ NODE_ENV: "production" })).toBe(
      "/data/scan-artifacts",
    );
    expect(resolvePlatformDbPath({ NODE_ENV: "production" })).toBe(
      "/data/platform.db",
    );
  });

  it("falls back to a temp dir off-prod, including under test", () => {
    // Unlike the db path there is no ":memory:" for a directory, so test and
    // dev deliberately share one. Suites that write artifacts must pass their
    // own temp dir rather than rely on this.
    expect(resolveScanArtifactsDir({ NODE_ENV: "test" })).toBe(
      LOCAL_SCAN_ARTIFACTS_DIR,
    );
    expect(resolveScanArtifactsDir({ NODE_ENV: "development" })).toBe(
      LOCAL_SCAN_ARTIFACTS_DIR,
    );
  });
});
