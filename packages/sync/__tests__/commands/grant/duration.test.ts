import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseDurationMs } from "../../../src/commands/grant/duration.js";

describe("parseDurationMs", () => {
  it("parses seconds, minutes, hours, and days", () => {
    assert.equal(parseDurationMs("900s"), 900_000);
    assert.equal(parseDurationMs("30m"), 1_800_000);
    assert.equal(parseDurationMs("4h"), 14_400_000);
    assert.equal(parseDurationMs("1d"), 86_400_000);
  });

  it("rejects an unknown unit", () => {
    assert.throws(() => parseDurationMs("4w"), /Invalid --expires-in/);
  });

  it("rejects a compound duration", () => {
    assert.throws(() => parseDurationMs("1h30m"), /Invalid --expires-in/);
  });

  it("rejects zero and negative durations", () => {
    assert.throws(() => parseDurationMs("0s"), /Invalid --expires-in/);
    assert.throws(() => parseDurationMs("-4h"), /Invalid --expires-in/);
  });

  it("rejects a bare number with no unit", () => {
    assert.throws(() => parseDurationMs("4"), /Invalid --expires-in/);
  });
});
