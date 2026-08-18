import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { LOCAL_PLATFORM_DB_PATH, resolvePlatformDbPath } from "../platform-db";

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
