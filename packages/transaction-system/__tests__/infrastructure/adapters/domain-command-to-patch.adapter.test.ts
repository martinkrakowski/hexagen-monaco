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

    expect(patches).toHaveLength(1);
    expect(patches[0].type).toBe("add_node");
    expect(patches[0].targetId).toBe(NodeKind.BoundedContext);
    expect(patches[0].payload.kind).toBe(NodeKind.BoundedContext);
  });

  it("should map UpdateNodeCommand to update_node patch", () => {
    const cmd: UpdateNodeCommand = {
      type: "UpdateNode",
      payload: { nodeId: "my-context", attributes: { description: "updated" } },
    };

    const patches = adapter.convert([cmd]);

    expect(patches).toHaveLength(1);
    expect(patches[0].type).toBe("update_node");
    expect(patches[0].targetId).toBe("my-context");
  });

  it("should map DeleteNodeCommand to remove_node patch", () => {
    const cmd: DeleteNodeCommand = {
      type: "DeleteNode",
      payload: { nodeId: "old-context" },
    };

    const patches = adapter.convert([cmd]);

    expect(patches).toHaveLength(1);
    expect(patches[0].type).toBe("remove_node");
    expect(patches[0].targetId).toBe("old-context");
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

    expect(patches).toHaveLength(1);
    expect(patches[0].type).toBe("add_edge");
    expect(patches[0].payload.source).toBe("context-a");
    expect(patches[0].payload.target).toBe("context-b");
  });

  it("should map UpdateEdgeCommand to update_edge patch", () => {
    const cmd: UpdateEdgeCommand = {
      type: "UpdateEdge",
      payload: { edgeId: "edge-1", attributes: { label: "updated" } },
    };

    const patches = adapter.convert([cmd]);

    expect(patches).toHaveLength(1);
    expect(patches[0].type).toBe("update_edge");
    expect(patches[0].targetId).toBe("edge-1");
  });

  it("should map DeleteEdgeCommand to remove_edge patch", () => {
    const cmd: DeleteEdgeCommand = {
      type: "DeleteEdge",
      payload: { edgeId: "edge-1" },
    };

    const patches = adapter.convert([cmd]);

    expect(patches).toHaveLength(1);
    expect(patches[0].type).toBe("remove_edge");
    expect(patches[0].targetId).toBe("edge-1");
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

    expect(patches).toHaveLength(2);
    expect(patches[0].type).toBe("add_node");
    expect(patches[1].type).toBe("remove_node");
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

    expect(patches).toHaveLength(1);
    expect(patches[0].type).toBe("add_node");
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

    expect(patches).toHaveLength(3);
    expect(patches[0].type).toBe("add_node");
    expect(patches[1].type).toBe("add_edge");
    expect(patches[2].type).toBe("remove_node");
  });

  it("should return empty array for empty input", () => {
    const patches = adapter.convert([]);

    expect(patches).toHaveLength(0);
  });
});
