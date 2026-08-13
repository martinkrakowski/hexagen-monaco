import { describe, it } from "vitest";
import assert from "node:assert";
import yaml from "js-yaml";
import type { WizardData } from "@hexagen/project-configuration";
import { IMPORTED_MANIFEST_CORRUPT_MESSAGE } from "../../../app/lib/imported-manifest";
import { resolveArchitectureManifestYaml } from "./useArchitectureDownload";

// Minimal wizard-authored data that wizardToManifest accepts (mirrors the
// useProjectGenerationFlow test fixture).
const wizardAuthored = {
  governance: {
    workspaceName: "test-ws",
    workspaceTemplate: "modular-monolith",
    packageManager: "yarn",
    topologyStrictness: "flexible",
    namespacePrefix: "@hexagen",
    namingConventions: {
      contextDirectoryPattern: "packages/",
      adapterSuffix: ".adapter.ts",
    },
  },
  boundedContexts: [
    {
      id: "ctx-1",
      name: "core",
      description: "",
      infrastructureTarget: "nestjs",
      coreDomainEntities: [],
      valueObjects: [],
      domainEvents: [],
      entities: [],
      useCases: [],
      portConfiguration: { inboundPorts: [], outboundPorts: [] },
      uiFramework: "",
      persistenceAdapter: "",
      messagingAdapter: "",
      telemetryProvider: "",
    },
  ],
  externalContexts: [],
  peerMappings: [],
  addOnsAnswers: {},
} as unknown as WizardData;

const importedWizardData = {
  ...wizardAuthored,
  manifestSource: "imported",
} as unknown as WizardData;

// Formatting quirks (comment, single-quoted scalar) that a parse→re-dump
// round-trip would destroy — the verbatim contract is what preserves them.
const savedYaml = [
  "# hand-written header comment",
  "system: 'shop'",
  "bounded_contexts:",
  "  - name: billing",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [ProcessPaymentPort]",
  "",
].join("\n");

describe("resolveArchitectureManifestYaml", () => {
  it("returns the saved YAML VERBATIM for an imported project (no re-dump churn)", () => {
    const result = resolveArchitectureManifestYaml(
      importedWizardData,
      savedYaml,
    );
    assert.ok(result.ok);
    assert.strictEqual(result.yamlContent, savedYaml);
  });

  it("fails closed for an imported project with corrupt saved YAML", () => {
    for (const bad of ["a: [unclosed", "", null, undefined, "system: only\n"]) {
      const result = resolveArchitectureManifestYaml(importedWizardData, bad);
      assert.ok(!result.ok, `expected fail-closed for ${JSON.stringify(bad)}`);
      assert.strictEqual(result.message, IMPORTED_MANIFEST_CORRUPT_MESSAGE);
    }
  });

  it("dumps the wizardToManifest projection for wizard-authored data (savedManifestYaml ignored)", () => {
    // Pass a saved YAML too: without the "imported" marker it must be ignored
    // (live-first wizard path unchanged).
    const result = resolveArchitectureManifestYaml(wizardAuthored, savedYaml);
    assert.ok(result.ok);
    assert.notStrictEqual(result.yamlContent, savedYaml);
    const parsed = yaml.load(result.yamlContent) as Record<string, unknown>;
    const contexts = parsed.bounded_contexts as Array<{ name: string }>;
    // wizardToManifest prepends its emitted shared context, so search by name
    // rather than asserting on index 0.
    assert.ok(contexts.some((c) => c.name === "core"));
  });
});
