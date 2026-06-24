import { describe, it } from "vitest";
import assert from "node:assert";
import {
  createFeatureReport,
  advancePhase,
} from "../../../src/domain/model/feature-report/feature-report.js";
import { createFeatureId } from "../../../src/domain/value-objects/feature-id.js";
import { createReportManifest } from "../../../src/domain/value-objects/report-manifest.js";
import { createTimestamp } from "../../../src/domain/value-objects/timestamp.js";

describe("createFeatureReport", () => {
  it("creates report with correct fields", () => {
    const id = createFeatureId("my-feature");
    const now = createTimestamp(1000);
    const manifest = createReportManifest(id, "01-blueprint", now);
    const report = createFeatureReport(id, "01-blueprint", manifest, now);
    assert.strictEqual(report.id, id);
    assert.strictEqual(report.currentPhase, "01-blueprint");
    assert.strictEqual(report.manifest, manifest);
    assert.strictEqual(report.createdAt, now);
    assert.strictEqual(report.updatedAt, now);
  });
});

describe("advancePhase", () => {
  it("transitions phase correctly", () => {
    const id = createFeatureId("my-feature");
    const now = createTimestamp(1000);
    const manifest = createReportManifest(id, "01-blueprint", now);
    const report = createFeatureReport(id, "01-blueprint", manifest, now);
    const later = createTimestamp(2000);
    const advanced = advancePhase(report, "02-implementation", later);
    assert.strictEqual(advanced.currentPhase, "02-implementation");
  });

  it("updates manifest via transitionManifestPhase", () => {
    const id = createFeatureId("my-feature");
    const now = createTimestamp(1000);
    const manifest = createReportManifest(id, "01-blueprint", now);
    const report = createFeatureReport(id, "01-blueprint", manifest, now);
    const later = createTimestamp(2000);
    const advanced = advancePhase(report, "02-implementation", later);
    assert.strictEqual(advanced.manifest.currentPhase, "02-implementation");
    assert.strictEqual(advanced.manifest.phaseHistory.length, 2);
  });
});
