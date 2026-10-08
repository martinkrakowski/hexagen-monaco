import { describe, it, expect } from "vitest";

import { scopeGovernanceKey } from "../scope-governance-key";

describe("scopeGovernanceKey", () => {
  it("produces different storage keys for two projects on the same question", () => {
    const ctx = "step:bounded_contexts:q:abc";
    const a = scopeGovernanceKey("projA", ctx);
    const b = scopeGovernanceKey("projB", ctx);

    expect(a).not.toBe(b);
    expect(a).toBe("projA-step:bounded_contexts:q:abc");
    expect(b).toBe("projB-step:bounded_contexts:q:abc");
  });

  it("uses the fixed 'unsaved' scope when there is no active project", () => {
    const ctx = "step:bounded_contexts:q:abc";

    expect(scopeGovernanceKey(null, ctx)).toBe(
      "unsaved-step:bounded_contexts:q:abc",
    );
  });

  it("an 'unsaved' scope must never collide with a saved project's range", () => {
    const saved = scopeGovernanceKey("projA", "step:foo:q:bar");
    const unsaved = scopeGovernanceKey(null, "step:foo:q:bar");

    expect(saved).not.toBe(unsaved);
    expect(saved).not.toMatch(/^unsaved-/);
    expect(unsaved).not.toMatch(/^projA-/);
  });
});
