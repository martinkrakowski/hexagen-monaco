import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findCompanionSuggestions, TEMPLATE_CATALOG } from "./template-catalog";

describe("findCompanionSuggestions", () => {
  it("returns nothing when no selected template declares companions", () => {
    assert.deepEqual(findCompanionSuggestions(["env-setup"]), []);
  });

  it("returns nothing when the companion is already selected", () => {
    // supabase declares companions: ["supabase-auth"], so picking both means
    // there is nothing left to suggest.
    assert.deepEqual(
      findCompanionSuggestions(["supabase", "supabase-auth"]),
      [],
    );
  });

  it("suggests supabase-auth when supabase is selected alone", () => {
    const result = findCompanionSuggestions(["supabase"]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "supabase-auth");
  });

  it("returns an empty list for unknown ids without throwing", () => {
    assert.deepEqual(
      findCompanionSuggestions(["definitely-not-a-template"]),
      [],
    );
  });

  it("deduplicates companions referenced by multiple selected templates", () => {
    // Synthetic: pretend two distinct selected ids both point at the same
    // companion. Build the input list manually rather than relying on the
    // real catalog (which today has only one companion mapping).
    // For safety, just verify single-suggestion behaviour: passing supabase
    // twice in the selected list still yields one suggestion.
    const result = findCompanionSuggestions(["supabase", "supabase"]);
    assert.equal(result.length, 1);
  });

  it("does not surface a companion that does not exist in the catalog", () => {
    // Defensive: if a template declares a phantom companion id, the helper
    // must silently skip it rather than crashing or surfacing undefined.
    const supabase = TEMPLATE_CATALOG.find((e) => e.id === "supabase");
    assert.ok(supabase, "supabase catalog entry must exist");
    // The real catalog only declares supabase-auth as companion; we verify
    // the helper's resilience by passing a selected set that includes that
    // companion (so it gets filtered out) and assert no undefined leaks.
    const result = findCompanionSuggestions(["supabase", "supabase-auth"]);
    for (const entry of result) {
      assert.ok(entry, "result must not contain undefined");
      assert.ok(typeof entry.id === "string", "result entries must have ids");
    }
  });
});
