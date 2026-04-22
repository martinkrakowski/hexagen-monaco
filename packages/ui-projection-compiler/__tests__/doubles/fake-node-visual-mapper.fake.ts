import type { NodeVisualSpec } from "@hexagen/core-domain";
import type {
  MapNodeVisualPort,
  NodeVisualProjection,
} from "../../src/application/ports/in/map-node-visual.port.js";

export class FakeNodeVisualMapper implements MapNodeVisualPort {
  readonly calls: Array<{
    spec: NodeVisualSpec;
    kind: string;
    category?: string;
  }> = [];

  constructor(
    private readonly factory: (
      spec: NodeVisualSpec,
      kind: string,
      category?: string,
    ) => NodeVisualProjection = (spec) => ({
      nodeId: spec.nodeId,
      variant: {
        category: "default",
        headerBg: "",
        bodyBg: "",
        border: "",
        handleColor: "",
        headerText: "",
        hexColor: "#000000",
      },
      label: "",
      category: "default",
    }),
  ) {}

  map(
    spec: NodeVisualSpec,
    kind: string,
    category?: string,
  ): NodeVisualProjection {
    this.calls.push({ spec, kind, category });
    return this.factory(spec, kind, category);
  }
}
