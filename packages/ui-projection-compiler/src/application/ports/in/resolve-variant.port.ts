import type {
  VisualVariant,
  VisualVariantCategory,
} from "../../../domain/value-objects/visual-variant.js";

export interface ResolveVariantPort {
  resolve(category: VisualVariantCategory): VisualVariant;
}
