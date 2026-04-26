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

// Application ports (type-only)
export type {
  MapNodeVisualPort,
  NodeVisualProjection,
} from "./application/ports/in/map-node-visual.port.js";
export type { ResolveVariantPort } from "./application/ports/in/resolve-variant.port.js";

// Application use cases
export { MapNodeVisualUseCase } from "./application/use-cases/map-node-visual.use-case.js";

// Infrastructure adapters
export { CvaVariantResolverAdapter } from "./infrastructure/adapters/cva-variant-resolver.adapter.js";
export { DefaultNodeVisualMapperAdapter } from "./infrastructure/adapters/default-node-visual-mapper.adapter.js";
