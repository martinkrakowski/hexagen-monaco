import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
