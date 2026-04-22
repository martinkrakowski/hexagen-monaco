import { CvaVariantResolverAdapter } from "../../../src/infrastructure/adapters/cva-variant-resolver.adapter.js";
import type { VisualVariantCategory } from "../../../src/domain/value-objects/visual-variant.js";

describe("CvaVariantResolverAdapter", () => {
  const adapter = new CvaVariantResolverAdapter();

  it.each<VisualVariantCategory>([
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
  ])("resolves every known category: %s", (category) => {
    const variant = adapter.resolve(category);
    expect(variant.category).toBe(category);
    expect(variant.headerBg).toBeTruthy();
    expect(variant.hexColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("is deterministic (hash-stable) for the same category", () => {
    const a = adapter.resolve("driving");
    const b = adapter.resolve("driving");
    expect(a).toEqual(b);
  });
});
