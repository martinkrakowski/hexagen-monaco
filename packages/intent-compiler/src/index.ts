// Application ports
export type { GestureParserPort } from "./application/ports/in/gesture-parser.port.js";
export type { TopologyCheckerPort } from "./application/ports/in/topology-checker.port.js";
export type { CardinalityCheckerPort } from "./application/ports/in/cardinality-checker.port.js";
export type { RejectEmitterPort } from "./application/ports/in/reject-emitter.port.js";

// Application use cases
export { ParseGestureUseCase } from "./application/use-cases/parse-gesture.use-case.js";
export { ValidateTopologyUseCase } from "./application/use-cases/validate-topology.use-case.js";
export { ValidateCardinalityUseCase } from "./application/use-cases/validate-cardinality.use-case.js";
export { EmitRejectionUseCase } from "./application/use-cases/emit-rejection.use-case.js";

// Domain entities
export { Gesture } from "./domain/gesture.js";
export { Rejection } from "./domain/rejection.js";

// Domain value objects
export type { ParsedGesture } from "./domain/value-objects/parsed-gesture.js";
export type { TopologyCheckResult } from "./domain/value-objects/topology-check-result.js";
export type { CardinalityCheckResult } from "./domain/value-objects/cardinality-check-result.js";

// Infrastructure adapters
export { ManifestAwareGestureParserAdapter } from "./infrastructure/adapters/manifest-aware-gesture-parser.adapter.js";
export { TopologyValidatorAdapter } from "./infrastructure/adapters/topology-validator.adapter.js";
export { CardinalityValidatorAdapter } from "./infrastructure/adapters/cardinality-validator.adapter.js";
export { ConsoleRejectEmitterAdapter } from "./infrastructure/adapters/console-reject-emitter.adapter.js";
