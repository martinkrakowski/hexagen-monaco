import type { FeatureId } from "./feature-id.js";
import type { ReportPhase } from "./report-phase.js";
import type { Timestamp } from "./timestamp.js";
import { nextPhase as getNextPhase } from "./report-phase.js";
import { InvalidPhaseTransitionError } from "../errors.js";

export interface ReportManifest {
  readonly featureId: FeatureId;
  readonly currentPhase: ReportPhase;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly phaseHistory: ReadonlyArray<PhaseTransition>;
}

export interface PhaseTransition {
  readonly from: ReportPhase | null;
  readonly to: ReportPhase;
  readonly occurredAt: Timestamp;
}

export const createReportManifest = (
  featureId: FeatureId,
  initialPhase: ReportPhase,
  now: Timestamp,
): ReportManifest => ({
  featureId,
  currentPhase: initialPhase,
  createdAt: now,
  updatedAt: now,
  phaseHistory: [{ from: null, to: initialPhase, occurredAt: now }],
});

export const transitionManifestPhase = (
  manifest: ReportManifest,
  nextPhase: ReportPhase,
  now: Timestamp,
): ReportManifest => {
  const expected = getNextPhase(manifest.currentPhase);
  if (!expected || expected !== nextPhase) {
    throw new InvalidPhaseTransitionError(manifest.currentPhase, nextPhase);
  }
  return {
    ...manifest,
    currentPhase: nextPhase,
    updatedAt: now,
    phaseHistory: [
      ...manifest.phaseHistory,
      { from: manifest.currentPhase, to: nextPhase, occurredAt: now },
    ],
  };
};
