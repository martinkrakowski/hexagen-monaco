import { describe, it } from "vitest";
import assert from "node:assert";
import {
  generateSuggestions as generateManifestSuggestions,
  detectWarnings as detectManifestWarnings,
} from "../src/domain/manifest-yaml-extractor";

describe("manifest-yaml-extractor", () => {
  describe("generateManifestSuggestions", () => {
    it("should suggest adding descriptions when none present", () => {
      const yaml =
        "workspace:\n  name: test\nboundedContexts:\n  - name: orders\n";
      const suggestions = generateManifestSuggestions(yaml);
      assert.ok(
        suggestions.some((s) => s.includes("descriptions")),
        "Should suggest adding descriptions",
      );
    });

    it("should not suggest descriptions when description is present", () => {
      const yaml =
        "workspace:\n  name: test\n  description: A great project\nboundedContexts:\n  - name: orders\n";
      const suggestions = generateManifestSuggestions(yaml);
      const hasDescriptionSuggestion = suggestions.some((s) =>
        s.includes("descriptions"),
      );
      assert.strictEqual(hasDescriptionSuggestion, false);
    });

    it("should suggest adapters when none defined", () => {
      const yaml =
        "workspace:\n  name: test\nboundedContexts:\n  - name: orders\n";
      const suggestions = generateManifestSuggestions(yaml);
      assert.ok(
        suggestions.some((s) => s.includes("adapters")),
        "Should suggest defining adapters",
      );
    });

    it("should suggest dependencies when none defined", () => {
      const yaml =
        "workspace:\n  name: test\nboundedContexts:\n  - name: orders\n";
      const suggestions = generateManifestSuggestions(yaml);
      assert.ok(
        suggestions.some((s) => s.includes("dependencies")),
        "Should suggest defining dependencies",
      );
    });

    it("should suggest domain decomposition for a single context", () => {
      const yaml =
        "workspace:\n  name: test\nboundedContexts:\n  - name: orders\n";
      const suggestions = generateManifestSuggestions(yaml);
      assert.ok(
        suggestions.some((s) => s.includes("domain decomposition")),
        "Should suggest domain decomposition for single context",
      );
    });

    it("should return empty array for a complete manifest", () => {
      const yaml =
        "workspace:\n  name: test\n  description: A test\nboundedContexts:\n  - name: a\n  - name: b\nports:\n  - name: rest\nadapters:\n  - name: express\ndependencies:\n  - from: a\n    to: b\n";
      const suggestions = generateManifestSuggestions(yaml);
      assert.strictEqual(
        suggestions.length,
        0,
        "Complete manifest should have no suggestions",
      );
    });

    it("should return suggestions for empty manifest string (treated as incomplete)", () => {
      const suggestions = generateManifestSuggestions("");
      assert.ok(
        suggestions.length > 0,
        "Empty manifest should produce suggestions",
      );
      assert.ok(
        suggestions.some((s) => s.includes("descriptions")),
        "Should suggest descriptions for empty manifest",
      );
    });
  });

  describe("detectManifestWarnings", () => {
    it("should warn about TODO/FIXME markers", () => {
      const yaml =
        "workspace:\n  name: test\n  # TODO: add description\nboundedContexts:\n  - name: orders\n";
      const warnings = detectManifestWarnings(yaml);
      assert.ok(
        warnings.some((w) => w.includes("TODO")),
        "Should warn about TODO markers",
      );
    });

    it("should warn about FIXME markers", () => {
      const yaml =
        "workspace:\n  name: test\n  # FIXME: broken\nboundedContexts:\n  - name: orders\n";
      const warnings = detectManifestWarnings(yaml);
      assert.ok(
        warnings.some((w) => w.includes("FIXME")),
        "Should warn about FIXME markers",
      );
    });

    it("should warn about placeholder or example.com values", () => {
      const yaml =
        "workspace:\n  name: placeholder\nboundedContexts:\n  - name: orders\n";
      const warnings = detectManifestWarnings(yaml);
      assert.ok(
        warnings.some((w) => w.includes("placeholder")),
        "Should warn about placeholder values",
      );
    });

    it("should warn when many contexts are detected", () => {
      const yaml =
        "workspace:\n  name: test\nboundedContexts:\n  - name: a\n  - name: b\n  - name: c\n  - name: d\n  - name: e\n  - name: f\n";
      const warnings = detectManifestWarnings(yaml);
      assert.ok(
        warnings.some((w) => w.includes("Large number of contexts")),
        "Should warn about large number of contexts",
      );
    });

    it("should warn when no ports are defined", () => {
      const yaml =
        "workspace:\n  name: test\nboundedContexts:\n  - name: orders\n";
      const warnings = detectManifestWarnings(yaml);
      assert.ok(
        warnings.some((w) => w.includes("No ports defined")),
        "Should warn about missing ports",
      );
    });

    it("should return no warnings for a well-formed complete manifest", () => {
      const yaml =
        "workspace:\n  name: test\n  description: desc\nboundedContexts:\n  - name: a\n  - name: b\nports:\n  - name: inbound\nadapters:\n  - name: express\n";
      const warnings = detectManifestWarnings(yaml);
      assert.strictEqual(
        warnings.length,
        0,
        "Well-formed manifest should have no warnings",
      );
    });

    it("should warn about missing ports for empty manifest string", () => {
      const warnings = detectManifestWarnings("");
      assert.ok(warnings.length > 0, "Empty manifest should produce warnings");
      assert.ok(
        warnings.some((w) => w.includes("No ports defined")),
        "Should warn about missing ports for empty manifest",
      );
    });
  });
});
