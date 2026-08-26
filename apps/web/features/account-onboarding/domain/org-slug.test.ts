import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { ORG_SLUG_PATTERN } from "../../../app/lib/adapters/http-orgs.adapter";
import { suggestSlug } from "./org-slug.js";

describe("suggestSlug", () => {
  it("lowercases and hyphenates non-alphanumerics", () => {
    assert.strictEqual(suggestSlug("Acme Robotics"), "acme-robotics");
    assert.strictEqual(suggestSlug("Née & Co."), "n-e-co");
  });

  it("collapses runs and trims leading/trailing hyphens", () => {
    assert.strictEqual(suggestSlug("  --Acme!!  Inc--  "), "acme-inc");
  });

  it("clips to the 40-char ceiling without a dangling hyphen", () => {
    const long = suggestSlug("a".repeat(39) + " tail");
    assert.ok(long.length <= 40);
    assert.ok(!long.endsWith("-"));
  });

  it("produces ORG_SLUG_PATTERN-valid slugs for ordinary names", () => {
    for (const name of ["Acme Robotics", "Team 42", "Ökonomie Verein 2000"]) {
      const slug = suggestSlug(name);
      assert.ok(
        ORG_SLUG_PATTERN.test(slug),
        `"${name}" suggested "${slug}", which fails ORG_SLUG_PATTERN`,
      );
    }
  });

  it("returns an empty string when nothing survives", () => {
    assert.strictEqual(suggestSlug("!!!"), "");
    assert.strictEqual(suggestSlug(""), "");
  });
});
