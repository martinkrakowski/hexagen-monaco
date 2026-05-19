import { describe, it } from "node:test";
import assert from "node:assert";
import {
  extractYamlFromResponse as extractManifestYaml,
  generateSuggestions as generateManifestSuggestions,
  detectWarnings as detectManifestWarnings,
} from "../src/domain/manifest-yaml-extractor";

describe("manifest-yaml-extractor", () => {
  describe("extractManifestYaml", () => {
    it("should extract YAML from a fenced yaml code block", () => {
      const response =
        "Here is the manifest:\n```yaml\nworkspace:\n  name: test\nboundedContexts:\n  - name: orders\n```\nHope that helps!";
      const result = extractManifestYaml(response);
      assert.ok(result !== null, "Should extract YAML from fenced block");
      assert.match(result!, /workspace:\n {2}name: test/);
      assert.match(result!, /boundedContexts:/);
      assert.match(result!, /- name: orders/);
    });

    it("should extract YAML from a fenced yml code block", () => {
      const response =
        "```yml\nworkspace:\n  name: project\nboundedContexts:\n  - name: billing\n```";
      const result = extractManifestYaml(response);
      assert.ok(result !== null);
      assert.match(result!, /workspace:/);
      assert.match(result!, /- name: billing/);
    });

    it("should extract YAML from a generic fenced block containing workspace/boundedContexts", () => {
      const response =
        "Here is a generic block:\n```\nworkspace:\n  name: test\nboundedContexts:\n  - name: users\n```";
      const result = extractManifestYaml(response);
      assert.ok(result !== null, "Should extract from generic block");
      assert.match(result!, /workspace:/);
      assert.match(result!, /boundedContexts:/);
    });

    it("should extract YAML when inline (no code fences) but contains both workspace and boundedContexts", () => {
      const response =
        "Sure! Here's your manifest:\nworkspace:\n  name: my-app\n  template: modular-monolith\nboundedContexts:\n  - name: orders\n    type: core\n";
      const result = extractManifestYaml(response);
      assert.ok(result !== null, "Should extract inline YAML");
      assert.match(result!, /workspace:\n {2}name: my-app/);
      assert.match(result!, /boundedContexts:/);
      assert.match(result!, /- name: orders/);
    });

    it("should extract YAML starting from the first workspace line", () => {
      const response =
        "Some preamble text.\nMore text.\nworkspace:\n  name: found\nboundedContexts:\n  - name: domain\n";
      const result = extractManifestYaml(response);
      assert.ok(result !== null, "Should extract from workspace line");
      assert.match(result!, /workspace:\n {2}name: found/);
      assert.match(result!, /boundedContexts:/);
    });

    it("should extract YAML starting from a comment line when no workspace found first", () => {
      const response =
        "Some preamble.\n# Generated manifest\nworkspace:\n  name: gen\nboundedContexts:\n  - name: orders\n";
      const result = extractManifestYaml(response);
      assert.ok(result !== null);
      assert.match(result!, /# Generated manifest/);
      assert.match(result!, /workspace:\n {2}name: gen/);
    });

    it("should return empty string for a response with no YAML block at all", () => {
      const response =
        "I'm sorry, I couldn't generate a manifest. Please provide more details.";
      const result = extractManifestYaml(response);
      assert.strictEqual(result, "");
    });

    it("should return empty string for an empty string", () => {
      const result = extractManifestYaml("");
      assert.strictEqual(result, "");
    });

    it("should handle malformed YAML gracefully (still extract)", () => {
      const response =
        "```yaml\nworkspace:\n  name: test\nboundedContexts:\n  - name: orders\n  invalid: [unclosed\n```";
      const result = extractManifestYaml(response);
      assert.ok(result !== null, "Should extract even malformed YAML");
      assert.match(result!, /workspace:/);
    });

    it("should not extract from a generic block that lacks workspace/boundedContexts markers", () => {
      const response = "```\nsome code\nthat is not yaml\n```";
      const result = extractManifestYaml(response);
      assert.strictEqual(result, "");
    });
  });

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
