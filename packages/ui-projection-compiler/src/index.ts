// Domain value objects
export type {
  VisualVariant,
  VisualVariantCategory,
} from "./domain/value-objects/visual-variant.js";
export {
  categoryFromNodeKind,
  categoryFromSideAndLabel,
} from "./domain/value-objects/visual-variant.js";
export type {
  HexagonNodeType,
  HexagonSide,
} from "./domain/value-objects/node-kind-resolver.js";
export { nodeKindFromHexagonType } from "./domain/value-objects/node-kind-resolver.js";
export type { IconMapping } from "./domain/value-objects/icon-mapping.js";
export {
  DEFAULT_ICON_MAPPINGS,
  findIconMapping,
} from "./domain/value-objects/icon-mapping.js";
export type {
  ProjectionError,
  ProjectionErrorType,
} from "./domain/value-objects/projection-error.js";
export { createProjectionError } from "./domain/value-objects/projection-error.js";
export type { ProjectionValidationResult } from "./domain/value-objects/projection-validation-result.js";
export { createValidationResult } from "./domain/value-objects/projection-validation-result.js";

// Application ports (type-only)
export type {
  MapNodeVisualPort,
  NodeVisualProjection,
} from "./application/ports/in/map-node-visual.port.js";
export type { ResolveVariantPort } from "./application/ports/in/resolve-variant.port.js";
export type { ResolveIconPort } from "./application/ports/in/resolve-icon.port.js";
export type {
  ProjectAffordancePort,
  ProjectedAffordance,
} from "./application/ports/in/project-affordance.port.js";
export type { CheckRealizabilityPort } from "./application/ports/in/check-realizability.port.js";
export type { CheckAffordanceCompatibilityPort } from "./application/ports/in/check-affordance-compatibility.port.js";

// Application use cases
export { MapNodeVisualUseCase } from "./application/use-cases/map-node-visual.use-case.js";
export { ResolveVariantUseCase } from "./application/use-cases/resolve-variant.use-case.js";
export { ResolveIconUseCase } from "./application/use-cases/resolve-icon.use-case.js";
export { ProjectAffordanceUseCase } from "./application/use-cases/project-affordance.use-case.js";
export { CheckRealizabilityUseCase } from "./application/use-cases/check-realizability.use-case.js";
export { CheckAffordanceCompatibilityUseCase } from "./application/use-cases/check-affordance-compatibility.use-case.js";

// Infrastructure adapters
export { CvaVariantResolverAdapter } from "./infrastructure/adapters/cva-variant-resolver.adapter.js";
export { DefaultIconResolverAdapter } from "./infrastructure/adapters/default-icon-resolver.adapter.js";
export { DefaultNodeVisualMapperAdapter } from "./infrastructure/adapters/default-node-visual-mapper.adapter.js";
export { DefaultAffordanceProjectorAdapter } from "./infrastructure/adapters/default-affordance-projector.adapter.js";
export { DefaultRealizabilityCheckerAdapter } from "./infrastructure/adapters/default-realizability-checker.adapter.js";
export { DefaultAffordanceCompatibilityAdapter } from "./infrastructure/adapters/default-affordance-compatibility.adapter.js";
