import { describe, it } from "vitest";
import assert from "node:assert/strict";

// Loads parseIntEnv from the emitted bullmq template file. The helper lives
// in its own zero-dependency module (parse-int-env.ts) so this test can
// import it without dragging in ioredis / bullmq (which aren't workspace
// deps of @hexagen/template-engine). This test pins the validator's
// behaviour so future edits can't silently reintroduce the NaN-via-bad-env
// bug fixed in PR #114.
import { parseIntEnv } from "../../templates/bullmq/files/src/infrastructure/queue/parse-int-env";

function withEnv(
  name: string,
  value: string | undefined,
  fn: () => void,
): void {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  }
}

describe("bullmq parseIntEnv — env-var integer validation", () => {
  it("returns the fallback when the env var is unset", () => {
    withEnv("HG_TEST_INT", undefined, () => {
      assert.equal(parseIntEnv("HG_TEST_INT", 7), 7);
    });
  });

  it("returns the fallback when the env var is the empty string", () => {
    withEnv("HG_TEST_INT", "", () => {
      assert.equal(parseIntEnv("HG_TEST_INT", 7), 7);
    });
  });

  it("returns the parsed value for a valid integer", () => {
    withEnv("HG_TEST_INT", "42", () => {
      assert.equal(parseIntEnv("HG_TEST_INT", 7), 42);
    });
  });

  it("returns the fallback when the value is not numeric (was NaN bug)", () => {
    withEnv("HG_TEST_INT", "abc", () => {
      // Pre-fix this would have produced NaN and silently corrupted any
      // comparison the caller did against the value.
      assert.equal(parseIntEnv("HG_TEST_INT", 7), 7);
    });
  });

  it("returns the fallback when the value is below the minimum", () => {
    withEnv("HG_TEST_INT", "-1", () => {
      assert.equal(parseIntEnv("HG_TEST_INT", 7, 0), 7);
    });
  });

  it("returns the fallback when the value is above the maximum", () => {
    withEnv("HG_TEST_INT", "1000", () => {
      assert.equal(parseIntEnv("HG_TEST_INT", 7, 0, 100), 7);
    });
  });

  it("accepts the boundary values [min, max]", () => {
    withEnv("HG_TEST_INT", "0", () => {
      assert.equal(parseIntEnv("HG_TEST_INT", 7, 0, 100), 0);
    });
    withEnv("HG_TEST_INT", "100", () => {
      assert.equal(parseIntEnv("HG_TEST_INT", 7, 0, 100), 100);
    });
  });
});
