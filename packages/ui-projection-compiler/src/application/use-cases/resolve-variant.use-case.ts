import type {
  VisualVariant,
  VisualVariantCategory,
} from "../../domain/value-objects/visual-variant.js";
import type { ResolveVariantPort } from "../ports/in/resolve-variant.port.js";

export class ResolveVariantUseCase {
  constructor(private readonly resolver: ResolveVariantPort) {}

  execute(category: VisualVariantCategory): VisualVariant {
    return this.resolver.resolve(category);
  }
}
