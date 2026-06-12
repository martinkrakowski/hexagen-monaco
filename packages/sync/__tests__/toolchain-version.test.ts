/**
 * Toolchain-version resolution (PR-A3, RCA #1).
 *
 * Under tsx the build-time define doesn't exist, so resolveToolchainVersion()
 * exercises the src fallback here: reading packages/sync/package.json. The
 * build-injected path through the REAL dist bundle is pinned by
 * contract/toolchain-version.contract.test.ts (where the fixture's staged
 * package.json carries a sentinel version, so the two sources are
 * distinguishable).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  assertValidToolchainVersion,
  resolveToolchainVersion,
} from "../src/toolchain-version.js";

const PKG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json",
);

describe("toolchain version (PR-A3, RCA #1)", () => {
  it("resolves the workspace package's own version under src execution", () => {
    const expected = (
      JSON.parse(readFileSync(PKG_PATH, "utf8")) as { version: string }
    ).version;
    assert.equal(resolveToolchainVersion(), expected);
    // Belt-and-braces: the workspace version itself must never be the
    // degenerate value the resolver exists to reject.
    assert.notEqual(expected, "0.0.0");
  });

  it("accepts plain and suffixed semver versions", () => {
    assert.equal(assertValidToolchainVersion("0.7.0", "test"), "0.7.0");
    assert.equal(assertValidToolchainVersion("1.0.0", "test"), "1.0.0");
    assert.equal(
      assertValidToolchainVersion("0.8.0-rc.1", "test"),
      "0.8.0-rc.1",
    );
    assert.equal(
      assertValidToolchainVersion("1.2.3-alpha.1+build.5", "test"),
      "1.2.3-alpha.1+build.5",
    );
  });

  it("rejects non-semver strings that merely START with a version (review #316)", () => {
    // The first cut used a prefix regex — "1.2.3junk" passed and would have
    // been interpolated into the scaffold as the range "^1.2.3junk". The
    // anchored SemVer 2.0.0 regex rejects all of these full-string; its
    // charset also keeps quotes/whitespace out of the emitted JSON.
    const malformed = [
      "1.2.3junk",
      "0.8.0 ", // trailing whitespace
      " 0.8.0", // leading whitespace
      '1.2.3"', // would break the JSON string it lands in
      "1.2.3-rc..1", // empty prerelease identifier
      "01.2.3", // leading zero (SemVer §2)
      "1.2.3.4",
      "1.2.3 || 2.0.0", // a RANGE is not a version
    ];
    for (const bad of malformed) {
      assert.throws(
        () => assertValidToolchainVersion(bad, "test"),
        /malformed/,
        `expected rejection of ${JSON.stringify(bad)}`,
      );
    }
  });

  it("rejects the degenerate 0.0.0 (the old silent-fallback value)", () => {
    assert.throws(
      () => assertValidToolchainVersion("0.0.0", "test"),
      /degenerate.*RCA #1/s,
    );
    // The published-layout contract fixture stages "0.0.0-contract" — a
    // degenerate-prerelease shape that must be rejected too, so a dist that
    // ever falls back to reading the adjacent package.json fails loudly
    // instead of emitting a broken pin.
    assert.throws(
      () => assertValidToolchainVersion("0.0.0-contract", "test"),
      /degenerate/,
    );
  });

  it("rejects missing and malformed versions, naming the source", () => {
    assert.throws(
      () => assertValidToolchainVersion(undefined, "some/package.json"),
      /some\/package\.json/,
    );
    assert.throws(() => assertValidToolchainVersion(42, "test"), /degenerate/);
    assert.throws(
      () => assertValidToolchainVersion("not-a-version", "test"),
      /degenerate/,
    );
    assert.throws(() => assertValidToolchainVersion("", "test"), /degenerate/);
  });
});
