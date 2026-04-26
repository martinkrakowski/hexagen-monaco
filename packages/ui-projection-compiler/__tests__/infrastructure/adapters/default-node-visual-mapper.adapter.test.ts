import { DefaultNodeVisualMapperAdapter } from "../../../src/infrastructure/adapters/default-node-visual-mapper.adapter.js";
import { CvaVariantResolverAdapter } from "../../../src/infrastructure/adapters/cva-variant-resolver.adapter.js";
import type { NodeVisualSpec } from "@hexagen/core-domain";
import { NodeKind } from "@hexagen/core-domain";

describe("DefaultNodeVisualMapperAdapter", () => {
  const variantResolver = new CvaVariantResolverAdapter();
  const adapter = new DefaultNodeVisualMapperAdapter(variantResolver);

  it("maps an Entity kind to the entity category", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Entity,
      label: "User",
    };
    const projection = adapter.map(spec);
    expect(projection.category).toBe("entity");
    expect(projection.variant.category).toBe("entity");
  });

  it("honors explicit category hint over kind", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Entity,
      label: "User",
      category: "port",
    };
    const projection = adapter.map(spec);
    expect(projection.category).toBe("port");
  });

  it("maps a Controller kind to presentation", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Controller,
      label: "UsersController",
    };
    const projection = adapter.map(spec);
    expect(projection.category).toBe("presentation");
  });

  it("falls back to default for unknown kind", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Extension,
      label: "MysteriousThing",
    };
    const projection = adapter.map(spec);
    expect(projection.category).toBe("default");
  });

  it("produces a hash-stable NodeVisualProjection for the same inputs", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Entity,
      label: "User",
    };
    const a = adapter.map(spec);
    const b = adapter.map(spec);
    expect(a).toEqual(b);
  });

  it("carries the spec label through to the projection", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Entity,
      label: "User",
    };
    const projection = adapter.map(spec);
    expect(projection.label).toBe("User");
  });
});
