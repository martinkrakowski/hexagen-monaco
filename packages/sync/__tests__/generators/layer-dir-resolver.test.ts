import { describe, it } from "vitest";
import assert from "node:assert";
import {
  normalizeSubfolder,
  resolveEmissionDir,
  resolveLayerDir,
} from "../../src/domain/services/layer-dir-resolver.js";

// A2 — THE single layer-folder resolver. Every consumer that turns a
// (layer, site) pair into an on-disk directory (emission plan, stub
// placement, related-port probe, layer-folder scaffold) goes through it, so
// these pins ARE the placement contract.

describe("resolveLayerDir", () => {
  it("falls back to the src/<layer>/<site> convention without config", () => {
    assert.equal(resolveLayerDir(undefined, "domain"), "src/domain");
    assert.equal(
      resolveLayerDir(undefined, "application", "ports/in"),
      "src/application/ports/in",
    );
    assert.equal(
      resolveLayerDir({}, "infrastructure", "adapters"),
      "src/infrastructure/adapters",
    );
  });

  it("uses the configured layer folder (the A2 seam)", () => {
    const layers = {
      application: { folder: "src/app" },
      domain: { folder: "src/core-domain" },
    };
    assert.equal(
      resolveLayerDir(layers, "application", "ports/out"),
      "src/app/ports/out",
    );
    assert.equal(
      resolveLayerDir(layers, "domain", "entities"),
      "src/core-domain/entities",
    );
    // Unconfigured layer still falls back to convention.
    assert.equal(
      resolveLayerDir(layers, "infrastructure", "adapters"),
      "src/infrastructure/adapters",
    );
  });

  it("normalizes known-site subfolder spellings to the kebab convention (F16)", () => {
    // The wizard's layer config names `value_objects`; the on-disk
    // convention (stub emission, add-on template payloads and their import
    // specifiers, this monorepo's own layout) is `value-objects`.
    assert.equal(
      resolveLayerDir(undefined, "domain", "value_objects"),
      "src/domain/value-objects",
    );
    assert.equal(
      resolveLayerDir(undefined, "application", "use_cases"),
      "src/application/use-cases",
    );
  });

  it("rejects traversal/absolute configured folders (falls back to convention)", () => {
    // Manifests reach this code unvalidated via /api/generate — same
    // traversal posture as the SyncEngine module-name guard.
    for (const folder of ["../evil", "src/../../evil", "/abs/path", ""]) {
      assert.equal(
        resolveLayerDir({ domain: { folder } }, "domain"),
        "src/domain",
        `folder ${JSON.stringify(folder)} must fall back`,
      );
    }
  });
});

describe("normalizeSubfolder", () => {
  it("collapses hyphen/underscore/case variants of KNOWN sites", () => {
    assert.equal(normalizeSubfolder("value_objects"), "value-objects");
    assert.equal(normalizeSubfolder("value-objects"), "value-objects");
    assert.equal(normalizeSubfolder("Use_Cases"), "use-cases");
    assert.equal(normalizeSubfolder("ports/in"), "ports/in");
  });

  it("passes genuinely custom subfolders through verbatim", () => {
    assert.equal(normalizeSubfolder("policies"), "policies");
    assert.equal(normalizeSubfolder("Sagas"), "Sagas");
  });
});

describe("resolveEmissionDir", () => {
  it("splits an emission site into (layer, subfolder) and resolves", () => {
    assert.equal(
      resolveEmissionDir(undefined, "domain/value-objects"),
      "src/domain/value-objects",
    );
    assert.equal(
      resolveEmissionDir(
        { application: { folder: "src/app" } },
        "application/ports/in",
      ),
      "src/app/ports/in",
    );
  });
});
