import type {
  VisualVariant,
  VisualVariantCategory,
} from "../../src/domain/value-objects/visual-variant.js";
import type { ResolveVariantPort } from "../../src/application/ports/in/resolve-variant.port.js";

export class FakeVariantResolver implements ResolveVariantPort {
  readonly calls: VisualVariantCategory[] = [];

  constructor(
    private readonly fixedVariant: VisualVariant = {
      category: "default",
      headerBg: "fake-header-bg",
      bodyBg: "fake-body-bg",
      border: "fake-border",
      handleColor: "fake-handle",
      headerText: "fake-text",
      hexColor: "#000000",
    },
  ) {}

  resolve(category: VisualVariantCategory): VisualVariant {
    this.calls.push(category);
    return { ...this.fixedVariant, category };
  }
}
