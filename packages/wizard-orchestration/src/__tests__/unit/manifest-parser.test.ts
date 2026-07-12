import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  BoundedContextTypeSchema,
  RelationshipPatternSchema,
} from "@hexagen/project-configuration";
import { parseManifestToWizardData } from "../../application/manifest-parser";

describe("parseManifestToWizardData", () => {
  const validManifestYaml = `
system: test-system
scope: "@hexagen/test"
architecture: "modular-monolith"
bounded_contexts:
  - name: "UserContext"
    type: "core"
    description: "Handles user management"
    layers:
      domain:
        entities: ["User", "Profile"]
        value_objects: ["EmailAddress"]
      application:
        use_cases: ["CreateUser", "UpdateUser"]
        ports:
          in: ["rest-controller"]
          out: ["relational-db"]
      infrastructure:
        adapters: ["Prisma"]
`;

  it("should parse a valid manifest YAML string", () => {
    const result = parseManifestToWizardData(validManifestYaml);
    assert.ok(result !== undefined);
    assert.strictEqual(result.boundedContexts.length, 1);
    assert.strictEqual(result.boundedContexts[0].name, "UserContext");
    assert.strictEqual(result.governance.workspaceName, "test-system");
  });

  it("names the offending field path in validation errors", () => {
    // An app entry without `name` — the shape that made a generated manifest
    // fail at the accept screen with a pathless "Required". The error must
    // point at the field so the banner that quotes it is actionable.
    const badAppsYaml = `
system: test-system
bounded_contexts:
  - name: "UserContext"
    type: "core"
apps:
  - framework: next.js
`;
    assert.throws(
      () => parseManifestToWizardData(badAppsYaml),
      /apps\.0\.name: Required/,
    );
  });

  it("preserves a recognised non-default architecture (strict-enterprise)", () => {
    const strictYaml = `
system: strict-test
scope: "@hexagen/test"
architecture: "strict-enterprise"
bounded_contexts:
  - name: "UserContext"
    type: "core"
    description: "Users"
    layers:
      domain:
        entities: ["User"]
`;
    const result = parseManifestToWizardData(strictYaml);
    assert.strictEqual(
      result.governance.workspaceTemplate,
      "strict-enterprise",
    );
  });

  it("falls back to modular-monolith for an architecture not in the catalog", () => {
    // `architecture` is a loose string in ManifestSchema, so an unrecognised
    // value reaches the mapping (rather than failing validation) and must
    // resolve to the flexible default via the catalog lookup.
    const unknownArchYaml = `
system: unknown-arch-test
scope: "@hexagen/test"
architecture: "totally-made-up"
bounded_contexts:
  - name: "UserContext"
    type: "core"
    description: "Users"
    layers:
      domain:
        entities: ["User"]
`;
    const result = parseManifestToWizardData(unknownArchYaml);
    assert.strictEqual(result.governance.workspaceTemplate, "modular-monolith");
  });

  it("accepts mixed-case enum values (e.g. type: Core)", () => {
    // Regression: LLM output such as `type: "Core"` previously threw
    // "Manifest validation failed: Invalid enum value... received 'Core'".
    const mixedCaseYaml = `
system: case-test
scope: "@hexagen/test"
architecture: "modular-monolith"
bounded_contexts:
  - name: "UserContext"
    type: "Core"
    description: "Handles user management"
    layers:
      domain:
        entities: ["User"]
`;
    const result = parseManifestToWizardData(mixedCaseYaml);
    assert.strictEqual(result.boundedContexts.length, 1);
    assert.strictEqual(result.boundedContexts[0].name, "UserContext");
  });

  it("accepts a lowercase relationship pattern (e.g. pattern: acl)", () => {
    // Relationship patterns are uppercase-canonical ("ACL", "U/D"), so a
    // lowercase `pattern: "acl"` must be normalized through the full
    // ManifestSchema -> BoundedContextSchema -> relationships parse path
    // (not just the isolated enum).
    const yamlWithRelationship = `
system: rel-test
scope: "@hexagen/test"
architecture: "modular-monolith"
bounded_contexts:
  - name: "OrdersContext"
    type: "core"
    description: "Orders"
    relationships:
      - context: "Catalog"
        pattern: "acl"
    layers:
      domain:
        entities: ["Order"]
`;
    const result = parseManifestToWizardData(yamlWithRelationship);
    assert.strictEqual(result.boundedContexts.length, 1);
    assert.strictEqual(result.boundedContexts[0].name, "OrdersContext");
  });

  it("should throw an error for empty YAML string", () => {
    assert.throws(
      () => parseManifestToWizardData(""),
      /Manifest string is empty/,
    );
  });

  it("should throw an error for invalid YAML", () => {
    assert.throws(
      () => parseManifestToWizardData("invalid: [unclosed bracket"),
      /Failed to parse YAML/,
    );
  });

  it("should handle missing optional fields gracefully", () => {
    const minimalManifestYaml = `
system: minimal-system
scope: "@hexagen/test"
architecture: "modular-monolith"
bounded_contexts:
  - name: "MinimalContext"
    type: "supporting"
    description: "A minimal context"
    layers: {}
`;
    const result = parseManifestToWizardData(minimalManifestYaml);
    assert.ok(result !== undefined);
    assert.strictEqual(result.boundedContexts[0].name, "MinimalContext");
    assert.deepStrictEqual(result.boundedContexts[0].coreDomainEntities, []);
    assert.deepStrictEqual(result.boundedContexts[0].useCases, []);
  });

  it("should map infrastructure adapters correctly", () => {
    const manifestWithAdapters = `
system: adapter-test
scope: "@hexagen/test"
architecture: "modular-monolith"
bounded_contexts:
  - name: "AdapterContext"
    type: "generic"
    description: "Context with adapters"
    layers:
      infrastructure:
        adapters: ["Prisma", "BullMQ"]
`;
    const result = parseManifestToWizardData(manifestWithAdapters);
    assert.strictEqual(result.boundedContexts[0].persistenceAdapter, "Prisma");
    assert.strictEqual(result.boundedContexts[0].messagingAdapter, "BullMQ");
  });

  it("should handle single adapter correctly", () => {
    const manifestWithSingleAdapter = `
system: single-adapter-test
scope: "@hexagen/test"
architecture: "modular-monolith"
bounded_contexts:
  - name: "SingleAdapterContext"
    type: "core"
    description: "Context with single adapter"
    layers:
      infrastructure:
        adapters: ["Prisma"]
`;
    const result = parseManifestToWizardData(manifestWithSingleAdapter);
    assert.strictEqual(result.boundedContexts[0].persistenceAdapter, "Prisma");
    assert.strictEqual(result.boundedContexts[0].messagingAdapter, "");
  });
});

// Schema-boundary contract for the case-insensitive enums (the normalization
// parseManifestToWizardData relies on). Lives in this gating suite because the
// @hexagen/project-configuration package's own test harness is non-gating.
describe("manifest enum casing", () => {
  it("normalizes lowercase-canonical enums to lower (type: Core -> core)", () => {
    assert.strictEqual(BoundedContextTypeSchema.parse("Core"), "core");
    assert.strictEqual(
      BoundedContextTypeSchema.parse("SHARED-KERNEL"),
      "shared-kernel",
    );
  });

  it("normalizes uppercase-canonical enums to upper (pattern: acl -> ACL)", () => {
    assert.strictEqual(RelationshipPatternSchema.parse("acl"), "ACL");
    assert.strictEqual(RelationshipPatternSchema.parse("u/d"), "U/D");
  });

  it("does not mask non-string enum values", () => {
    assert.throws(() => BoundedContextTypeSchema.parse(42));
  });

  it("trims surrounding whitespace before validating", () => {
    assert.strictEqual(BoundedContextTypeSchema.parse("  Core  "), "core");
    assert.strictEqual(RelationshipPatternSchema.parse(" acl "), "ACL");
  });
});
