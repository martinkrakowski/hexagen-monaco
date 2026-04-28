import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createReportManifest,
  transitionManifestPhase,
} from "../../../src/domain/value-objects/report-manifest.js";
import { createFeatureId } from "../../../src/domain/value-objects/feature-id.js";
import { createTimestamp } from "../../../src/domain/value-objects/timestamp.js";

describe("createReportManifest", () => {
  it("creates manifest with correct initial phase", () => {
    const id = createFeatureId("test-feature");
    const now = createTimestamp(1000);
    const manifest = createReportManifest(id, "01-blueprint", now);
    assert.strictEqual(manifest.currentPhase, "01-blueprint");
    assert.strictEqual(manifest.featureId, id);
  });

  it("includes initial phase in phaseHistory", () => {
    const id = createFeatureId("test-feature");
    const now = createTimestamp(1000);
    const manifest = createReportManifest(id, "01-blueprint", now);
    assert.strictEqual(manifest.phaseHistory.length, 1);
    assert.strictEqual(manifest.phaseHistory[0].from, null);
    assert.strictEqual(manifest.phaseHistory[0].to, "01-blueprint");
    assert.strictEqual(manifest.phaseHistory[0].occurredAt, now);
  });
});

describe("transitionManifestPhase", () => {
  it("updates currentPhase", () => {
    const id = createFeatureId("test-feature");
    const now = createTimestamp(1000);
    const manifest = createReportManifest(id, "01-blueprint", now);
    const later = createTimestamp(2000);
    const transitioned = transitionManifestPhase(
      manifest,
      "02-implementation",
      later,
    );
    assert.strictEqual(transitioned.currentPhase, "02-implementation");
  });

  it("appends to phaseHistory", () => {
    const id = createFeatureId("test-feature");
    const now = createTimestamp(1000);
    const manifest = createReportManifest(id, "01-blueprint", now);
    const later = createTimestamp(2000);
    const transitioned = transitionManifestPhase(
      manifest,
      "02-implementation",
      later,
    );
    assert.strictEqual(transitioned.phaseHistory.length, 2);
    const last = transitioned.phaseHistory[1];
    assert.strictEqual(last.from, "01-blueprint");
    assert.strictEqual(last.to, "02-implementation");
    assert.strictEqual(last.occurredAt, later);
  });

  it("updates updatedAt", () => {
    const id = createFeatureId("test-feature");
    const now = createTimestamp(1000);
    const manifest = createReportManifest(id, "01-blueprint", now);
    const later = createTimestamp(2000);
    const transitioned = transitionManifestPhase(
      manifest,
      "02-implementation",
      later,
    );
    assert.strictEqual(transitioned.updatedAt, later);
  });
});
