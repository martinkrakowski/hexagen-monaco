import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { compareSemver, isSemver } from "../../src/domain/findings/semver.js";

describe("semver — isSemver well-formedness gate", () => {
  it("accepts well-formed plain versions", () => {
    for (const ok of [
      "0.0.1",
      "1.2.3",
      "10.20.30",
      "1.0.0-alpha",
      "1.0.0+001",
    ]) {
      assert.equal(isSemver(ok), true, ok);
    }
  });

  it.each(["1.2", "1", "", "v1.2.3"])(
    "refuses a version missing a component (%s)",
    (bad) => {
      assert.equal(isSemver(bad), false, bad);
    },
  );

  it.each(["01.2.3", "1.02.3", "1.2.03", "1.0.0-01", "1.0.0-alpha.01"])(
    "refuses leading zeros in numeric identifiers (%s)",
    (bad) => {
      assert.equal(isSemver(bad), false, bad);
    },
  );

  it.each(["1.x.3", "a.b.c", "1.2.3-", "1.2.3+", "1.."] as const)(
    "refuses non-numeric or empty segments (%s)",
    (bad) => {
      assert.equal(isSemver(bad), false, bad);
    },
  );
});

describe("semver — compareSemver ordering", () => {
  it("orders by numeric value, not string length (1.10.0 > 1.9.0)", () => {
    assert.ok(compareSemver("1.10.0", "1.9.0") > 0);
    assert.ok(compareSemver("1.9.0", "1.10.0") < 0);
  });

  it("orders by major, then minor, then patch", () => {
    assert.ok(compareSemver("2.0.0", "1.9.9") > 0);
    assert.ok(compareSemver("1.2.0", "1.1.9") > 0);
    assert.ok(compareSemver("1.2.3", "1.2.2") > 0);
    assert.equal(compareSemver("1.2.3", "1.2.3"), 0);
  });

  it("sorts a release above any of its own prereleases", () => {
    assert.ok(compareSemver("1.0.0-rc.1", "1.0.0") < 0);
    assert.ok(compareSemver("1.0.0", "1.0.0-rc.1") > 0);
  });

  it("orders prereleases lexically when identifiers are alphanumeric", () => {
    assert.ok(compareSemver("1.0.0-alpha", "1.0.0-beta") < 0);
    assert.ok(compareSemver("1.0.0-alpha.1", "1.0.0-alpha") > 0);
  });

  it("sorts numeric prerelease identifiers below alphanumeric ones", () => {
    assert.ok(compareSemver("1.0.0-1", "1.0.0-alpha") < 0);
    assert.ok(compareSemver("1.0.0-alpha", "1.0.0-1") > 0);
  });

  it("compares numeric prerelease identifiers numerically (beta.11 > beta.2)", () => {
    assert.ok(compareSemver("1.0.0-beta.11", "1.0.0-beta.2") > 0);
  });

  it("orders numeric identifiers above Number.MAX_SAFE_INTEGER correctly", () => {
    // Number() rounds both of these to the same float, so a Number-based
    // compare would report them equal when they are not.
    assert.ok(
      compareSemver("999999999999999999.0.0", "999999999999999998.0.0") > 0,
    );
    assert.ok(compareSemver("1.0.0", "99999999999999999999.0.0") < 0);
    assert.ok(compareSemver("99999999999999999999.0.0", "1.0.0") > 0);
  });

  it("ignores build metadata in precedence", () => {
    assert.equal(compareSemver("1.2.3+01", "1.2.3+999"), 0);
    assert.equal(compareSemver("1.2.3+build.5", "1.2.3+build.6"), 0);
  });

  it("returns NaN when either side is not well-formed", () => {
    assert.ok(Number.isNaN(compareSemver("01.2.0", "1.2.0")));
    assert.ok(Number.isNaN(compareSemver("1.2.0", "banana")));
  });
});
