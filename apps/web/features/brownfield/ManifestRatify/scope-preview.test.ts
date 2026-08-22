/**
 * Drift guard + behaviour for the S4 scope preview.
 *
 * THE FIRST DESCRIBE BLOCK IS THE POINT OF THIS FILE. `scope-preview.ts` carries
 * a mirror of `sanitizeScope` because the canonical one lives inside a bundle
 * that top-level-imports `fs`, `child_process` and `ts-morph` and cannot enter a
 * client bundle. A mirror nothing checks is a lie waiting to happen, so this
 * suite imports the REAL implementation from `@hexagen/sync` — through the
 * public barrel this packet widened, which also proves the export works — and
 * asserts the two agree over the canonical suite's own table plus a generated
 * corpus.
 *
 * If `packages/sync/src/types/manifest/helpers.ts` changes, this goes red here
 * rather than a user finding out after `manifest.yaml` has been written.
 *
 * NOTE FOR THE PRIMARY: this suite resolves `@hexagen/sync` through `dist/`.
 * A failure that makes no sense against the source is a stale build first —
 * `yarn turbo build --filter=@hexagen/sync --force`.
 */
import { describe, it, expect } from "vitest";
import { sanitizeScope as canonicalSanitizeScope } from "@hexagen/sync";

import {
  MAX_SCOPE_CHARS,
  SCOPE_FALLBACK,
  previewScope,
  sanitizeScope,
} from "./scope-preview";

/**
 * Every input `packages/sync/__tests__/generators/namespacing.test.ts` pins,
 * plus the shapes a user actually types into a scope field.
 */
const CORPUS: readonly string[] = [
  // The canonical suite's table, verbatim.
  "@My-Scope",
  "My Cool App!!",
  "a..b__c",
  "--edge--",
  "@@@",
  "   ",
  "acme",
  "my-app",
  "a".repeat(213) + "-x".repeat(50),
  // The plan's worked example.
  "@Acme Corp!",
  // Things a scope field receives in practice.
  "",
  ".",
  "_",
  "-",
  "...",
  "@",
  "@@acme",
  "Acme Corp GmbH & Co. KG",
  "  padded  ",
  "UPPER",
  "with/slash",
  "emoji-\u{1F600}-scope",
  "tabs\tand\nnewlines",
  "trailing-",
  "-leading",
  "a.b_c-d",
  "9lives",
  "x".repeat(MAX_SCOPE_CHARS + 20),
  ("y".repeat(10) + "-").repeat(30),
];

describe("sanitizeScope parity with @hexagen/sync", () => {
  for (const raw of CORPUS) {
    it(`agrees with the canonical implementation for ${JSON.stringify(raw)}`, () => {
      expect(sanitizeScope(raw)).toBe(canonicalSanitizeScope(raw));
    });
  }

  it("agrees on the fallback constant rather than assuming it", () => {
    expect(SCOPE_FALLBACK).toBe(canonicalSanitizeScope("@@@"));
  });

  it("agrees that the preview's value is what would be written", () => {
    // previewScope folds the same rule list sanitizeScope does; this is the
    // assertion that keeps the two in step if that ever stops being true.
    for (const raw of CORPUS) {
      expect(previewScope(raw).value).toBe(canonicalSanitizeScope(raw));
    }
  });
});

describe("sanitizeScope is idempotent", () => {
  // `toRatificationPayload` sends the sanitized scope and `hexagen bootstrap`
  // sanitizes again on the way into manifest.yaml. That is only safe if a
  // second pass is a no-op — otherwise the user ratifies one string and the
  // file gets another.
  for (const raw of CORPUS) {
    it(`is stable on a second pass for ${JSON.stringify(raw)}`, () => {
      const once = sanitizeScope(raw);
      expect(sanitizeScope(once)).toBe(once);
    });
  }
});

describe("previewScope", () => {
  it("reports an already-legal scope as unchanged, with no rules to explain", () => {
    const preview = previewScope("acme");

    expect(preview.value).toBe("acme");
    expect(preview.isUnchanged).toBe(true);
    expect(preview.usedFallback).toBe(false);
    expect(preview.appliedRules).toEqual([]);
  });

  it("names every rule that fired, in application order", () => {
    const preview = previewScope("@Acme Corp!");

    expect(preview.value).toBe("acme-corp");
    expect(preview.isUnchanged).toBe(false);
    // No "collapse-separators": the space and the "!" each become a single
    // hyphen and never sit adjacent, so that rule genuinely does not fire.
    // Listing it anyway would be the screen claiming a transform that did not
    // happen — which is the failure this whole module exists to avoid.
    expect(preview.appliedRules.map((rule) => rule.id)).toEqual([
      "lowercase",
      "strip-leading-at",
      "replace-illegal",
      "trim-separators",
    ]);
  });

  it("reports collapsing only when separators actually ran together", () => {
    const preview = previewScope("a..b__c");

    expect(preview.value).toBe("a-b-c");
    expect(preview.appliedRules.map((rule) => rule.id)).toEqual([
      "collapse-separators",
    ]);
  });

  it("gives every applied rule an explanation the screen can render", () => {
    for (const rule of previewScope("@Acme Corp!").appliedRules) {
      expect(rule.explanation.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes a faithful rewrite from a fallback the user never chose", () => {
    expect(previewScope("@Acme Corp!").usedFallback).toBe(false);
    expect(previewScope("@@@").usedFallback).toBe(true);
    expect(previewScope("@@@").value).toBe(SCOPE_FALLBACK);
  });

  it("trims the separator a truncation lands on, not before truncating", () => {
    // Char 214 is "-": trimming before the slice would leave a trailing
    // separator npm rejects. The rule order in SCOPE_RULES is what prevents it.
    const preview = previewScope("a".repeat(213) + "-x".repeat(50));

    expect(preview.value).toBe("a".repeat(213));
    expect(preview.value.length).toBeLessThanOrEqual(MAX_SCOPE_CHARS);
    expect(preview.appliedRules.map((rule) => rule.id)).toContain("truncate");
    expect(preview.appliedRules.map((rule) => rule.id)).toContain(
      "trim-separators",
    );
  });
});
