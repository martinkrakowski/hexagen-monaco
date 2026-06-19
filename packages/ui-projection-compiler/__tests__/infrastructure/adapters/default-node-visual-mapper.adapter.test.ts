import assert from "node:assert/strict";
import { describe, it } from "vitest";
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
    assert.strictEqual(projection.category, "entity");
    assert.strictEqual(projection.variant.category, "entity");
  });

  it("honors explicit category hint over kind", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Entity,
      label: "User",
      category: "port",
    };
    const projection = adapter.map(spec);
    assert.strictEqual(projection.category, "port");
  });

  it("maps a Controller kind to presentation", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Controller,
      label: "UsersController",
    };
    const projection = adapter.map(spec);
    assert.strictEqual(projection.category, "presentation");
  });

  it("falls back to default for unknown kind", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Extension,
      label: "MysteriousThing",
    };
    const projection = adapter.map(spec);
    assert.strictEqual(projection.category, "default");
  });

  it("produces a hash-stable NodeVisualProjection for the same inputs", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Entity,
      label: "User",
    };
    const a = adapter.map(spec);
    const b = adapter.map(spec);
    assert.deepStrictEqual(a, b);
  });

  it("carries the spec label through to the projection", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Entity,
      label: "User",
    };
    const projection = adapter.map(spec);
    assert.strictEqual(projection.label, "User");
  });
});
