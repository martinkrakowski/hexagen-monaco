import type { NodeVisualSpec } from "@hexagen/core-domain";
import type {
  MapNodeVisualPort,
  NodeVisualProjection,
} from "../../application/ports/in/map-node-visual.port.js";
import type { ResolveVariantPort } from "../../application/ports/in/resolve-variant.port.js";
import type { VisualVariantCategory } from "../../domain/value-objects/visual-variant.js";
import { categoryFromSideAndLabel } from "../../domain/value-objects/visual-variant.js";

/**
 * DefaultNodeVisualMapperAdapter — maps a NodeVisualSpec + kind + category
 * hint to a NodeVisualProjection by delegating category resolution.
 *
 * Replaces the hard-coded PORT_CATEGORY_COLORS branching in BoundedContext.tsx.
 */
export class DefaultNodeVisualMapperAdapter implements MapNodeVisualPort {
  constructor(private readonly variantResolver: ResolveVariantPort) {}

  map(
    spec: NodeVisualSpec,
    kind: string,
    category?: string,
  ): NodeVisualProjection {
    const resolvedCategory = this.resolveCategory(kind, category);
    const variant = this.variantResolver.resolve(resolvedCategory);
    return {
      nodeId: spec.nodeId,
      variant,
      label: "",
      category: resolvedCategory,
    };
  }

  private resolveCategory(
    kind: string,
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
        "default",
      ];
      if (known.includes(normalized)) {
        return normalized;
      }
    }

    const lowerKind = kind.toLowerCase();
    if (lowerKind === "entity" || lowerKind === "aggregate") return "entity";
    if (lowerKind === "valueobject" || lowerKind === "value-object")
      return "value-object";
    if (lowerKind === "port") return "port";
    if (lowerKind === "usecase" || lowerKind === "use-case") return "use-case";
    if (lowerKind === "adapter") return "adapter";
    if (lowerKind === "domainevent" || lowerKind === "domain-event")
      return "domain-event";
    if (lowerKind === "policy") return "policy";
    if (lowerKind === "service") return "service";
    if (lowerKind === "controller" || lowerKind === "presenter")
      return "presentation";
    if (lowerKind === "repository" || lowerKind === "persistenceadapter")
      return "infrastructure";

    return categoryFromSideAndLabel(undefined, kind);
  }
}
