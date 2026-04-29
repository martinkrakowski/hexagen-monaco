import type { NodeVisualSpec } from "@hexagen/core-domain";
import { NodeKind } from "@hexagen/core-domain";
import type {
  MapNodeVisualPort,
  NodeVisualProjection,
} from "../../application/ports/in/map-node-visual.port.js";
import type { ResolveVariantPort } from "../../application/ports/in/resolve-variant.port.js";
import type { VisualVariantCategory } from "../../domain/value-objects/visual-variant.js";
import { categoryFromNodeKind } from "../../domain/value-objects/visual-variant.js";

/**
 * DefaultNodeVisualMapperAdapter — maps a NodeVisualSpec + kind + category
 * hint to a NodeVisualProjection by delegating category resolution.
 *
 * Replaces the hard-coded PORT_CATEGORY_COLORS branching in BoundedContext.tsx.
 */
export class DefaultNodeVisualMapperAdapter implements MapNodeVisualPort {
  constructor(private readonly variantResolver: ResolveVariantPort) {}

  map(spec: NodeVisualSpec): NodeVisualProjection {
    const kind = spec.kind;
    const category = spec.category;
    const resolvedCategory = this.resolveCategory(kind, category);
    const variant = this.variantResolver.resolve(resolvedCategory);
    return {
      nodeId: spec.nodeId,
      variant,
      label: spec.label,
      category: resolvedCategory,
    };
  }

  private resolveCategory(
    kind: NodeKind,
    category: string | undefined,
  ): VisualVariantCategory {
    if (category) {
      const normalized = category.toLowerCase() as VisualVariantCategory;
      const known: VisualVariantCategory[] = [
        "driving",
        "driven",
        "presentation",
        "infrastructure",
        "entity",
        "value-object",
        "port",
        "use-case",
        "adapter",
        "domain-event",
        "policy",
        "aggregate",
        "service",
        "primary-adapter",
        "primary-port",
        "secondary-adapter",
        "secondary-port",
        "default",
      ];
      if (known.includes(normalized)) {
        return normalized;
      }
    }

    return categoryFromNodeKind(kind);
  }
}
