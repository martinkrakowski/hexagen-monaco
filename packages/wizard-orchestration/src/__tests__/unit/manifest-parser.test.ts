import { describe, it, expect } from "vitest";
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
    expect(result).toBeDefined();
    expect(result.boundedContexts).toHaveLength(1);
    expect(result.boundedContexts[0].name).toBe("UserContext");
    expect(result.governance.workspaceName).toBe("test-system");
  });

  it("should throw an error for empty YAML string", () => {
    expect(() => parseManifestToWizardData("")).toThrow("Manifest string is empty");
  });

  it("should throw an error for invalid YAML", () => {
    expect(() => parseManifestToWizardData("invalid: [unclosed bracket")).toThrow(
      "Failed to parse YAML"
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
    expect(result).toBeDefined();
    expect(result.boundedContexts[0].name).toBe("MinimalContext");
    expect(result.boundedContexts[0].coreDomainEntities).toEqual([]);
    expect(result.boundedContexts[0].useCases).toEqual([]);
  });

  it("should map infrastructure adapters correctly", () => {
    const manifestWithAdapters = `
system: adapter-test
scope: "@hexagen/test"
architecture: "modular-monolith"
bounded_contexts:
  - name: "AdapterContext"
    type: "driver"
    description: "Context with adapters"
    layers:
      infrastructure:
        adapters: ["Prisma", "BullMQ"]
`;
    const result = parseManifestToWizardData(manifestWithAdapters);
    expect(result.boundedContexts[0].persistenceAdapter).toBe("Prisma");
    expect(result.boundedContexts[0].messagingAdapter).toBe("BullMQ");
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
    expect(result.boundedContexts[0].persistenceAdapter).toBe("Prisma");
    expect(result.boundedContexts[0].messagingAdapter).toBe("");
  });
});