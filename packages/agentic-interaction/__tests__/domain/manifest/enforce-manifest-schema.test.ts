import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { enforceManifestSchema } from "../../../src/domain/manifest/enforce-manifest-schema";
import type { ManifestOutput } from "../../../src/domain/manifest/draft-to-manifest.transform";
import { renderManifestYaml } from "../../../src/domain/manifest/render-yaml";
import { ManifestSchema } from "@hexagen/project-configuration";
import yaml from "js-yaml";

/**
 * The gate's contract: whatever LLM-derived garbage lands in `apps`,
 * `context_mappings`, or the domain/port string lists, the manifest it leaves
 * behind passes the SAME strict ManifestSchema the accept screen parses with
 * (parseManifestToWizardData) — and every change is reported, never silent.
 * Regression for the alvaro-ai import: pipeline succeeded, accept screen threw
 * "could not be parsed".
 */

function baseManifest(): ManifestOutput {
  return {
    workspace: { name: "alvaro-ai", description: "Batch image upscaler" },
    system: "alvaro-ai",
    scope: "alvaro",
    architecture: "modular-monolith",
    bounded_contexts: [
      {
        name: "image-domain",
        type: "core",
        description: "Core image entities",
        layers: {
          domain: {},
          application: { ports: { in: ["UploadImagePort"], out: undefined } },
          infrastructure: {},
        },
      },
    ],
    apps: [],
  };
}

/** Round-trip through the real renderer, then the accept screen's parse. */
function acceptScreenParses(manifest: ManifestOutput): {
  ok: boolean;
  issues?: string;
} {
  const rendered = renderManifestYaml(manifest);
  const result = ManifestSchema.safeParse(yaml.load(rendered));
  return result.success
    ? { ok: true }
    : { ok: false, issues: result.error.message };
}

describe("enforceManifestSchema", () => {
  it("leaves a clean manifest untouched with no advisories", () => {
    const manifest = baseManifest();
    const before = JSON.stringify(manifest);
    const gate = enforceManifestSchema(manifest);
    assert.equal(JSON.stringify(manifest), before);
    assert.deepEqual(gate.advisories, []);
    assert.deepEqual(gate.residualIssues, []);
  });

  it("coerces bare-string app entries and drops nameless ones", () => {
    const manifest = baseManifest();
    manifest.apps = [
      "web",
      { framework: "next.js" }, // no name → dropped
      { name: "api", framework: "nitro" },
      42,
    ];
    const gate = enforceManifestSchema(manifest);
    assert.deepEqual(manifest.apps, [
      { name: "web" },
      { name: "api", framework: "nitro" },
    ]);
    assert.equal(gate.advisories.length, 3);
    assert.deepEqual(gate.residualIssues, []);
    assert.equal(acceptScreenParses(manifest).ok, true);
  });

  it("drops context mappings missing an endpoint", () => {
    const manifest = baseManifest();
    manifest.context_mappings = [
      { upstream: "image-domain", downstream: "web-ui" },
      { upstream: "image-domain" } as never, // missing downstream
      { downstream: "web-ui" } as never, // missing upstream
    ];
    const gate = enforceManifestSchema(manifest);
    assert.deepEqual(manifest.context_mappings, [
      { upstream: "image-domain", downstream: "web-ui" },
    ]);
    assert.equal(gate.advisories.length, 2);
    assert.deepEqual(gate.residualIssues, []);
    assert.equal(acceptScreenParses(manifest).ok, true);
  });

  it("filters nameless entries from domain and port string lists", () => {
    const manifest = baseManifest();
    manifest.bounded_contexts[0].layers.domain = {
      // A nameless aggregate upstream renders as `- null` in YAML — the exact
      // shape that fails the accept parse with "Expected string, received null".
      entities: ["UpscaleJob", undefined as never],
      value_objects: [null as never, "UpscaleSettings"],
    };
    manifest.bounded_contexts[0].layers.application = {
      ports: { in: ["UploadImagePort", 7 as never], out: ["ImageRepository"] },
    };
    const gate = enforceManifestSchema(manifest);
    assert.deepEqual(manifest.bounded_contexts[0].layers.domain, {
      entities: ["UpscaleJob"],
      value_objects: ["UpscaleSettings"],
    });
    assert.deepEqual(manifest.bounded_contexts[0].layers.application?.ports, {
      in: ["UploadImagePort"],
      out: ["ImageRepository"],
    });
    assert.equal(gate.advisories.length, 3);
    assert.deepEqual(gate.residualIssues, []);
    assert.equal(acceptScreenParses(manifest).ok, true);
  });

  it("reports residual issues it cannot sanitize instead of hiding them", () => {
    const manifest = baseManifest();
    // An unknown top-level key is outside the gate's deterministic fixes —
    // the strict schema rejects it and the gate must SAY so.
    (manifest as unknown as Record<string, unknown>).planes_extra = {};
    const gate = enforceManifestSchema(manifest);
    assert.equal(gate.residualIssues.length, 1);
    assert.match(gate.residualIssues[0], /planes_extra/);
  });

  it("formats residual issues with their field path", () => {
    const manifest = baseManifest();
    manifest.bounded_contexts[0].description = null as never;
    const gate = enforceManifestSchema(manifest);
    assert.equal(gate.residualIssues.length, 1);
    assert.match(gate.residualIssues[0], /bounded_contexts\.0\.description/);
  });
});
