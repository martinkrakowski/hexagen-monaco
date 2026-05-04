import assert from "node:assert/strict";
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
    "primary-adapter",
    "primary-port",
    "secondary-adapter",
    "secondary-port",
    "default",
  ])("resolves every known category: %s", (category) => {
    const variant = adapter.resolve(category);
    assert.strictEqual(variant.category, category);
    assert.ok(variant.headerBg);
    assert.match(variant.hexColor, /^#[0-9a-f]{6}$/i);
  });

  it("is deterministic (hash-stable) for the same category", () => {
    const a = adapter.resolve("driving");
    const b = adapter.resolve("driving");
    assert.deepStrictEqual(a, b);
  });
});
