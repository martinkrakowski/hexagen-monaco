import { DefaultNodeVisualMapperAdapter } from "../../../src/infrastructure/adapters/default-node-visual-mapper.adapter.js";
import { CvaVariantResolverAdapter } from "../../../src/infrastructure/adapters/cva-variant-resolver.adapter.js";
import type { NodeVisualSpec } from "@hexagen/core-domain";

describe("DefaultNodeVisualMapperAdapter", () => {
  const variantResolver = new CvaVariantResolverAdapter();
  const adapter = new DefaultNodeVisualMapperAdapter(variantResolver);

  const spec: NodeVisualSpec = { nodeId: "node-1" };

  it("maps an entity kind to the entity category", () => {
    const projection = adapter.map(spec, "Entity");
    expect(projection.category).toBe("entity");
    expect(projection.variant.category).toBe("entity");
  });

  it("honors explicit category hint over kind", () => {
    const projection = adapter.map(spec, "Entity", "port");
    expect(projection.category).toBe("port");
  });

  it("maps a Controller kind to presentation", () => {
    const projection = adapter.map(spec, "Controller");
    expect(projection.category).toBe("presentation");
  });

  it("falls back to default for unknown kind", () => {
    const projection = adapter.map(spec, "MysteriousThing");
    expect(projection.category).toBe("port"); // label-based fallback
  });

  it("produces a hash-stable NodeVisualProjection for the same inputs", () => {
    const a = adapter.map(spec, "Entity");
    const b = adapter.map(spec, "Entity");
    expect(a).toEqual(b);
  });
});
