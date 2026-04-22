import type { NodeVisualSpec } from "@hexagen/core-domain";
import type { VisualVariant } from "../../../domain/value-objects/visual-variant.js";

export interface NodeVisualProjection {
  readonly nodeId: string;
  readonly variant: VisualVariant;
  readonly label: string;
  readonly category: string;
}

export interface MapNodeVisualPort {
  map(
    spec: NodeVisualSpec,
    kind: string,
    category?: string,
  ): NodeVisualProjection;
}
