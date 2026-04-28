import type { FeatureId } from "../../value-objects/feature-id.js";
import type { ReportPhase } from "../../value-objects/report-phase.js";
import type { Timestamp } from "../../value-objects/timestamp.js";
import type { ReportManifest } from "../../value-objects/report-manifest.js";
import { transitionManifestPhase } from "../../value-objects/report-manifest.js";

export interface FeatureReport {
  readonly id: FeatureId;
  readonly currentPhase: ReportPhase;
  readonly manifest: ReportManifest;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export const createFeatureReport = (
  id: FeatureId,
  phase: ReportPhase,
  manifest: ReportManifest,
  now: Timestamp,
): FeatureReport => ({
  id,
  currentPhase: phase,
  manifest,
  createdAt: now,
  updatedAt: now,
});

export const advancePhase = (
  report: FeatureReport,
  nextPhase: ReportPhase,
  now: Timestamp,
): FeatureReport => ({
  ...report,
  currentPhase: nextPhase,
  manifest: transitionManifestPhase(report.manifest, nextPhase, now),
  updatedAt: now,
});
