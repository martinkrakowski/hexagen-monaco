export type {
  LayoutConstraint,
  LayoutConstraintType,
  LayoutConstraintPayload,
  MinDistancePayload,
  MaxDistancePayload,
  AlignmentPayload,
  ContainmentPayload,
  AspectRatioPayload,
  GroupBoundaryPayload,
} from "./domain/value-objects/layout-constraint.js";
export type {
  Affordance,
  AffordanceSide,
} from "./domain/value-objects/affordance.js";
export type { StabilityScore } from "./domain/value-objects/stability-score.js";
export { createStabilityScore } from "./domain/value-objects/stability-score.js";
export type {
  LayoutResult,
  LayoutPosition,
  LayoutViolation,
} from "./domain/value-objects/layout-result.js";
export type { SolveLayoutPort } from "./application/ports/in/solve-layout.port.js";
export type { ResolveAffordancePort } from "./application/ports/in/resolve-affordance.port.js";
export type { ScoreStabilityPort } from "./application/ports/in/score-stability.port.js";
export type { DetectViolationsPort } from "./application/ports/in/detect-violations.port.js";
export { SolveLayoutUseCase } from "./application/use-cases/solve-layout.use-case.js";
export { ResolveAffordanceUseCase } from "./application/use-cases/resolve-affordance.use-case.js";
export { ScoreStabilityUseCase } from "./application/use-cases/score-stability.use-case.js";
export { DetectViolationsUseCase } from "./application/use-cases/detect-violations.use-case.js";

export { DagreLayoutSolverAdapter } from "./infrastructure/adapters/dagre-layout-solver.adapter.js";
export { DefaultAffordanceResolverAdapter } from "./infrastructure/adapters/default-affordance-resolver.adapter.js";
export { DefaultStabilityScorerAdapter } from "./infrastructure/adapters/default-stability-scorer.adapter.js";
export { DefaultViolationDetectorAdapter } from "./infrastructure/adapters/default-violation-detector.adapter.js";
