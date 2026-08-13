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

describe("usePendingManifest — validationReport semantics", () => {
  const report = { errors: [], warnings: ["[R04] note"], passed: true };

  beforeEach(() => {
    usePendingManifest.getState().clear();
  });

  it("set() stores the server report alongside the yaml it validated", () => {
    usePendingManifest
      .getState()
      .set("yaml: x", spec, "proj", "/projects/new/import/spec", null, report);
    assert.deepStrictEqual(
      usePendingManifest.getState().validationReport,
      report,
    );
  });

  it("set() without a report resets a previous one (no cross-manifest leak)", () => {
    usePendingManifest
      .getState()
      .set("yaml: x", spec, "proj", "/projects/new/import/spec", null, report);
    usePendingManifest
      .getState()
      .set("yaml: y", spec, "proj2", "/projects/new/import/spec");
    assert.strictEqual(usePendingManifest.getState().validationReport, null);
  });

  it("updateYaml() clears the report (stale-report guard: any edit re-arms the client fixer) but NOT originSession", () => {
    usePendingManifest.getState().setOriginSession(provenance);
    usePendingManifest
      .getState()
      .set("yaml: x", spec, "proj", "/projects/new/import/spec", null, report);
    usePendingManifest.getState().updateYaml("yaml: edited");

    const state = usePendingManifest.getState();
    assert.strictEqual(state.yaml, "yaml: edited");
    // The report vouched only for the pre-edit YAML — the accept view's
    // auto-fixer gate keys on this being null again.
    assert.strictEqual(state.validationReport, null);
    // The set()/updateYaml "don't touch originSession" contract holds.
    assert.deepStrictEqual(state.originSession, provenance);
  });

  it("clear() clears the report with everything else", () => {
    usePendingManifest
      .getState()
      .set("yaml: x", spec, "proj", "/projects/new/import/spec", null, report);
    usePendingManifest.getState().clear();
    assert.strictEqual(usePendingManifest.getState().validationReport, null);
  });
});
