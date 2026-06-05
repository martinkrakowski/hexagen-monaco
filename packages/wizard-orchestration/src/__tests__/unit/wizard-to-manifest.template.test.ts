import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { wizardToManifest } from "../../application/wizard-to-manifest";

// The architectural template selected on wizard step 1 drives cross-context
// wiring: a "flexible" (in-process) template keeps direct peer dependencies in
// `depends_on`, while strict templates (event-bus / network) omit them so
// contexts integrate across a boundary instead of importing each other. The
// behaviour is keyed off the template's *rules*, not a hardcoded id list, so an
// unknown id degrades to the flexible default rather than throwing. See
// docs/planning/wire-architectural-template-into-generation.md (Phase 1).

const asWizard = (x: unknown) =>
  x as unknown as Parameters<typeof wizardToManifest>[0];

// Two contexts with a peer mapping: consumer (orders) → provider (billing).
const wizardWithPeer = (template: string) =>
  asWizard({
    governance: {
      workspaceName: "demo",
      namespacePrefix: "@demo",
      packageManager: "yarn",
      workspaceTemplate: template,
    },
    boundedContexts: [
      { id: "orders-id", name: "orders" },
      { id: "billing-id", name: "billing" },
    ],
    peerMappings: [
      { consumerContext: "orders-id", providerContext: "billing-id" },
    ],
  });

const dependsOnFor = (
  manifest: Record<string, unknown>,
  name: string,
): string[] => {
  const bc = (
    manifest.bounded_contexts as Array<{ name: string; depends_on: string[] }>
  ).find((c) => c.name === name);
  assert.ok(bc, `expected a "${name}" context in the manifest`);
  return bc.depends_on;
};

describe("wizardToManifest — architectural template drives cross-context wiring", () => {
  it("modular-monolith (in-process) keeps the direct peer dependency", () => {
    const out = wizardToManifest(wizardWithPeer("modular-monolith"));
    assert.equal(out.architecture, "modular-monolith");
    assert.equal(out.workspaceTemplate, "modular-monolith");
    assert.ok(
      dependsOnFor(out, "orders").includes("billing"),
      "flexible template keeps the direct peer dependency",
    );
  });

  for (const strict of ["strict-enterprise", "micro-frontend"] as const) {
    it(`${strict} (boundary) drops the direct peer dependency`, () => {
      const out = wizardToManifest(wizardWithPeer(strict));
      assert.equal(out.architecture, strict);
      assert.ok(
        !dependsOnFor(out, "orders").includes("billing"),
        "strict template omits the direct peer dependency",
      );
      // `shared` is still injected as a universal dependency for every context.
      assert.ok(
        dependsOnFor(out, "orders").includes("shared"),
        "shared dependency is still present under a strict template",
      );
    });
  }

  it("an unknown template id degrades to flexible (keeps peer deps) without throwing", () => {
    let out: Record<string, unknown> | undefined;
    assert.doesNotThrow(() => {
      out = wizardToManifest(wizardWithPeer("totally-made-up"));
    });
    assert.ok(out, "manifest produced for an unknown template id");
    assert.ok(
      dependsOnFor(out, "orders").includes("billing"),
      "unknown id falls back to in-process semantics (peer dep kept)",
    );
  });
});
