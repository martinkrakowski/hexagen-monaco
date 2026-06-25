import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { withFormStateDefaults } from "./form-state-defaults";

describe("withFormStateDefaults", () => {
  it("fills addOnsAnswers + other top-level defaults on an empty formState", () => {
    const out = withFormStateDefaults({});
    assert.deepStrictEqual(out.addOnsAnswers, {});
    assert.ok(Array.isArray(out.boundedContexts));
  });

  it("preserves a present addOnsAnswers", () => {
    const out = withFormStateDefaults({
      addOnsAnswers: { "rate-limiting": { enabled: true } },
    });
    assert.deepStrictEqual(out.addOnsAnswers, {
      "rate-limiting": { enabled: true },
    });
  });

  it("sanitizes a malformed present addOnsAnswers to {} (strict downstream contract)", () => {
    // null / array / primitive would make readAddOnAnswers return null → route 400.
    for (const bad of [null, [1], "x", 42]) {
      assert.deepStrictEqual(
        withFormStateDefaults({ addOnsAnswers: bad }).addOnsAnswers,
        {},
      );
    }
  });

  it("keeps present (drifted) data verbatim while still padding addOnsAnswers", () => {
    const out = withFormStateDefaults({ boundedContexts: "not-an-array" });
    assert.strictEqual(out.boundedContexts, "not-an-array");
    assert.deepStrictEqual(out.addOnsAnswers, {});
  });

  it("yields canonical defaults for non-object input", () => {
    for (const bad of [undefined, null, [1, 2], "x", 42]) {
      assert.deepStrictEqual(withFormStateDefaults(bad).addOnsAnswers, {});
    }
  });

  it("does not share mutable nested references between calls (no aliasing)", () => {
    const a = withFormStateDefaults({});
    const b = withFormStateDefaults({});
    (a.addOnsAnswers as Record<string, unknown>).injected = true;
    assert.deepStrictEqual(
      b.addOnsAnswers,
      {},
      "a second call's defaults are unaffected by mutating the first",
    );
  });
});
