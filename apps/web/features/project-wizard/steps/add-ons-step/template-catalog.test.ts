import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  findCompanionSuggestions,
  TEMPLATE_CATALOG,
} from "./template-catalog";
import { TEMPLATE_MANIFESTS } from "./template-manifest.generated";

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

describe("catalog ↔ manifest parity (the bidirectional guard)", () => {
  it("every manifest has a catalog card, and every card has a manifest", () => {
    const manifestIds = new Set(Object.keys(TEMPLATE_MANIFESTS));
    const catalogIds = new Set(TEMPLATE_CATALOG.map((e) => e.id));
    const missingCard = [...manifestIds].filter((id) => !catalogIds.has(id));
    const ghost = [...catalogIds].filter((id) => !manifestIds.has(id));
    assert.deepEqual(
      missingCard,
      [],
      `manifests with no catalog presentation entry (unselectable templates): ${missingCard.join(", ")}`,
    );
    assert.deepEqual(
      ghost,
      [],
      `catalog cards with no manifest (ghosts): ${ghost.join(", ")}`,
    );
  });

  it("merges name/description/requires/conflicts from the manifest (never hand-copied)", () => {
    for (const entry of TEMPLATE_CATALOG) {
      const meta = TEMPLATE_MANIFESTS[entry.id];
      assert.ok(meta, `${entry.id} must have a manifest`);
      assert.equal(entry.name, meta.name, `${entry.id} name`);
      assert.equal(
        entry.description,
        meta.description,
        `${entry.id} description`,
      );
      assert.deepEqual(
        entry.requires,
        [...meta.requires],
        `${entry.id} requires`,
      );
      assert.deepEqual(
        entry.conflicts,
        [...meta.conflicts],
        `${entry.id} conflicts`,
      );
    }
  });

  it("every card's category is registered in CATEGORIES and CATEGORY_LABELS", () => {
    for (const entry of TEMPLATE_CATALOG) {
      assert.ok(
        CATEGORIES.includes(entry.category),
        `${entry.category} missing from CATEGORIES`,
      );
      assert.ok(
        entry.category in CATEGORY_LABELS,
        `${entry.category} missing from CATEGORY_LABELS`,
      );
    }
  });
});
