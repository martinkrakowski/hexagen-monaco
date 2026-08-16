import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ArchitectureGraph } from "../../../src/domain/model/architecture-graph/architecture-graph";

/**
 * This was a `safeParse` assertion against a Zod schema. The schema was deleted
 * by the ADR-0054 `zod` disposition (2026-08-16) — its only non-test consumer
 * re-validated a graph this repo builds in-process. The shape is the contract,
 * and the literal below is checked by `yarn typecheck:test`.
 *
 * Note the explicit `status`: it used to be supplied by a Zod `.default()`. It
 * is now required, which is why it appears here — that obligation is enforced by
 * the compiler rather than repaired at runtime.
 */
describe("ArchitectureGraph domain type", () => {
  it("describes graph data", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        {
          id: "@hexagen/sync",
          label: "sync",
          type: "core",
          status: "active",
        },
      ],
      edges: [],
    };
    assert.strictEqual(graph.nodes[0].type, "core");
    assert.deepStrictEqual(graph.edges, []);
  });
});
