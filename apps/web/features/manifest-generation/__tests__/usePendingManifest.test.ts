import { describe, it, beforeEach } from "vitest";
import assert from "node:assert";
import type { ProjectSpec } from "@hexagen/project-configuration";

import { usePendingManifest } from "../store/usePendingManifest";

const spec = {} as ProjectSpec;

const provenance = {
  specText: "name: from-session",
  turns: [{ id: "t1", author: "You", content: "brief" }],
  sourceProjectId: "p1",
  sourceLayerId: "L1",
};

describe("usePendingManifest — originSession semantics", () => {
  beforeEach(() => {
    usePendingManifest.getState().clear();
  });

  it("set() does NOT touch originSession (finalize hand-off runs BEFORE the import flow calls set())", () => {
    usePendingManifest.getState().setOriginSession(provenance);
    usePendingManifest
      .getState()
      .set("yaml: x", spec, "proj", "/projects/new/import/spec", "spec text");

    const state = usePendingManifest.getState();
    assert.deepStrictEqual(state.originSession, provenance);
    assert.strictEqual(state.originSpecText, "spec text");
  });

  it("clear() clears originSession with everything else (no cross-project leak)", () => {
    usePendingManifest.getState().setOriginSession(provenance);
    usePendingManifest.getState().clear();
    assert.strictEqual(usePendingManifest.getState().originSession, null);
  });

  it("setOriginSession(null) discards a stale provenance explicitly", () => {
    usePendingManifest.getState().setOriginSession(provenance);
    usePendingManifest.getState().setOriginSession(null);
    assert.strictEqual(usePendingManifest.getState().originSession, null);
  });
});
