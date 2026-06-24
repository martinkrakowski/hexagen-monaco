import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  DomainCommand,
  CreateNodeCommand,
  UpdateNodeCommand,
  DeleteNodeCommand,
  CreateEdgeCommand,
  UpdateEdgeCommand,
  DeleteEdgeCommand,
  BatchCommand,
} from "../../../src/mvk/v1/index.js";

describe("MVK spec↔TS drift: DomainCommand shape", () => {
  it("DomainCommand variants carry only type + payload (no lineageId/timestamp)", () => {
    const validCreateNode: CreateNodeCommand = {
      type: "CreateNode",
      payload: { kind: "BoundedContext", attributes: {} },
    };
    const validUpdateNode: UpdateNodeCommand = {
      type: "UpdateNode",
      payload: { nodeId: "node-1", attributes: { name: "test" } },
    };
    const validDeleteNode: DeleteNodeCommand = {
      type: "DeleteNode",
      payload: { nodeId: "node-1" },
    };
    const validCreateEdge: CreateEdgeCommand = {
      type: "CreateEdge",
      payload: {
        kind: "PeerMapping",
        source: "a",
        target: "b",
        attributes: {},
      },
    };
    const validUpdateEdge: UpdateEdgeCommand = {
      type: "UpdateEdge",
      payload: { edgeId: "edge-1", attributes: {} },
    };
    const validDeleteEdge: DeleteEdgeCommand = {
      type: "DeleteEdge",
      payload: { edgeId: "edge-1" },
    };
    const validBatch: BatchCommand = {
      type: "Batch",
      payload: { commands: [validCreateNode] },
    };

    const commands: DomainCommand[] = [
      validCreateNode,
      validUpdateNode,
      validDeleteNode,
      validCreateEdge,
      validUpdateEdge,
      validDeleteEdge,
      validBatch,
    ];

    for (const cmd of commands) {
      assert.deepStrictEqual(Object.keys(cmd), ["type", "payload"]);
    }
  });

  it("BaseDomainCommand does not exist in the public API", async () => {
    const mod = (await import("../../../src/mvk/v1/index.js")) as Record<
      string,
      unknown
    >;
    assert.strictEqual(mod.BaseDomainCommand, undefined);
  });

  it("command.lineageId and command.timestamp are not accessible", () => {
    const cmd: DomainCommand = {
      type: "CreateNode",
      payload: { kind: "BoundedContext", attributes: {} },
    };
    assert.doesNotThrow(
      () => (cmd as unknown as { lineageId: string }).lineageId,
    );
    const keys = Object.keys(cmd);
    assert.ok(!keys.includes("lineageId"));
    assert.ok(!keys.includes("timestamp"));
  });
});
