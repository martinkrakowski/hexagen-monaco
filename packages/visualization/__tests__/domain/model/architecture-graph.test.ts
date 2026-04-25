import assert from "node:assert";
import { ArchitectureGraphSchema } from "../../src/domain/model/architecture-graph/architecture-graph";

(() => {
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
  assert.strictEqual(
    graphResult.success,
    true,
    "ArchitectureGraphSchema should validate graph data",
  );

  console.log("✅ architecture-graph tests passed");
})();
