import type { NodeVisualSpec } from "@hexagen/core-domain";
import type {
  VisualVariant,
  VisualVariantCategory,
} from "../../../domain/value-objects/visual-variant.js";

export interface NodeVisualProjection {
  readonly nodeId: string;
  readonly variant: VisualVariant;
  readonly label: string;
  readonly category: VisualVariantCategory;
}

export interface MapNodeVisualPort {
  map(spec: NodeVisualSpec): NodeVisualProjection;
}
