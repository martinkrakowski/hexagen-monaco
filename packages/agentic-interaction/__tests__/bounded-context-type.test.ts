import { describe, it } from "node:test";
import assert from "node:assert";
import {
  BOUNDED_CONTEXT_TYPES,
  boundedContextTypeSchema,
} from "@hexagen/shared";

// Guards the reconciled, single-source bounded-context-type enum (@hexagen/shared).
// Historically the copies in shared/agentic-interaction were missing "driver"
// and were case-sensitive; these assert the canonical schema is complete and
// normalizes casing.
//
// Lives here (not in @hexagen/shared) because shared has no test runner of its
// own; agentic-interaction is a primary consumer and imports only the public
// @hexagen/shared API, so the guard travels with a package that exercises it.
describe("boundedContextTypeSchema (shared canonical)", () => {
  it("includes 'driver' among the canonical values", () => {
    assert.ok(BOUNDED_CONTEXT_TYPES.includes("driver"));
  });

  it("accepts every canonical value unchanged", () => {
    for (const t of BOUNDED_CONTEXT_TYPES) {
      assert.strictEqual(boundedContextTypeSchema.parse(t), t);
    }
  });

  it("accepts 'driver' specifically (the historically-missing value)", () => {
    assert.strictEqual(boundedContextTypeSchema.parse("driver"), "driver");
  });

  it("is case-insensitive and normalizes to canonical lowercase", () => {
    assert.strictEqual(boundedContextTypeSchema.parse("Core"), "core");
    assert.strictEqual(boundedContextTypeSchema.parse("DRIVER"), "driver");
    assert.strictEqual(
      boundedContextTypeSchema.parse("Shared-Kernel"),
      "shared-kernel",
    );
  });

  it("trims surrounding whitespace", () => {
    assert.strictEqual(boundedContextTypeSchema.parse("  driver  "), "driver");
  });

  it("rejects unknown values", () => {
    assert.strictEqual(
      boundedContextTypeSchema.safeParse("nonsense").success,
      false,
    );
  });
});
