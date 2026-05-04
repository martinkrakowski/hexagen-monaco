import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArchitectureGraphSchema } from "../../src/domain/model/architecture-graph/architecture-graph";

describe("ArchitectureGraphSchema", () => {
  it("should validate graph data", () => {
    const graphResult = ArchitectureGraphSchema.safeParse({
      nodes: [
        {
          id: "@hexagen/sync",
          label: "sync",
          type: "core",
        },
      ],
      edges: [],
    });
    assert.strictEqual(graphResult.success, true);
  });
});
