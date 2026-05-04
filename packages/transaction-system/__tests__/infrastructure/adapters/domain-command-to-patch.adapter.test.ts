import assert from "node:assert/strict";
import { NodeKind, EdgeKind } from "@hexagen/core-domain";
import type {
  DomainCommand,
  CreateNodeCommand,
  UpdateNodeCommand,
  DeleteNodeCommand,
  CreateEdgeCommand,
  UpdateEdgeCommand,
  DeleteEdgeCommand,
} from "@hexagen/core-domain";
import { DomainCommandToManifestPatchAdapter } from "../../../src/infrastructure/adapters/domain-command-to-patch.adapter.js";

describe("DomainCommandToManifestPatchAdapter", () => {
  let adapter: DomainCommandToManifestPatchAdapter;

  beforeEach(() => {
    adapter = new DomainCommandToManifestPatchAdapter();
  });

  it("should map CreateNodeCommand to add_node patch", () => {
    const cmd: CreateNodeCommand = {
      type: "CreateNode",
      payload: {
        kind: NodeKind.BoundedContext,
        attributes: { description: "test" },
      },
    };

    const patches = adapter.convert([cmd]);

    assert.strictEqual(patches.length, 1);
    assert.strictEqual(patches[0].type, "add_node");
    assert.strictEqual(patches[0].targetId, NodeKind.BoundedContext);
    assert.strictEqual(patches[0].payload.kind, NodeKind.BoundedContext);
  });

  it("should map UpdateNodeCommand to update_node patch", () => {
    const cmd: UpdateNodeCommand = {
      type: "UpdateNode",
      payload: { nodeId: "my-context", attributes: { description: "updated" } },
    };

    const patches = adapter.convert([cmd]);

    assert.strictEqual(patches.length, 1);
    assert.strictEqual(patches[0].type, "update_node");
    assert.strictEqual(patches[0].targetId, "my-context");
  });

  it("should map DeleteNodeCommand to remove_node patch", () => {
    const cmd: DeleteNodeCommand = {
      type: "DeleteNode",
      payload: { nodeId: "old-context" },
    };

    const patches = adapter.convert([cmd]);

    assert.strictEqual(patches.length, 1);
    assert.strictEqual(patches[0].type, "remove_node");
    assert.strictEqual(patches[0].targetId, "old-context");
  });

  it("should map CreateEdgeCommand to add_edge patch", () => {
    const cmd: CreateEdgeCommand = {
      type: "CreateEdge",
      payload: {
        kind: EdgeKind.Dependency,
        source: "context-a",
        target: "context-b",
        attributes: {},
      },
    };

    const patches = adapter.convert([cmd]);

    assert.strictEqual(patches.length, 1);
    assert.strictEqual(patches[0].type, "add_edge");
    assert.strictEqual(patches[0].payload.source, "context-a");
    assert.strictEqual(patches[0].payload.target, "context-b");
  });

  it("should map UpdateEdgeCommand to update_edge patch", () => {
    const cmd: UpdateEdgeCommand = {
      type: "UpdateEdge",
      payload: { edgeId: "edge-1", attributes: { label: "updated" } },
    };

    const patches = adapter.convert([cmd]);

    assert.strictEqual(patches.length, 1);
    assert.strictEqual(patches[0].type, "update_edge");
    assert.strictEqual(patches[0].targetId, "edge-1");
  });

  it("should map DeleteEdgeCommand to remove_edge patch", () => {
    const cmd: DeleteEdgeCommand = {
      type: "DeleteEdge",
      payload: { edgeId: "edge-1" },
    };

    const patches = adapter.convert([cmd]);

    assert.strictEqual(patches.length, 1);
    assert.strictEqual(patches[0].type, "remove_edge");
    assert.strictEqual(patches[0].targetId, "edge-1");
  });

  it("should flatten BatchCommand into individual patches", () => {
    const cmd: DomainCommand = {
      type: "Batch",
      payload: {
        commands: [
          {
            type: "CreateNode",
            payload: { kind: NodeKind.Entity, attributes: {} },
          },
          { type: "DeleteNode", payload: { nodeId: "old-entity" } },
        ],
      },
    };

    const patches = adapter.convert([cmd]);

    assert.strictEqual(patches.length, 2);
    assert.strictEqual(patches[0].type, "add_node");
    assert.strictEqual(patches[1].type, "remove_node");
  });

  it("should handle nested BatchCommands", () => {
    const cmd: DomainCommand = {
      type: "Batch",
      payload: {
        commands: [
          {
            type: "Batch",
            payload: {
              commands: [
                {
                  type: "CreateNode",
                  payload: { kind: NodeKind.Port, attributes: {} },
                },
              ],
            },
          },
        ],
      },
    };

    const patches = adapter.convert([cmd]);

    assert.strictEqual(patches.length, 1);
    assert.strictEqual(patches[0].type, "add_node");
  });

  it("should convert multiple commands in order", () => {
    const commands: DomainCommand[] = [
      {
        type: "CreateNode",
        payload: { kind: NodeKind.BoundedContext, attributes: {} },
      },
      {
        type: "CreateEdge",
        payload: {
          kind: EdgeKind.Composition,
          source: "a",
          target: "b",
          attributes: {},
        },
      },
      { type: "DeleteNode", payload: { nodeId: "c" } },
    ];

    const patches = adapter.convert(commands);

    assert.strictEqual(patches.length, 3);
    assert.strictEqual(patches[0].type, "add_node");
    assert.strictEqual(patches[1].type, "add_edge");
    assert.strictEqual(patches[2].type, "remove_node");
  });

  it("should return empty array for empty input", () => {
    const patches = adapter.convert([]);

    assert.strictEqual(patches.length, 0);
  });
});
