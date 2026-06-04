import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { wizardToManifest } from "../../application/wizard-to-manifest";

// Path 4 (the IDB load perimeter) preserves drifted/corrupt formState verbatim,
// so a malformed shape can reach wizardToManifest via generate/export. The
// conversion must tolerate it (coerce) rather than throw a 500.
const asWizard = (x: unknown) =>
  x as unknown as Parameters<typeof wizardToManifest>[0];

const bcNames = (manifest: Record<string, unknown>): unknown[] =>
  (manifest.bounded_contexts as Array<{ name: unknown }>).map((c) => c.name);

describe("wizardToManifest — tolerant of malformed wizardData (no 500)", () => {
  it("coerces a non-array boundedContexts instead of throwing", () => {
    assert.doesNotThrow(() =>
      wizardToManifest(asWizard({ boundedContexts: "not-an-array" })),
    );
  });

  it("drops boundedContexts entries that aren't named objects, keeps valid ones", () => {
    const manifest = wizardToManifest(
      asWizard({
        boundedContexts: [
          { id: "ok", name: "Billing" },
          { id: "noname" }, // no string name → unbuildable, dropped
          null,
          "garbage",
        ],
      }),
    );
    const names = bcNames(manifest);
    assert.ok(names.includes("Billing"), "valid context kept");
    assert.ok(names.includes("shared"), "shared still auto-injected");
    assert.ok(
      !names.includes(undefined),
      "no nameless junk leaked into the manifest",
    );
  });

  it("coerces a non-array peerMappings instead of throwing", () => {
    assert.doesNotThrow(() =>
      wizardToManifest(
        asWizard({
          boundedContexts: [{ id: "a", name: "A" }],
          peerMappings: "nope",
        }),
      ),
    );
  });
});
